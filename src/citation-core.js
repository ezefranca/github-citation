export const CITATION_STYLES = [
  { id: 'bibtex', label: 'BibTeX' },
  { id: 'apa', label: 'APA' },
  { id: 'mla', label: 'MLA' },
  { id: 'chicago', label: 'Chicago' },
  { id: 'ieee', label: 'IEEE' },
  { id: 'harvard', label: 'Harvard' }
];

export const UNKNOWN_AUTHOR = 'Anonymous';

export class CitationError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = 'CitationError';
    this.code = code;

    if (cause) {
      this.cause = cause;
    }
  }
}

export async function generateCitation(input, options = {}) {
  const repository = typeof input === 'string' ? parseRepositoryInput(input) : normalizeRepositoryReference(input);

  if (!repository) {
    throw new CitationError(
      'Enter a valid GitHub repository URL or owner/repository pair.',
      'INVALID_REPOSITORY'
    );
  }

  return resolveCitation(repository, options);
}

export async function resolveCitation(repository, options = {}) {
  const normalizedRepository = normalizeRepositoryReference(repository);

  if (!normalizedRepository) {
    throw new CitationError(
      'Enter a valid GitHub repository URL or owner/repository pair.',
      'INVALID_REPOSITORY'
    );
  }

  const context = createCitationContext(options);
  const citationBibUrl = `https://raw.githubusercontent.com/${normalizedRepository.owner}/${normalizedRepository.repo}/HEAD/CITATION.bib`;
  const citationCffUrl = `https://raw.githubusercontent.com/${normalizedRepository.owner}/${normalizedRepository.repo}/HEAD/CITATION.cff`;

  const directBibtex = await fetchTextIfOk(citationBibUrl, context);
  if (directBibtex) {
    const citationData = await buildCitationDataFromBibtex(directBibtex, normalizedRepository, context);
    return buildResolvedCitation(normalizedRepository, {
      bibtex: directBibtex.trim(),
      citationData,
      sourceLabel: 'Maintainer-provided CITATION.bib',
      historyLabel: 'CITATION.bib',
      explanation: 'Loaded the repository CITATION.bib file directly. No metadata inference or field mapping was required.',
      meta: `Authoritative repository citation loaded for ${normalizedRepository.fullName}.`,
      tone: 'direct'
    });
  }

  const cffText = await fetchTextIfOk(citationCffUrl, context);
  if (cffText) {
    const cffData = await parseCffYaml(cffText, context);
    const citation = buildCitationFromCff(cffData, normalizedRepository, context);

    return buildResolvedCitation(normalizedRepository, {
      bibtex: citation.bibtex,
      citationData: citation.citationData,
      sourceLabel: 'Parsed from CITATION.cff',
      historyLabel: 'CITATION.cff',
      explanation: 'Converted the repository CFF metadata into BibTeX by mapping citation fields such as authors, title, release year, DOI, version, and URL.',
      meta: `CITATION.cff converted to BibTeX for ${normalizedRepository.fullName}.`,
      tone: 'converted'
    });
  }

  return buildResolvedCitation(normalizedRepository, await buildMetadataCitation(normalizedRepository, context));
}

export function buildCitationOutputs(citationData, bibtex) {
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

export function parseRepositoryInput(input) {
  const trimmedInput = String(input || '').trim();
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

export function buildRepositoryReference(owner, repo) {
  const normalizedOwner = String(owner || '').trim();
  const normalizedRepo = String(repo || '').trim().replace(/\.git$/i, '');

  if (!normalizedOwner || !normalizedRepo) {
    return null;
  }

  return {
    owner: normalizedOwner,
    repo: normalizedRepo,
    fullName: `${normalizedOwner}/${normalizedRepo}`,
    repoUrl: `https://github.com/${normalizedOwner}/${normalizedRepo}`
  };
}

export function getStyleLabel(style) {
  return CITATION_STYLES.find((entry) => entry.id === style)?.label || 'Citation';
}

export function isCitationStyle(style) {
  return CITATION_STYLES.some((entry) => entry.id === style);
}

export function formatCitationForStyle(citationData, bibtex, style) {
  const outputs = buildCitationOutputs(citationData, bibtex);
  return outputs[style] || '';
}

export function buildCitationFromCff(data, repository, options = {}) {
  const context = createAccessDateContext(options);
  const citationData = buildCitationDataFromCff(data, repository, context);
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

export function buildCitationDataFromCff(data, repository, options = {}) {
  const context = createAccessDateContext(options);
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
    accessed: context.accessDate,
    repository: repository.fullName,
    repoUrl: repository.repoUrl
  });
}

export async function buildCitationDataFromBibtex(bibtex, repository, options = {}) {
  const context = options.accessDate ? options : createCitationContext(options);
  const parsedEntry = parseBibtexEntry(bibtex);
  if (!parsedEntry) {
    const metadata = await fetchRepositoryMetadata(repository, context);
    return buildCitationDataFromMetadata(repository, metadata, context);
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
    accessed: context.accessDate,
    repository: repository.fullName,
    repoUrl: repository.repoUrl
  };

  if (!fields.title || !fields.author || !fields.year) {
    const metadata = await fetchRepositoryMetadata(repository, context);
    const metadataCitation = buildCitationDataFromMetadata(repository, metadata, context);
    return normalizeCitationData(mergeCitationData(baseCitationData, metadataCitation));
  }

  return normalizeCitationData(baseCitationData);
}

export function parseBibtexEntry(bibtex) {
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

export function formatBibtexEntry(type, key, fields) {
  const lines = fields.map(([field, value]) => `  ${field} = {${String(value)}}`);
  return `@${type}{${key},\n${lines.join(',\n')}\n}`;
}

function normalizeRepositoryReference(repository) {
  if (!repository || typeof repository !== 'object') {
    return null;
  }

  if (repository.owner && repository.repo) {
    return buildRepositoryReference(repository.owner, repository.repo);
  }

  if (repository.fullName) {
    return parseRepositoryInput(repository.fullName);
  }

  return null;
}

function createCitationContext(options = {}) {
  const fetchImpl = options.fetchImpl || options.fetch || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new CitationError('A Fetch API implementation is required.', 'FETCH_UNAVAILABLE');
  }

  return {
    fetchImpl,
    accessDate: options.accessDate || todayIsoDate(),
    parseYaml: options.parseYaml,
    loadYamlModule: options.loadYamlModule,
    githubToken: options.githubToken,
    userAgent: options.userAgent,
    fetchHeaders: options.fetchHeaders || {}
  };
}

function createAccessDateContext(options = {}) {
  return {
    ...options,
    accessDate: options.accessDate || todayIsoDate()
  };
}

function buildResolvedCitation(repository, citationResult) {
  const outputs = buildCitationOutputs(citationResult.citationData, citationResult.bibtex);
  const source = {
    label: citationResult.sourceLabel,
    historyLabel: citationResult.historyLabel,
    explanation: citationResult.explanation,
    meta: citationResult.meta,
    tone: citationResult.tone
  };

  return {
    repository,
    bibtex: outputs.bibtex,
    citationData: citationResult.citationData,
    outputs,
    source,
    sourceLabel: source.label,
    historyLabel: source.historyLabel,
    explanation: source.explanation,
    meta: source.meta,
    tone: source.tone
  };
}

async function buildMetadataCitation(repository, context) {
  const metadata = await fetchRepositoryMetadata(repository, context);
  const citationData = buildCitationDataFromMetadata(repository, metadata, context);
  const citationKey = createCitationKey(repository.owner, repository.repo, citationData.year);
  const noteParts = ['GitHub repository', metadata.repoData.description, `Accessed ${context.accessDate}`].filter(Boolean);

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
    explanation: 'No CITATION.bib or CITATION.cff file was found, so the tool generated a reviewable @misc entry using the repository name, owner profile name, repository creation year, canonical URL, and access date.',
    meta: `Fallback citation generated for ${repository.fullName}. Review before using it in a manuscript.`,
    tone: 'fallback'
  };
}

async function parseCffYaml(text, context) {
  if (context.parseYaml) {
    return context.parseYaml(text);
  }

  if (context.loadYamlModule) {
    const yamlModule = await context.loadYamlModule();
    const load = yamlModule.load || yamlModule.default?.load;

    if (typeof load === 'function') {
      return load(text);
    }
  }

  throw new CitationError('CITATION.cff was found, but no YAML parser is configured.', 'YAML_PARSER_UNAVAILABLE');
}

async function fetchTextIfOk(url, context) {
  try {
    const response = await context.fetchImpl(url, buildFetchInit(context, url));
    return response.ok ? response.text() : null;
  } catch (error) {
    return null;
  }
}

async function fetchJson(url, errorMessage, context) {
  const response = await context.fetchImpl(url, buildFetchInit(context, url));
  if (!response.ok) {
    throw new CitationError(errorMessage, 'GITHUB_LOOKUP_FAILED');
  }

  return response.json();
}

async function fetchOptionalJson(url, context) {
  try {
    const response = await context.fetchImpl(url, buildFetchInit(context, url));
    return response.ok ? response.json() : null;
  } catch (error) {
    return null;
  }
}

function buildFetchInit(context, url) {
  const headers = { ...context.fetchHeaders };

  if (context.githubToken) {
    headers.Authorization = `Bearer ${context.githubToken}`;
  }

  if (context.userAgent) {
    headers['User-Agent'] = context.userAgent;
  }

  if (url.includes('api.github.com') && !headers.Accept) {
    headers.Accept = 'application/vnd.github+json';
  }

  return Object.keys(headers).length > 0 ? { headers } : undefined;
}

async function fetchRepositoryMetadata(repository, context) {
  const repoData = await fetchJson(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}`,
    'GitHub repository lookup failed',
    context
  );
  const ownerData = await fetchOptionalJson(
    repoData.owner?.url || `https://api.github.com/users/${repository.owner}`,
    context
  );

  return { repoData, ownerData };
}

function buildCitationDataFromMetadata(repository, metadata, context) {
  const authorName =
    metadata.ownerData?.name || metadata.repoData.owner?.login || repository.owner;

  return normalizeCitationData({
    title: metadata.repoData.name || repository.repo,
    authors: [authorName],
    year: extractYear(metadata.repoData.created_at),
    url: metadata.repoData.html_url || repository.repoUrl,
    publisher: 'GitHub',
    accessed: context.accessDate,
    repository: repository.fullName,
    repoUrl: repository.repoUrl
  });
}

function normalizeCffAuthors(authors, fallbackOwner) {
  if (!Array.isArray(authors) || authors.length === 0) {
    return [fallbackOwner || UNKNOWN_AUTHOR];
  }

  return authors
    .map((author) => {
      const familyName = author.family_names || author['family-names'];
      const givenName = author.given_names || author['given-names'];

      if (familyName && givenName) {
        return `${familyName}, ${givenName}`;
      }

      if (author.name) {
        return author.name;
      }

      return [familyName, givenName].filter(Boolean).join(', ');
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

function extractYear(dateLike) {
  const year = new Date(dateLike).getUTCFullYear();
  return Number.isFinite(year) ? String(year) : 'n.d.';
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

  const authorBlock = authors ? ensureTrailingPeriod(authors) : '';

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

  const authorBlock = authors ? ensureTrailingPeriod(authors) : '';

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

function ensureTrailingPeriod(text) {
  const trimmed = String(text || '').trim();
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
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
