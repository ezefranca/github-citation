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

const CITATION_STYLES = [
  { id: 'bibtex', label: 'BibTeX' },
  { id: 'apa', label: 'APA' },
  { id: 'mla', label: 'MLA' },
  { id: 'chicago', label: 'Chicago' },
  { id: 'ieee', label: 'IEEE' },
  { id: 'harvard', label: 'Harvard' }
];

const LABELS = {
  generate: 'Generate citation',
  generating: 'Generating...'
};

const UNKNOWN_AUTHOR = 'Anonymous';

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
    const citationData = await buildCitationDataFromBibtex(directBibtex, repository);
    return {
      bibtex: directBibtex.trim(),
      citationData,
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
    const citation = buildCitationFromCff(cffData, repository);

    return {
      bibtex: citation.bibtex,
      citationData: citation.citationData,
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
  const metadata = await fetchRepositoryMetadata(repository);
  const citationData = buildCitationDataFromMetadata(repository, metadata);
  const citationKey = createCitationKey(repository.owner, repository.repo, citationData.year);
  const noteParts = ['GitHub repository', metadata.repoData.description, `Accessed ${todayIsoDate()}`].filter(Boolean);

  return {
    bibtex: formatBibtexEntry('misc', citationKey, [
      ['title', citationData.title],
      ['author', formatAuthorsForBibtex(citationData.authors)],
      ['year', citationData.year],
      ['url', citationData.url],
      ['note', noteParts.join('. ')]
    ]),
    citationData,
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

async function fetchRepositoryMetadata(repository) {
  const repoData = await fetchJson(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}`,
    'GitHub repository lookup failed'
  );
  const ownerData = await fetchOptionalJson(
    repoData.owner?.url || `https://api.github.com/users/${repository.owner}`
  );

  return { repoData, ownerData };
}

function buildCitationDataFromMetadata(repository, metadata) {
  const authorName =
    metadata.ownerData?.name || metadata.repoData.owner?.login || repository.owner;

  return normalizeCitationData({
    title: metadata.repoData.name || repository.repo,
    authors: [authorName],
    year: extractYear(metadata.repoData.created_at),
    url: metadata.repoData.html_url || repository.repoUrl,
    publisher: 'GitHub',
    accessed: todayIsoDate(),
    repository: repository.fullName,
    repoUrl: repository.repoUrl
  });
}

function applyCitationResult(repository, citationResult) {
  state.currentCitation = citationResult.citationData;
  state.currentOutputs = buildCitationOutputs(citationResult.citationData, citationResult.bibtex);
  renderCitationOutput();
  updateProvenance(citationResult.sourceLabel, citationResult.explanation, citationResult.tone);
  setOutputMeta(citationResult.meta);
  elements.copyButton.disabled = !getCurrentCitationText();
  updateCopyButtonLabel();

  rememberHistory({
    fullName: repository.fullName,
    repoUrl: repository.repoUrl,
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

// Citation helpers -------------------------------------------------------------

function buildCitationFromCff(data, repository) {
  const citationData = buildCitationDataFromCff(data, repository);
  const citationKey = createCitationKey(
    repository.owner,
    repository.repo,
    citationData.year !== 'n.d.' ? citationData.year : null,
    citationData.title
  );

  const fields = [
    ['title', citationData.title],
    ['author', formatAuthorsForBibtex(citationData.authors)],
    ['year', citationData.year],
    citationData.doi ? ['doi', citationData.doi] : null,
    citationData.version ? ['version', citationData.version] : null,
    citationData.publisher ? ['publisher', citationData.publisher] : null,
    citationData.url ? ['url', citationData.url] : null
  ].filter(Boolean);

  return {
    bibtex: formatBibtexEntry('misc', citationKey, fields),
    citationData
  };
}

function buildCitationDataFromCff(data, repository) {
  const releasedAt = data['date-released'] || data.date_released || data['date-published'] || data.date_published;
  const year = releasedAt ? extractYear(releasedAt) : 'n.d.';
  const title = data.title || repository.repo;
  const authors = normalizeCffAuthors(data.authors, repository.owner);
  const doi = findIdentifierValue(data.identifiers, 'doi');
  const url = data.url || data['repository-code'] || data.repository || repository.repoUrl;

  return normalizeCitationData({
    title,
    authors,
    year,
    doi,
    url,
    version: data.version,
    publisher: data.publisher || 'GitHub',
    accessed: todayIsoDate(),
    repository: repository.fullName,
    repoUrl: repository.repoUrl
  });
}

async function buildCitationDataFromBibtex(bibtex, repository) {
  const parsedEntry = parseBibtexEntry(bibtex);
  if (!parsedEntry) {
    const metadata = await fetchRepositoryMetadata(repository);
    return buildCitationDataFromMetadata(repository, metadata);
  }

  const fields = parsedEntry.fields;
  const urlValue = fields.url || fields.howpublished || repository.repoUrl;
  const baseCitationData = {
    title: fields.title,
    authors: parseBibtexAuthors(fields.author),
    year: fields.year,
    url: urlValue,
    doi: fields.doi,
    version: fields.version,
    publisher: fields.publisher,
    accessed: todayIsoDate(),
    repository: repository.fullName,
    repoUrl: repository.repoUrl
  };

  if (!fields.title || !fields.author || !fields.year) {
    const metadata = await fetchRepositoryMetadata(repository);
    const metadataCitation = buildCitationDataFromMetadata(repository, metadata);
    return normalizeCitationData(mergeCitationData(baseCitationData, metadataCitation));
  }

  return normalizeCitationData(baseCitationData);
}

function normalizeCffAuthors(authors, fallbackOwner) {
  if (!Array.isArray(authors) || authors.length === 0) {
    return [fallbackOwner || UNKNOWN_AUTHOR];
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
    .filter(Boolean);
}

function findIdentifierValue(identifiers, type) {
  if (!Array.isArray(identifiers)) {
    return '';
  }

  return identifiers.find((identifier) => identifier.type === type)?.value || '';
}

function formatNameToBibtex(name) {
  const nameParts = String(name).trim().split(/\s+/).filter(Boolean);
  if (nameParts.length === 0) {
    return UNKNOWN_AUTHOR;
  }

  if (nameParts.length === 1) {
    return nameParts[0];
  }

  const [firstName, ...lastName] = nameParts;
  return `${lastName.join(' ')}, ${firstName}`;
}

function formatAuthorsForBibtex(authors) {
  if (!Array.isArray(authors) || authors.length === 0) {
    return formatNameToBibtex(UNKNOWN_AUTHOR);
  }

  return authors
    .map((author) => {
      const cleaned = String(author).trim();
      if (!cleaned) {
        return '';
      }

      return cleaned.includes(',') ? cleaned : formatNameToBibtex(cleaned);
    })
    .filter(Boolean)
    .join(' and ');
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

function normalizeCitationData(citationData) {
  const normalized = { ...citationData };
  const authors = Array.isArray(normalized.authors) ? normalized.authors.filter(Boolean) : [];

  normalized.authors = authors.length > 0 ? authors : [UNKNOWN_AUTHOR];
  normalized.title = normalized.title || normalized.repository || normalized.repoUrl || 'Untitled';
  normalized.year = normalized.year || 'n.d.';
  normalized.url = normalized.url || normalized.repoUrl || '';
  normalized.publisher = normalized.publisher || 'GitHub';
  normalized.accessed = normalized.accessed || todayIsoDate();

  return normalized;
}

function mergeCitationData(primary, fallback) {
  return {
    ...fallback,
    ...primary,
    title: primary.title || fallback.title,
    authors: Array.isArray(primary.authors) && primary.authors.length ? primary.authors : fallback.authors,
    year: primary.year || fallback.year,
    url: primary.url || fallback.url,
    doi: primary.doi || fallback.doi,
    version: primary.version || fallback.version,
    publisher: primary.publisher || fallback.publisher,
    accessed: primary.accessed || fallback.accessed,
    repository: primary.repository || fallback.repository,
    repoUrl: primary.repoUrl || fallback.repoUrl
  };
}

function buildCitationOutputs(citationData, bibtex) {
  const normalized = normalizeCitationData(citationData);

  return {
    bibtex: String(bibtex || '').trim(),
    apa: formatApaCitation(normalized),
    mla: formatMlaCitation(normalized),
    chicago: formatChicagoCitation(normalized),
    ieee: formatIeeeCitation(normalized),
    harvard: formatHarvardCitation(normalized)
  };
}

function parseBibtexEntry(bibtex) {
  const entry = extractFirstBibtexEntry(bibtex);
  if (!entry) {
    return null;
  }

  const headerMatch = entry.match(/^@([A-Za-z]+)\s*[{(]/);
  if (!headerMatch) {
    return null;
  }

  const headerLength = headerMatch[0].length;
  const body = entry.slice(headerLength, -1);
  const commaIndex = findTopLevelComma(body);
  if (commaIndex === -1) {
    return null;
  }

  const key = body.slice(0, commaIndex).trim();
  const fieldsText = body.slice(commaIndex + 1);

  return {
    type: headerMatch[1],
    key,
    fields: parseBibtexFields(fieldsText)
  };
}

function extractFirstBibtexEntry(bibtex) {
  const atIndex = bibtex.indexOf('@');
  if (atIndex === -1) {
    return null;
  }

  const headerMatch = bibtex.slice(atIndex).match(/^@([A-Za-z]+)\s*[{(]/);
  if (!headerMatch) {
    return null;
  }

  const openIndex = atIndex + headerMatch[0].length - 1;
  const openChar = bibtex[openIndex];
  const closeChar = openChar === '{' ? '}' : ')';
  let depth = 0;

  for (let index = openIndex; index < bibtex.length; index += 1) {
    const char = bibtex[index];
    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
    }

    if (depth === 0) {
      return bibtex.slice(atIndex, index + 1);
    }
  }

  return null;
}

function findTopLevelComma(text) {
  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth < 0) {
        return -1;
      }
    } else if (char === ',' && depth === 0) {
      return index;
    }
  }

  return -1;
}

function parseBibtexFields(text) {
  const fields = {};
  let index = 0;

  while (index < text.length) {
    index = skipBibtexSeparators(text, index);
    const nameMatch = text.slice(index).match(/^([A-Za-z][A-Za-z0-9_-]*)/);
    if (!nameMatch) {
      break;
    }

    const name = nameMatch[1];
    index += name.length;
    index = skipBibtexWhitespace(text, index);

    if (text[index] !== '=') {
      break;
    }

    index += 1;
    index = skipBibtexWhitespace(text, index);

    const { value, nextIndex } = readBibtexValue(text, index);
    fields[name.toLowerCase()] = normalizeBibtexValue(value);
    index = nextIndex;
  }

  return fields;
}

function readBibtexValue(text, index) {
  const char = text[index];
  if (char === '{') {
    let depth = 0;
    let cursor = index;

    while (cursor < text.length) {
      const current = text[cursor];
      if (current === '{') {
        depth += 1;
      } else if (current === '}') {
        depth -= 1;
      }

      cursor += 1;
      if (depth === 0) {
        break;
      }
    }

    const value = text.slice(index, cursor);
    return { value, nextIndex: advanceToNextField(text, cursor) };
  }

  if (char === '"') {
    let cursor = index + 1;
    let escaped = false;

    while (cursor < text.length) {
      const current = text[cursor];
      if (!escaped && current === '"') {
        cursor += 1;
        break;
      }

      escaped = current === '\\' && !escaped;
      cursor += 1;
    }

    const value = text.slice(index, cursor);
    return { value, nextIndex: advanceToNextField(text, cursor) };
  }

  let cursor = index;
  while (cursor < text.length && text[cursor] !== ',') {
    cursor += 1;
  }

  const value = text.slice(index, cursor).trim();
  return { value, nextIndex: advanceToNextField(text, cursor) };
}

function advanceToNextField(text, index) {
  let cursor = index;
  while (cursor < text.length && text[cursor] !== ',') {
    cursor += 1;
  }

  return cursor < text.length ? cursor + 1 : cursor;
}

function skipBibtexWhitespace(text, index) {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function skipBibtexSeparators(text, index) {
  let cursor = index;
  while (cursor < text.length && /[\s,]/.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function normalizeBibtexValue(value) {
  return String(value)
    .trim()
    .replace(/^["{]+|["}]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBibtexAuthors(authorValue) {
  if (!authorValue) {
    return [];
  }

  return String(authorValue)
    .split(/\s+\band\b\s+/i)
    .map((author) => author.trim())
    .filter(Boolean);
}

function formatApaCitation(data) {
  const authors = formatApaAuthors(data.authors);
  const year = data.year || 'n.d.';
  const version = data.version ? ` (Version ${data.version})` : '';
  const publisher = data.publisher ? `${data.publisher}.` : '';
  const doiLink = formatDoiLink(data.doi);
  const url = data.url || doiLink;
  const access = url && data.accessed ? `Retrieved ${formatAccessDate(data.accessed)}, from ${url}` : url;

  const authorBlock = authors ? `${authors}.` : '';

  return [authorBlock, `(${year}).`, `${data.title}${version}.`, publisher, access]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatMlaCitation(data) {
  const authors = formatMlaAuthors(data.authors);
  const version = data.version ? `${data.version},` : '';
  const publisher = data.publisher ? `${data.publisher},` : '';
  const year = data.year ? `${data.year}.` : '';
  const url = data.url || formatDoiLink(data.doi);
  const accessed = data.accessed ? `Accessed ${formatAccessDate(data.accessed)}.` : '';

  return [authors, `${data.title}.`, version, publisher, year, url, accessed]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatChicagoCitation(data) {
  const authors = formatChicagoAuthors(data.authors);
  const version = data.version ? `${data.version}.` : '';
  const publisher = data.publisher ? `${data.publisher}.` : '';
  const url = data.url || formatDoiLink(data.doi);
  const accessed = url && data.accessed ? `(accessed ${formatAccessDate(data.accessed)}).` : '';

  return [authors, `${data.year}.`, `${data.title}.`, version, publisher, url, accessed]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatIeeeCitation(data) {
  const authors = formatIeeeAuthors(data.authors);
  const authorBlock = authors ? `${authors},` : '';
  const year = data.year || 'n.d.';
  const url = data.url || formatDoiLink(data.doi);
  const accessed = url && data.accessed ? `Accessed: ${formatAccessDate(data.accessed)}.` : '';

  return [
    authorBlock,
    `"${data.title}",`,
    data.publisher ? `${data.publisher},` : '',
    `${year}.`,
    '[Online].',
    url ? `Available: ${url}.` : '',
    accessed
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatHarvardCitation(data) {
  const authors = formatHarvardAuthors(data.authors);
  const version = data.version ? `${data.version}.` : '';
  const url = data.url || formatDoiLink(data.doi);
  const accessed = url && data.accessed ? `(Accessed: ${formatAccessDate(data.accessed)}).` : '';

  const authorBlock = authors ? `${authors}.` : '';

  return [
    authorBlock,
    `${data.year}.`,
    `${data.title}.`,
    version,
    url ? `Available at: ${url}` : '',
    accessed
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatApaAuthors(authors) {
  const formatted = authors.map((author) => formatAuthorLastInitials(author)).filter(Boolean);
  return joinAuthorList(formatted, '&');
}

function formatMlaAuthors(authors) {
  if (authors.length === 0) {
    return `${UNKNOWN_AUTHOR}.`;
  }

  const first = formatAuthorLastFirst(authors[0]);
  if (authors.length === 1) {
    return `${first}.`;
  }

  if (authors.length === 2) {
    return `${first}, and ${formatAuthorFirstLast(authors[1])}.`;
  }

  return `${first}, et al.`;
}

function formatChicagoAuthors(authors) {
  if (authors.length === 0) {
    return `${UNKNOWN_AUTHOR}.`;
  }

  const formatted = authors.map((author) => formatAuthorLastFirst(author)).filter(Boolean);
  return `${joinAuthorList(formatted, 'and')}.`;
}

function formatIeeeAuthors(authors) {
  if (authors.length === 0) {
    return UNKNOWN_AUTHOR;
  }

  const formatted = authors.map((author) => formatAuthorInitialsLast(author)).filter(Boolean);
  return joinAuthorList(formatted, 'and');
}

function formatHarvardAuthors(authors) {
  const formatted = authors.map((author) => formatAuthorLastInitials(author)).filter(Boolean);
  return joinAuthorList(formatted, 'and');
}

function joinAuthorList(authors, conjunction) {
  if (authors.length === 0) {
    return '';
  }

  const normalizedConjunction = conjunction.trim();

  if (authors.length === 1) {
    return authors[0];
  }

  if (authors.length === 2) {
    return `${authors[0]} ${normalizedConjunction} ${authors[1]}`;
  }

  return `${authors.slice(0, -1).join(', ')}, ${normalizedConjunction} ${authors[authors.length - 1]}`;
}

function formatAuthorLastInitials(author) {
  const { first, last, full } = splitAuthorName(author);
  if (!last) {
    return full;
  }

  const initials = formatInitials(first);
  return initials ? `${last}, ${initials}` : last;
}

function formatAuthorInitialsLast(author) {
  const { first, last, full } = splitAuthorName(author);
  if (!last) {
    return full;
  }

  const initials = formatInitials(first);
  return initials ? `${initials} ${last}` : last;
}

function formatAuthorLastFirst(author) {
  const { first, last, full } = splitAuthorName(author);
  if (!last) {
    return full;
  }

  return first ? `${last}, ${first}` : last;
}

function formatAuthorFirstLast(author) {
  const { first, last, full } = splitAuthorName(author);
  if (!last) {
    return full;
  }

  return first ? `${first} ${last}` : last;
}

function splitAuthorName(author) {
  const cleaned = String(author || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { first: '', last: '', full: '' };
  }

  if (cleaned.includes(',')) {
    const [last, first] = cleaned.split(',').map((part) => part.trim());
    return { first, last, full: cleaned };
  }

  const parts = cleaned.split(' ');
  if (parts.length === 1) {
    return { first: '', last: parts[0], full: cleaned };
  }

  const last = parts.pop();
  return { first: parts.join(' '), last, full: cleaned };
}

function formatInitials(firstName) {
  if (!firstName) {
    return '';
  }

  return firstName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}.`)
    .join(' ');
}

function formatAccessDate(dateValue) {
  const date = new Date(dateValue);
  const timeValue = date.getTime();
  if (!Number.isFinite(timeValue)) {
    return dateValue;
  }

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function formatDoiLink(doi) {
  if (!doi) {
    return '';
  }

  const normalized = String(doi).trim();
  if (!normalized) {
    return '';
  }

  return normalized.startsWith('http') ? normalized : `https://doi.org/${normalized}`;
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

function getStyleLabel(style) {
  return CITATION_STYLES.find((entry) => entry.id === style)?.label || 'Citation';
}

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
  if (!CITATION_STYLES.some((entry) => entry.id === style)) {
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
  const label = getStyleLabel(state.currentStyle);
  return `Copy ${label}`;
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
