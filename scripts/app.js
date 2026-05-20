// Cache DOM lookups once so the rest of the file can stay focused on behavior.
const elements = {
  output: document.getElementById('output'),
  repoInput: document.getElementById('repoUrl'),
  form: document.getElementById('citationForm'),
  generateButton: document.getElementById('generateButton'),
  copyButton: document.getElementById('copyButton'),
  themeToggle: document.getElementById('themeToggle'),
  themeToggleLabel: document.getElementById('themeToggleLabel'),
  explainButton: document.getElementById('explainButton'),
  historyButton: document.getElementById('historyButton'),
  creditsButton: document.getElementById('creditsButton'),
  citationSource: document.getElementById('citationSource'),
  citationExplanation: document.getElementById('citationExplanation'),
  outputMeta: document.getElementById('outputMeta'),
  historyList: document.getElementById('historyList'),
  clearHistoryButton: document.getElementById('clearHistoryButton'),
  starCount: document.getElementById('starCount'),
  explainDialog: document.getElementById('explainDialog'),
  historyDialog: document.getElementById('historyDialog'),
  creditsDialog: document.getElementById('creditsDialog')
};

const CONFIG = {
  projectApiUrl: 'https://api.github.com/repos/ezefranca/github-citation',
  historyStorageKey: 'github-citation-history-v1',
  themeStorageKey: 'github-citation-theme',
  historyLimit: 6,
  defaultCopyLabel: 'Copy BibTeX'
};

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

const state = {
  currentBibtex: '',
  history: loadHistory(),
  yamlModulePromise: null
};

initialize();

function initialize() {
  bindEvents();
  renderHistory();
  loadProjectStars();
  syncThemeToggle();

  if (state.history[0] && !elements.repoInput.value) {
    elements.repoInput.value = state.history[0].repoUrl;
  }
}

function bindEvents() {
  elements.form.addEventListener('submit', handleCitationSubmit);
  elements.copyButton.addEventListener('click', copyCurrentBibtex);
  elements.themeToggle.addEventListener('click', toggleTheme);
  elements.explainButton.addEventListener('click', () => openDialog(elements.explainDialog));
  elements.historyButton.addEventListener('click', () => openDialog(elements.historyDialog));
  elements.creditsButton.addEventListener('click', () => openDialog(elements.creditsDialog));
  elements.clearHistoryButton.addEventListener('click', clearHistory);
  elements.historyList.addEventListener('click', restoreHistoryItem);

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      closeDialog(document.getElementById(button.dataset.closeDialog));
    });
  });

  [elements.explainDialog, elements.historyDialog, elements.creditsDialog].forEach((dialog) => {
    dialog.addEventListener('click', closeDialogOnBackdrop);
  });
}

// Citation flow --------------------------------------------------------------

async function handleCitationSubmit(event) {
  event.preventDefault();
  await generateCitationFromInput();
}

async function generateCitationFromInput() {
  const repository = parseRepositoryInput(elements.repoInput.value);
  if (!repository) {
    showInvalidRepositoryState();
    return;
  }

  elements.repoInput.value = repository.fullName;
  setBusyState(true);
  setOutputMessage('Inspecting repository citation sources...');
  setOutputMeta(`Inspecting ${repository.fullName}...`);
  updateProvenance(
    'Checking repository sources',
    'Looking for CITATION.bib first, then CITATION.cff, and finally a GitHub metadata fallback.'
  );

  try {
    const citationResult = await resolveCitation(repository);
    applyCitationResult(repository, citationResult);
  } catch (error) {
    console.error('Citation generation failed:', error);
    showGenerationFailureState();
  } finally {
    setBusyState(false);
  }
}

async function resolveCitation(repository) {
  const citationBibUrl = `https://raw.githubusercontent.com/${repository.owner}/${repository.repo}/HEAD/CITATION.bib`;
  const citationCffUrl = `https://raw.githubusercontent.com/${repository.owner}/${repository.repo}/HEAD/CITATION.cff`;

  const directBibtex = await fetchTextIfOk(citationBibUrl, 'CITATION.bib');
  if (directBibtex) {
    return {
      bibtex: directBibtex.trim(),
      sourceLabel: 'Maintainer-provided CITATION.bib',
      historyLabel: 'CITATION.bib',
      explanation: 'Loaded the repository’s BibTeX file directly. No metadata inference or field mapping was required.',
      meta: `Authoritative repository citation loaded for ${repository.fullName}.`,
      tone: 'direct'
    };
  }

  const cffText = await fetchTextIfOk(citationCffUrl, 'CITATION.cff');
  if (cffText) {
    const yamlModule = await loadYamlModule();
    const cffData = yamlModule.load(cffText);

    return {
      bibtex: buildBibtexFromCff(cffData, repository),
      sourceLabel: 'Parsed from CITATION.cff',
      historyLabel: 'CITATION.cff',
      explanation: 'Converted the repository’s CFF metadata into BibTeX by mapping citation fields such as authors, title, release year, DOI, version, and URL.',
      meta: `CITATION.cff converted to BibTeX for ${repository.fullName}.`,
      tone: 'converted'
    };
  }

  return buildMetadataCitation(repository);
}

async function fetchTextIfOk(url, label) {
  try {
    const response = await fetch(url);
    return response.ok ? response.text() : null;
  } catch (error) {
    console.warn(`${label} fetch failed:`, error);
    return null;
  }
}

async function buildMetadataCitation(repository) {
  const repoData = await fetchJson(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}`,
    'GitHub repository lookup failed'
  );
  const ownerData = await fetchOptionalJson(
    repoData.owner?.url || `https://api.github.com/users/${repository.owner}`
  );

  const authorName = ownerData?.name || repoData.owner?.login || repository.owner;
  const year = extractYear(repoData.created_at);
  const citationKey = createCitationKey(repository.owner, repository.repo, year);
  const noteParts = ['GitHub repository', repoData.description, `Accessed ${todayIsoDate()}`].filter(Boolean);

  return {
    bibtex: formatBibtexEntry('misc', citationKey, [
      ['title', repoData.name],
      ['author', formatNameToBibtex(authorName)],
      ['year', year],
      ['url', repoData.html_url],
      ['note', noteParts.join('. ')]
    ]),
    sourceLabel: 'Inferred from GitHub metadata',
    historyLabel: 'GitHub metadata',
    explanation: 'No CITATION.bib or CITATION.cff file was found, so the tool generated a reviewable @misc entry using the repository name, owner profile name, repository creation year, canonical URL, and today’s access date.',
    meta: `Fallback citation generated for ${repository.fullName}. Review before using it in a manuscript.`,
    tone: 'fallback'
  };
}

async function fetchJson(url, errorMessage) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(errorMessage);
  }

  return response.json();
}

async function fetchOptionalJson(url) {
  try {
    const response = await fetch(url);
    return response.ok ? response.json() : null;
  } catch (error) {
    console.warn('Optional GitHub lookup failed:', error);
    return null;
  }
}

function applyCitationResult(repository, citationResult) {
  state.currentBibtex = citationResult.bibtex;
  renderBibtex(citationResult.bibtex);
  updateProvenance(citationResult.sourceLabel, citationResult.explanation, citationResult.tone);
  setOutputMeta(citationResult.meta);
  elements.copyButton.disabled = false;

  rememberHistory({
    fullName: repository.fullName,
    repoUrl: repository.repoUrl,
    sourceLabel: citationResult.historyLabel,
    timestamp: new Date().toISOString()
  });
}

function showInvalidRepositoryState() {
  resetCurrentBibtex();
  setOutputMessage('Enter a valid GitHub repository URL or owner/repository pair.');
  setOutputMeta('No citation generated.');
  updateProvenance(
    'Invalid repository input',
    'Use a public GitHub repository URL such as https://github.com/owner/repository.',
    'error'
  );
}

function showGenerationFailureState() {
  resetCurrentBibtex();
  setOutputMessage('Failed to generate BibTeX citation. Confirm that the repository exists and is public.');
  setOutputMeta('No citation generated.');
  updateProvenance(
    'Generation failed',
    'The repository could not be read from GitHub. Check the URL and try again.',
    'error'
  );
}

// BibTeX helpers -------------------------------------------------------------

function buildBibtexFromCff(data, repository) {
  const releasedAt = data['date-released'] || data.date_released || data['date-published'] || data.date_published;
  const year = releasedAt ? extractYear(releasedAt) : 'n.d.';
  const title = data.title || repository.repo;
  const authors = formatCffAuthors(data.authors, repository.owner);
  const doi = findIdentifierValue(data.identifiers, 'doi');
  const url = data.url || data['repository-code'] || data.repository || repository.repoUrl;
  const citationKey = createCitationKey(
    repository.owner,
    repository.repo,
    year !== 'n.d.' ? year : null,
    title
  );

  const fields = [
    ['title', title],
    ['author', authors],
    ['year', year],
    doi ? ['doi', doi] : null,
    data.version ? ['version', data.version] : null,
    data.publisher ? ['publisher', data.publisher] : null,
    url ? ['url', url] : null
  ].filter(Boolean);

  return formatBibtexEntry('misc', citationKey, fields);
}

function formatCffAuthors(authors, fallbackOwner) {
  if (!Array.isArray(authors) || authors.length === 0) {
    return formatNameToBibtex(fallbackOwner);
  }

  return authors
    .map((author) => {
      if (author.family_names && author.given_names) {
        return `${author.family_names}, ${author.given_names}`;
      }

      if (author.name) {
        return author.name;
      }

      return [author.family_names, author.given_names].filter(Boolean).join(', ');
    })
    .filter(Boolean)
    .join(' and ');
}

function findIdentifierValue(identifiers, type) {
  if (!Array.isArray(identifiers)) {
    return '';
  }

  return identifiers.find((identifier) => identifier.type === type)?.value || '';
}

function formatNameToBibtex(name) {
  const nameParts = String(name).trim().split(/\s+/).filter(Boolean);
  if (nameParts.length <= 1) {
    return nameParts[0] || 'Unknown';
  }

  const [firstName, ...lastName] = nameParts;
  return `${lastName.join(' ')}, ${firstName}`;
}

function createCitationKey(owner, repo, year, title) {
  const base = title || repo;
  const normalizedBase = String(base)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return [owner.toLowerCase(), normalizedBase || repo.toLowerCase(), year].filter(Boolean).join('_');
}

function formatBibtexEntry(type, key, fields) {
  const lines = fields.map(([field, value]) => `  ${field} = {${String(value)}}`);
  return `@${type}{${key},\n${lines.join(',\n')}\n}`;
}

function extractYear(dateLike) {
  return String(new Date(dateLike).getUTCFullYear());
}

function todayIsoDate() {
  return new Date().toISOString().split('T')[0];
}

// Rendering -----------------------------------------------------------------

function setOutputMessage(message) {
  elements.output.textContent = message;
}

function setOutputMeta(message) {
  elements.outputMeta.textContent = message;
}

function renderBibtex(bibtex) {
  elements.output.innerHTML = highlightBibtex(bibtex);
}

function updateProvenance(label, explanation, tone = 'neutral') {
  elements.citationSource.textContent = label;
  elements.citationSource.dataset.tone = tone;
  elements.citationExplanation.innerHTML = formatProvenanceHtml(explanation);
}

// Escape everything first, then re-introduce the tiny amount of markup we own.
function formatProvenanceHtml(text) {
  return escapeHtml(text)
    .replace(/CITATION\.bib/g, '<code>CITATION.bib</code>')
    .replace(/CITATION\.cff/g, '<code>CITATION.cff</code>')
    .replace(/@misc/g, '<code>@misc</code>');
}

function highlightBibtex(bibtex) {
  return bibtex
    .split('\n')
    .map((line) => highlightBibtexLine(line))
    .join('\n');
}

function highlightBibtexLine(line) {
  const entryMatch = line.match(/^(@)([A-Za-z]+)(\s*[{(]\s*)([^,\s]+)?/);
  if (entryMatch) {
    const [fullMatch, atSymbol, type, brace, key] = entryMatch;
    const keyMarkup = key ? `<span class="bibtex-key">${escapeHtml(key)}</span>` : '';
    const prefix = `<span class="bibtex-symbol">${escapeHtml(atSymbol)}</span><span class="bibtex-type">${escapeHtml(type)}</span>${escapeHtml(brace)}${keyMarkup}`;
    return `${prefix}${escapeHtml(line.slice(fullMatch.length))}`;
  }

  const fieldMatch = line.match(/^(\s*)([A-Za-z][A-Za-z0-9_-]*)(\s*=\s*)(.*)$/);
  if (fieldMatch) {
    const [, space, field, equals, rest] = fieldMatch;
    return `${escapeHtml(space)}<span class="bibtex-field">${escapeHtml(field)}</span>${escapeHtml(equals)}${highlightBibtexValues(rest)}`;
  }

  return escapeHtml(line);
}

function highlightBibtexValues(text) {
  const valueRegex = /(\{[^}]*\}|"[^"]*"|\d{4}|\d+(\.\d+)?)/g;
  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = valueRegex.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIndex, match.index));
    result += `<span class="bibtex-value">${escapeHtml(match[0])}</span>`;
    lastIndex = match.index + match[0].length;
  }

  result += escapeHtml(text.slice(lastIndex));
  return result;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

// Input parsing --------------------------------------------------------------

function parseRepositoryInput(input) {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return null;
  }

  const matchers = [
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i,
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/i,
    /^([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/
  ];

  for (const matcher of matchers) {
    const match = trimmedInput.match(matcher);
    if (match) {
      return buildRepositoryReference(match[1], match[2]);
    }
  }

  return null;
}

function buildRepositoryReference(owner, repo) {
  const normalizedRepo = repo.replace(/\.git$/i, '');
  return {
    owner,
    repo: normalizedRepo,
    fullName: `${owner}/${normalizedRepo}`,
    repoUrl: `https://github.com/${owner}/${normalizedRepo}`
  };
}

// UI state ------------------------------------------------------------------

function setBusyState(isBusy) {
  elements.generateButton.disabled = isBusy;
  elements.generateButton.textContent = isBusy ? 'Generating...' : 'Generate BibTeX';
  elements.copyButton.disabled = isBusy || !state.currentBibtex;
}

function resetCurrentBibtex() {
  state.currentBibtex = '';
  elements.copyButton.disabled = true;
  elements.copyButton.textContent = CONFIG.defaultCopyLabel;
}

async function copyCurrentBibtex() {
  if (!state.currentBibtex) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(state.currentBibtex);
    } else {
      copyWithTemporaryTextarea(state.currentBibtex);
    }

    elements.copyButton.textContent = 'Copied';
  } catch (error) {
    console.error('Copy failed:', error);
    elements.copyButton.textContent = 'Copy failed';
    return;
  }

  window.setTimeout(() => {
    elements.copyButton.textContent = CONFIG.defaultCopyLabel;
  }, 1600);
}

function copyWithTemporaryTextarea(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'absolute';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
}

// History -------------------------------------------------------------------

function loadHistory() {
  try {
    const rawHistory = window.localStorage.getItem(CONFIG.historyStorageKey);
    const parsedHistory = JSON.parse(rawHistory || '[]');
    return Array.isArray(parsedHistory) ? parsedHistory.slice(0, CONFIG.historyLimit) : [];
  } catch (error) {
    console.warn('History load failed:', error);
    return [];
  }
}

function rememberHistory(entry) {
  // Keep the list unique per repository while preserving the newest access at the top.
  state.history = [
    entry,
    ...state.history.filter((historyEntry) => historyEntry.repoUrl !== entry.repoUrl)
  ].slice(0, CONFIG.historyLimit);

  window.localStorage.setItem(CONFIG.historyStorageKey, JSON.stringify(state.history));
  renderHistory();
}

function clearHistory() {
  state.history = [];
  window.localStorage.removeItem(CONFIG.historyStorageKey);
  renderHistory();
}

function renderHistory() {
  const fragment = document.createDocumentFragment();

  if (state.history.length === 0) {
    fragment.appendChild(buildEmptyStateItem('No saved citations yet.'));
    elements.historyList.replaceChildren(fragment);
    return;
  }

  state.history.forEach((entry) => {
    fragment.appendChild(buildHistoryItem(entry));
  });

  elements.historyList.replaceChildren(fragment);
}

function buildEmptyStateItem(text) {
  const emptyState = document.createElement('li');
  emptyState.className = 'empty-state';
  emptyState.textContent = text;
  return emptyState;
}

function buildHistoryItem(entry) {
  const listItem = document.createElement('li');
  const historyButton = document.createElement('button');
  const repoName = document.createElement('strong');
  const historyMeta = document.createElement('span');

  historyButton.type = 'button';
  historyButton.className = 'history-entry';
  historyButton.dataset.repoUrl = entry.repoUrl;
  historyButton.dataset.fullName = entry.fullName;

  repoName.textContent = entry.fullName;
  historyMeta.textContent = `${entry.sourceLabel} · ${formatHistoryDate(entry.timestamp)}`;

  historyButton.append(repoName, historyMeta);
  listItem.appendChild(historyButton);
  return listItem;
}

function formatHistoryDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function restoreHistoryItem(event) {
  const historyButton = event.target.closest('.history-entry');
  if (!historyButton) {
    return;
  }

  elements.repoInput.value = historyButton.dataset.fullName || historyButton.dataset.repoUrl || '';
  closeDialog(elements.historyDialog);
  generateCitationFromInput();
}

// Theme and dialogs ----------------------------------------------------------

function getCurrentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function setTheme(theme) {
  const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = normalizedTheme;
  syncThemeToggle(normalizedTheme);

  try {
    window.localStorage.setItem(CONFIG.themeStorageKey, normalizedTheme);
  } catch (error) {
    console.warn('Theme preference save failed:', error);
  }
}

function syncThemeToggle(theme = getCurrentTheme()) {
  const nextThemeLabel = theme === 'dark' ? 'Light mode' : 'Dark mode';
  elements.themeToggleLabel.textContent = nextThemeLabel;
  elements.themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
}

function toggleTheme() {
  setTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
}

function openDialog(dialog) {
  if (!dialog) {
    return;
  }

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
    return;
  }

  dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (!dialog) {
    return;
  }

  if (typeof dialog.close === 'function') {
    dialog.close();
    return;
  }

  dialog.removeAttribute('open');
}

function closeDialogOnBackdrop(event) {
  if (event.target.tagName === 'DIALOG') {
    closeDialog(event.target);
  }
}

// Small header integrations --------------------------------------------------

async function loadProjectStars() {
  try {
    const project = await fetchJson(CONFIG.projectApiUrl, 'Project lookup failed');
    elements.starCount.textContent = Number(project.stargazers_count || 0).toLocaleString('en-US');
  } catch (error) {
    console.warn('Project star count failed:', error);
    elements.starCount.textContent = '--';
  }
}

async function loadYamlModule() {
  if (!state.yamlModulePromise) {
    state.yamlModulePromise = import('https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm');
  }

  return state.yamlModulePromise;
}
