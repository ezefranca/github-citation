---
name: github-citation
description: Install and use the GitHub Citation CLI or MCP server to generate citations for GitHub repositories. Use when a user asks to cite GitHub repos, software projects, code repositories, CITATION.bib, CITATION.cff, or to produce BibTeX, APA, MLA, Chicago, IEEE, or Harvard references from GitHub URLs.
---

# GitHub Citation

Use this skill to generate citations for public GitHub repositories. The generator checks sources in this order:

1. `CITATION.bib` from the repository.
2. `CITATION.cff`, converted into BibTeX and formatted styles.
3. GitHub repository metadata as a reviewable fallback.

Always preserve the source/provenance in your answer when it matters for research, manuscripts, papers, reports, or bibliographies. Treat `GitHub metadata` fallback citations as drafts that the user should review.

## Preferred Tool Order

1. Use the MCP tool `generate_github_citation` when the GitHub Citation MCP server is connected.
2. Otherwise use the CLI command `github-citation`.
3. If the command is unavailable but you are inside this repository, use `node bin/github-citation.js` after dependencies are installed.

Use `GITHUB_TOKEN` or `GH_TOKEN` in the environment for private repositories or to reduce GitHub API rate-limit failures. Do not ask for a token unless the request fails due to access or rate limits.

## Installation

First check whether the tools already exist:

```bash
command -v github-citation
command -v github-citation-mcp
```

If you are inside a checkout of this repository, install dependencies and use the local commands:

```bash
npm install
npm run citation -- owner/repo
npm run mcp
```

To expose the checkout as normal shell commands on the current machine:

```bash
npm install
npm link
github-citation --version
github-citation owner/repo
```

If the package is available from npm, install it globally:

```bash
npm install -g github-citation
github-citation --version
github-citation-mcp
```

For one-off use without a global install, use `npx`:

```bash
npx -y --package github-citation github-citation owner/repo
npx -y --package github-citation github-citation-mcp
```

Use Node.js 20 or newer. If installation fails, check `node --version` and `npm --version` before changing package code.

## CLI

Generate BibTeX:

```bash
github-citation owner/repo
```

Generate a style:

```bash
github-citation https://github.com/owner/repo --style apa
```

Generate all styles as JSON:

```bash
github-citation owner/repo --all --format json
```

Include provenance without contaminating stdout citation text:

```bash
github-citation owner/repo --style bibtex --provenance
```

Use an exact access date only when the user asks for one or the surrounding document requires it:

```bash
github-citation owner/repo --access-date 2026-05-27
```

Supported styles: `bibtex`, `apa`, `mla`, `chicago`, `ieee`, `harvard`.

## MCP

Add the server to the agent's MCP client config. The exact config path depends on the client; use the client's existing MCP configuration location.

From a local checkout, prefer an absolute path:

```json
{
  "mcpServers": {
    "github-citation": {
      "command": "node",
      "args": ["/absolute/path/to/github-citation/bin/github-citation-mcp.js"]
    }
  }
}
```

After `npm link` or a global install:

```json
{
  "mcpServers": {
    "github-citation": {
      "command": "github-citation-mcp"
    }
  }
}
```

Without installing globally:

```json
{
  "mcpServers": {
    "github-citation": {
      "command": "npx",
      "args": ["-y", "--package", "github-citation", "github-citation-mcp"]
    }
  }
}
```

If private repositories or higher rate limits are needed, add `GITHUB_TOKEN` or `GH_TOKEN` to the MCP server environment using the client's supported config format. Do not leave placeholder token strings in config.

Restart or reload the MCP client after editing its config, then verify that the `generate_github_citation` tool is listed.

Call `generate_github_citation` with:

```json
{
  "repository": "owner/repo",
  "style": "bibtex",
  "allStyles": false,
  "format": "text",
  "includeProvenance": true
}
```

Use `"format": "json"` when you need structured fields for a bibliography pipeline.

## Response Guidance

For a single requested citation, return the citation and a short source note.

For all styles, group by style name and include the repository source once.

If the source is `Maintainer-provided CITATION.bib`, present it as authoritative repository-provided citation metadata.

If the source is `Parsed from CITATION.cff`, mention that CFF metadata was converted.

If the source is `Inferred from GitHub metadata`, say it is a fallback draft and should be checked before publication.

Do not invent missing authors, DOI, publication venue, or release date. Use the generated output as the source of truth unless the user supplies additional metadata.
