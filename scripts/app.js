import {
  CITATION_STYLES,
  generateCitation,
  getStyleLabel,
  isCitationStyle,
  parseRepositoryInput
} from '../src/citation-core.js';

// Cache DOM lookups once so the rest of the file can stay focused on behavior.
const elements = {
  output: document.getElementById('output'),
  repoInput: document.getElementById('repoUrl'),
  form: document.getElementById('citationForm'),
  generateButton: document.getElementById('generateButton'),
  copyButton: document.getElementById('copyButton'),
  themeToggle: document.getElementById('themeToggle'),
  themeToggleLabel: document.getElementById('themeToggleLabel'),
  basicsButton: document.getElementById('basicsButton'),
  explainButton: document.getElementById('explainButton'),
  historyButton: document.getElementById('historyButton'),
  creditsButton: document.getElementById('creditsButton'),
  citationSource: document.getElementById('citationSource'),
  citationExplanation: document.getElementById('citationExplanation'),
  outputMeta: document.getElementById('outputMeta'),
  historyList: document.getElementById('historyList'),
  clearHistoryButton: document.getElementById('clearHistoryButton'),
  starCount: document.getElementById('starCount'),
  basicsDialog: document.getElementById('basicsDialog'),
  explainDialog: document.getElementById('explainDialog'),
  historyDialog: document.getElementById('historyDialog'),
  creditsDialog: document.getElementById('creditsDialog'),
  citationTabs: Array.from(document.querySelectorAll('[data-citation-style]'))
};

const LABELS = {
  generate: 'Generate citation',
  generating: 'Generating...'
};

const CONFIG = {
  projectApiUrl: 'https://api.github.com/repos/ezefranca/github-citation',
  historyStorageKey: 'github-citation-history-v1',
  themeStorageKey: 'github-citation-theme',
  historyLimit: 6
};

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

const state = {
  currentOutputs: {},
  currentCitation: null,
  currentStyle: 'bibtex',
  history: loadHistory(),
  yamlModulePromise: null
};

initialize();

function initialize() {
  bindEvents();
  renderHistory();
  loadProjectStars();
  syncThemeToggle();
  syncCitationTabs();
  updateCopyButtonLabel();

  if (state.history[0] && !elements.repoInput.value) {
    elements.repoInput.value = state.history[0].repoUrl;
  }
}

function bindEvents() {
  elements.form.addEventListener('submit', handleCitationSubmit);
  elements.copyButton.addEventListener('click', copyCurrentCitation);
  elements.themeToggle.addEventListener('click', toggleTheme);
  elements.basicsButton.addEventListener('click', () => openDialog(elements.basicsDialog));
  elements.explainButton.addEventListener('click', () => openDialog(elements.explainDialog));
  elements.historyButton.addEventListener('click', () => openDialog(elements.historyDialog));
  elements.creditsButton.addEventListener('click', () => openDialog(elements.creditsDialog));
  elements.clearHistoryButton.addEventListener('click', clearHistory);
  elements.historyList.addEventListener('click', restoreHistoryItem);
  elements.citationTabs.forEach((tab) => {
    tab.addEventListener('click', () => selectCitationStyle(tab.dataset.citationStyle));
  });

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      closeDialog(document.getElementById(button.dataset.closeDialog));
    });
  });

  [elements.basicsDialog, elements.explainDialog, elements.historyDialog, elements.creditsDialog].forEach((dialog) => {
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
    const citationResult = await generateCitation(repository, { loadYamlModule });
    applyCitationResult(citationResult);
  } catch (error) {
    console.error('Citation generation failed:', error);
    showGenerationFailureState();
  } finally {
    setBusyState(false);
  }
}

function applyCitationResult(citationResult) {
  state.currentCitation = citationResult.citationData;
  state.currentOutputs = citationResult.outputs;
  renderCitationOutput();
  updateProvenance(citationResult.sourceLabel, citationResult.explanation, citationResult.tone);
  setOutputMeta(citationResult.meta);
  elements.copyButton.disabled = !getCurrentCitationText();
  updateCopyButtonLabel();

  rememberHistory({
    fullName: citationResult.repository.fullName,
    repoUrl: citationResult.repository.repoUrl,
    sourceLabel: citationResult.historyLabel,
    timestamp: new Date().toISOString()
  });
}

function showInvalidRepositoryState() {
  resetCurrentCitation();
  setOutputMessage('Enter a valid GitHub repository URL or owner/repository pair.');
  setOutputMeta('No citation generated.');
  updateProvenance(
    'Invalid repository input',
    'Use a public GitHub repository URL such as https://github.com/owner/repository.',
    'error'
  );
}

function showGenerationFailureState() {
  resetCurrentCitation();
  setOutputMessage('Failed to generate a citation. Confirm that the repository exists and is public.');
  setOutputMeta('No citation generated.');
  updateProvenance(
    'Generation failed',
    'The repository could not be read from GitHub. Check the URL and try again.',
    'error'
  );
}

// Rendering -----------------------------------------------------------------

function setOutputMessage(message) {
  renderPlainCitation(message);
}

function setOutputMeta(message) {
  elements.outputMeta.textContent = message;
}

function renderBibtex(bibtex) {
  elements.output.innerHTML = highlightBibtex(bibtex);
  setOutputMode(true);
}

function renderPlainCitation(text) {
  elements.output.textContent = text;
  setOutputMode(false);
}

function setOutputMode(isBibtex) {
  elements.output.classList.toggle('bibtex-output', isBibtex);
}

function renderCitationOutput() {
  const citationText = getCurrentCitationText();
  if (!citationText) {
    return;
  }

  if (state.currentStyle === 'bibtex') {
    renderBibtex(citationText);
    return;
  }

  renderPlainCitation(citationText);
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

// Citation style state -------------------------------------------------------

function getCurrentCitationText() {
  return state.currentOutputs[state.currentStyle] || '';
}

function syncCitationTabs() {
  elements.citationTabs.forEach((tab) => {
    const isActive = tab.dataset.citationStyle === state.currentStyle;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.setAttribute('tabindex', isActive ? '0' : '-1');
  });
}

function selectCitationStyle(style) {
  if (!isCitationStyle(style)) {
    return;
  }

  state.currentStyle = style;
  syncCitationTabs();
  renderCitationOutput();
  updateCopyButtonLabel();
  elements.copyButton.disabled = !getCurrentCitationText();
}

function updateCopyButtonLabel() {
  elements.copyButton.textContent = getCopyLabel();
}

function getCopyLabel() {
  return `Copy ${getStyleLabel(state.currentStyle)}`;
}

// UI state ------------------------------------------------------------------

function setBusyState(isBusy) {
  elements.generateButton.disabled = isBusy;
  elements.generateButton.textContent = isBusy ? LABELS.generating : LABELS.generate;
  elements.copyButton.disabled = isBusy || !getCurrentCitationText();
}

function resetCurrentCitation() {
  state.currentOutputs = {};
  state.currentCitation = null;
  elements.copyButton.disabled = true;
  updateCopyButtonLabel();
}

async function copyCurrentCitation() {
  const citationText = getCurrentCitationText();
  if (!citationText) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(citationText);
    } else {
      copyWithTemporaryTextarea(citationText);
    }

    elements.copyButton.textContent = 'Copied';
  } catch (error) {
    console.error('Copy failed:', error);
    elements.copyButton.textContent = 'Copy failed';
    return;
  }

  window.setTimeout(() => {
    updateCopyButtonLabel();
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
  historyMeta.textContent = `${entry.sourceLabel} - ${formatHistoryDate(entry.timestamp)}`;

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

async function fetchJson(url, errorMessage) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(errorMessage);
  }

  return response.json();
}

async function loadYamlModule() {
  if (!state.yamlModulePromise) {
    state.yamlModulePromise = import('https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm');
  }

  return state.yamlModulePromise;
}
