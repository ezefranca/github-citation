# GitHub Citation Generator

![](/app.png)

A web, CLI, MCP, and agent-skill tool to generate BibTeX, APA, MLA, Chicago, IEEE, and Harvard citations from any GitHub repository. It supports repositories with `CITATION.bib` or `CITATION.cff` files and falls back to GitHub metadata when citation files are unavailable.

## Features
- **Multi-style output**: Switch between BibTeX, APA, MLA, Chicago, IEEE, and Harvard formats.
- **CITATION file support**: Prefers `CITATION.bib`, converts `CITATION.cff` when needed, and falls back to GitHub metadata.
- **CLI and MCP support**: Use the same citation engine from terminals, scripts, and agent clients.
- **Agent skill included**: `skills/github-citation` teaches agents when to use the CLI, MCP, and provenance details.
- **Highlighted BibTeX Output**: Displays BibTeX in a copyable, syntax-highlighted format.
- **Responsive Design**: Works seamlessly on both desktop and mobile devices.

## Web
1. Enter the URL of a public GitHub repository.
2. Click the "Generate citation" button.
3. Choose a citation style tab and copy the formatted citation.

For local preview, serve the repository directory so browser ES modules load correctly:

```bash
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173/`.

## CLI

```bash
npm install
npm run citation -- owner/repo
npm run citation -- https://github.com/owner/repo --style apa
npm run citation -- owner/repo --all --format json
```

After linking or installing the package globally:

```bash
github-citation owner/repo --style bibtex --provenance
```

Set `GITHUB_TOKEN` or `GH_TOKEN` for private repositories or higher API rate limits.

## MCP

Run the MCP server locally:

```bash
npm run mcp
```

Example MCP client config from this checkout:

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

When installed as a package, the command can be:

```json
{
  "command": "npx",
  "args": ["-y", "--package", "github-citation", "github-citation-mcp"]
}
```

The MCP tool is `generate_github_citation`.

## Agent Skill

This repository follows the cross-agent skill layout used by Agent Skills repositories:

```text
skills/
└── github-citation/
    ├── SKILL.md
    └── agents/
        └── openai.yaml
```

The bundled skill teaches agents how to install and use the CLI/MCP server, call the citation generator, and preserve citation provenance.

### Install In Codex

From Codex, install the skill from this repository with `$skill-installer`:

```text
$skill-installer install https://github.com/ezefranca/github-citation/tree/main/skills/github-citation
```

Then restart Codex so the new skill is discovered.

Manual install from a local checkout:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/github-citation "${CODEX_HOME:-$HOME/.codex}/skills/"
```

### Install In Claude Code

Personal install, available across projects:

```bash
mkdir -p ~/.claude/skills
cp -R skills/github-citation ~/.claude/skills/
```

Project-local install, available only in the current repo:

```bash
mkdir -p .claude/skills
cp -R skills/github-citation .claude/skills/
```

Claude Code can invoke the skill as `/github-citation` and can also load it automatically when the request matches the skill description. Restart Claude Code if the top-level skills directory did not exist when the session started.

### Verify The Skill

Ask your agent:

```text
Use $github-citation to generate a BibTeX citation for ezefranca/github-citation.
```

For Claude Code direct invocation:

```text
/github-citation generate an APA citation for ezefranca/github-citation
```
