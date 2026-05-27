import test from 'node:test';
import assert from 'node:assert/strict';
import { load as parseYaml } from 'js-yaml';
import { generateCitation, parseRepositoryInput } from '../src/citation-core.js';

test('parses GitHub repository inputs', () => {
  assert.deepEqual(parseRepositoryInput('owner/repo'), {
    owner: 'owner',
    repo: 'repo',
    fullName: 'owner/repo',
    repoUrl: 'https://github.com/owner/repo'
  });

  assert.equal(parseRepositoryInput('https://github.com/owner/repo.git?tab=readme')?.fullName, 'owner/repo');
  assert.equal(parseRepositoryInput('git@github.com:owner/repo.git')?.fullName, 'owner/repo');
  assert.equal(parseRepositoryInput('not a repo'), null);
});

test('uses maintainer-provided CITATION.bib first', async () => {
  const fetchImpl = createMockFetch({
    'https://raw.githubusercontent.com/owner/repo/HEAD/CITATION.bib': textResponse(`@software{owner_repo_2024,
  title = {Example Package},
  author = {Doe, Jane},
  year = {2024},
  url = {https://github.com/owner/repo}
}`)
  });

  const result = await generateCitation('owner/repo', {
    fetchImpl,
    parseYaml,
    accessDate: '2026-05-27'
  });

  assert.equal(result.source.historyLabel, 'CITATION.bib');
  assert.match(result.outputs.bibtex, /@software\{owner_repo_2024/);
  assert.match(result.outputs.apa, /Doe, J\. \(2024\)\. Example Package\./);
});

test('converts CITATION.cff when BibTeX is unavailable', async () => {
  const fetchImpl = createMockFetch({
    'https://raw.githubusercontent.com/owner/repo/HEAD/CITATION.bib': notFoundResponse(),
    'https://raw.githubusercontent.com/owner/repo/HEAD/CITATION.cff': textResponse(`cff-version: 1.2.0
title: Example Tool
version: 2.3.4
date-released: 2025-01-04
authors:
  - family-names: Santos
    given-names: Ezequiel
identifiers:
  - type: doi
    value: 10.1234/example
repository-code: https://github.com/owner/repo
`)
  });

  const result = await generateCitation('owner/repo', {
    fetchImpl,
    parseYaml,
    accessDate: '2026-05-27'
  });

  assert.equal(result.source.historyLabel, 'CITATION.cff');
  assert.match(result.outputs.bibtex, /title = \{Example Tool\}/);
  assert.match(result.outputs.bibtex, /doi = \{10\.1234\/example\}/);
  assert.match(result.outputs.harvard, /Santos, E\.\s+2025\. Example Tool\./);
});

test('falls back to GitHub metadata when no citation file exists', async () => {
  const fetchImpl = createMockFetch({
    'https://raw.githubusercontent.com/owner/repo/HEAD/CITATION.bib': notFoundResponse(),
    'https://raw.githubusercontent.com/owner/repo/HEAD/CITATION.cff': notFoundResponse(),
    'https://api.github.com/repos/owner/repo': jsonResponse({
      name: 'repo',
      description: 'A useful repository',
      created_at: '2020-06-01T00:00:00Z',
      html_url: 'https://github.com/owner/repo',
      owner: {
        login: 'owner',
        url: 'https://api.github.com/users/owner'
      }
    }),
    'https://api.github.com/users/owner': jsonResponse({
      name: 'Owner Name'
    })
  });

  const result = await generateCitation('owner/repo', {
    fetchImpl,
    parseYaml,
    accessDate: '2026-05-27'
  });

  assert.equal(result.source.historyLabel, 'GitHub metadata');
  assert.match(result.outputs.bibtex, /author = \{Name, Owner\}/);
  assert.match(result.outputs.bibtex, /Accessed 2026-05-27/);
  assert.match(result.outputs.ieee, /Available: https:\/\/github\.com\/owner\/repo\./);
});

function createMockFetch(routes) {
  return async (url) => routes[url] || notFoundResponse();
}

function textResponse(text) {
  return {
    ok: true,
    text: async () => text
  };
}

function jsonResponse(json) {
  return {
    ok: true,
    json: async () => json
  };
}

function notFoundResponse() {
  return {
    ok: false,
    text: async () => '',
    json: async () => ({})
  };
}
