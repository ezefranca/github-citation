#!/usr/bin/env node
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import { CITATION_STYLES, generateCitation, getStyleLabel } from '../src/citation-core.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
const STYLE_IDS = CITATION_STYLES.map((style) => style.id);

const server = new McpServer({
  name: 'github-citation',
  version: packageJson.version
});

server.registerTool(
  'generate_github_citation',
  {
    title: 'Generate GitHub Citation',
    description: 'Generate BibTeX, APA, MLA, Chicago, IEEE, and Harvard citations from a public GitHub repository. The tool prefers CITATION.bib, converts CITATION.cff, and falls back to GitHub metadata.',
    inputSchema: {
      repository: z.string().describe('GitHub repository as owner/repo, a GitHub URL, or an SSH GitHub URL.'),
      style: z.enum(['bibtex', 'apa', 'mla', 'chicago', 'ieee', 'harvard']).default('bibtex').describe('Citation style to return when allStyles is false.'),
      allStyles: z.boolean().default(false).describe('Return every supported style instead of a single selected style.'),
      format: z.enum(['text', 'json']).default('text').describe('Response format in the text content.'),
      accessDate: z.string().optional().describe('Optional YYYY-MM-DD access date for fallback and formatted citations.'),
      includeProvenance: z.boolean().default(true).describe('Include the citation source and generation explanation in text responses.')
    }
  },
  async ({
    repository,
    style = 'bibtex',
    allStyles = false,
    format = 'text',
    accessDate,
    includeProvenance = true
  }) => {
    const result = await generateCitation(repository, {
      parseYaml,
      accessDate,
      githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
      userAgent: `github-citation-mcp/${packageJson.version}`
    });
    const payload = buildStructuredPayload(result, { style, allStyles });
    const text = format === 'json'
      ? JSON.stringify(payload, null, 2)
      : formatTextResponse(result, { style, allStyles, includeProvenance });

    return {
      content: [{ type: 'text', text }],
      structuredContent: payload
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

function formatTextResponse(result, options) {
  const citationText = options.allStyles
    ? CITATION_STYLES
      .map((style) => `${getStyleLabel(style.id)}:\n${result.outputs[style.id]}`)
      .join('\n\n')
    : `${getStyleLabel(options.style)}:\n${result.outputs[options.style]}`;

  if (!options.includeProvenance) {
    return citationText;
  }

  return [
    `Repository: ${result.repository.fullName}`,
    `Source: ${result.sourceLabel}`,
    result.explanation,
    '',
    citationText
  ].join('\n');
}

function buildStructuredPayload(result, options) {
  return {
    repository: result.repository,
    source: result.source,
    citationData: result.citationData,
    outputs: options.allStyles ? result.outputs : { [options.style]: result.outputs[options.style] },
    supportedStyles: STYLE_IDS
  };
}
