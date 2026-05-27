#!/usr/bin/env node
import { createRequire } from 'node:module';
import { load as parseYaml } from 'js-yaml';
import {
  CITATION_STYLES,
  CitationError,
  generateCitation,
  getStyleLabel,
  isCitationStyle
} from '../src/citation-core.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
const STYLE_IDS = CITATION_STYLES.map((style) => style.id);

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (args.version) {
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }

  if (!args.repository) {
    throw new CliError('Missing repository argument.');
  }

  if (!isCitationStyle(args.style)) {
    throw new CliError(`Unsupported citation style "${args.style}". Use one of: ${STYLE_IDS.join(', ')}.`);
  }

  if (!['text', 'json'].includes(args.format)) {
    throw new CliError('Unsupported format. Use "text" or "json".');
  }

  const result = await generateCitation(args.repository, {
    parseYaml,
    accessDate: args.accessDate,
    githubToken: args.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    userAgent: `github-citation-cli/${packageJson.version}`
  });

  if (args.provenance) {
    process.stderr.write(`${result.sourceLabel}: ${result.explanation}\n`);
  }

  const output = formatCliOutput(result, args);
  process.stdout.write(`${output}\n`);
}

function parseArgs(argv) {
  const args = {
    repository: '',
    style: 'bibtex',
    format: 'text',
    all: false,
    provenance: false,
    accessDate: '',
    token: '',
    help: false,
    version: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }

    if (arg === '--version' || arg === '-v') {
      args.version = true;
      continue;
    }

    if (arg === '--all') {
      args.all = true;
      continue;
    }

    if (arg === '--provenance' || arg === '--source') {
      args.provenance = true;
      continue;
    }

    if (arg === '--style' || arg === '-s') {
      args.style = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--style=')) {
      args.style = arg.slice('--style='.length);
      continue;
    }

    if (arg === '--format' || arg === '-f') {
      args.format = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--format=')) {
      args.format = arg.slice('--format='.length);
      continue;
    }

    if (arg === '--access-date') {
      args.accessDate = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--access-date=')) {
      args.accessDate = arg.slice('--access-date='.length);
      continue;
    }

    if (arg === '--token') {
      args.token = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--token=')) {
      args.token = arg.slice('--token='.length);
      continue;
    }

    if (arg.startsWith('-')) {
      throw new CliError(`Unknown option "${arg}".`);
    }

    if (args.repository) {
      throw new CliError(`Unexpected argument "${arg}".`);
    }

    args.repository = arg;
  }

  args.style = args.style.toLowerCase();
  args.format = args.format.toLowerCase();
  return args;
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new CliError(`Missing value for ${optionName}.`);
  }

  return value;
}

function formatCliOutput(result, args) {
  if (args.format === 'json') {
    return JSON.stringify(buildJsonPayload(result, args), null, 2);
  }

  if (args.all) {
    return CITATION_STYLES
      .map((style) => `${getStyleLabel(style.id)}:\n${result.outputs[style.id]}`)
      .join('\n\n');
  }

  return result.outputs[args.style];
}

function buildJsonPayload(result, args) {
  return {
    repository: result.repository,
    source: result.source,
    citationData: result.citationData,
    outputs: args.all ? result.outputs : { [args.style]: result.outputs[args.style] }
  };
}

function usage() {
  return `GitHub Citation CLI

Usage:
  github-citation <owner/repo|github-url> [options]

Options:
  -s, --style <style>       Citation style: ${STYLE_IDS.join(', ')}. Default: bibtex.
  -f, --format <format>     Output format: text or json. Default: text.
      --all                 Output every citation style.
      --access-date <date>  Override the access date used in fallback citations.
      --token <token>       GitHub token. Defaults to GITHUB_TOKEN or GH_TOKEN.
      --provenance          Write citation source details to stderr.
  -v, --version             Print version.
  -h, --help                Show this help.

Examples:
  github-citation openai/openai-node
  github-citation https://github.com/owner/repo --style apa
  github-citation owner/repo --all --format json`;
}

class CliError extends Error {}

main().catch((error) => {
  const message = error instanceof CitationError || error instanceof CliError
    ? error.message
    : `Unexpected error: ${error.message}`;

  process.stderr.write(`github-citation: ${message}\n`);
  process.stderr.write('Run "github-citation --help" for usage.\n');
  process.exitCode = 1;
});
