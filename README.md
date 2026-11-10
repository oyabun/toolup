<p align="center">
  <img src="public/images/logo.svg" width="96" alt="Tool up!">
</p>

<h1 align="center">Tool up!</h1>

<p align="center">
  <img src="public/images/hero-closed.webp" width="480" alt="Tool up!">
</p>

**Tool up your AI agents in one line.** Pick the MCP servers and skills you want at [toolup.sh](https://toolup.sh), copy one command, and they are installed.

- **No juggling commands.** No more `claude mcp add`, `codex mcp add`, `gemini mcp add`, editing JSON files and running the skills CLI one agent at a time.
- **Every agent at once.** Claude Code, Codex CLI, Gemini CLI, Cursor and VS Code + Copilot: it finds the ones on your machine and sets up all of them.
- **Curated and simple.** A short list of MCP servers and skills worth having, in one set of categories. Select, copy, paste.
- **Safe to run again.** It only adds what's missing, and `--dry-run` shows what it would do first.

```sh
curl -fsSL toolup.sh | bash -s -- github sentry grill-me tdd frontend-design
```

| Option | |
| --- | --- |
| `--to claude-code,cursor` | only these agents (default: every one found) |
| `--docker` | route servers through the Docker MCP Gateway |
| `--dry-run` | print every action, change nothing |
| `--update` | re-install the chosen skills |
| `--list` | print every id |

Agents: Claude Code, Codex CLI, Gemini CLI, Cursor, VS Code + Copilot. No tokens or secrets in the line, the link or the script.

## Layout

```
catalog/     agents, MCP servers, skills, categories, packs (JSON)
src/         install.sh, the installer
scripts/     build, verify, installs, serve
public/      the static site and the built files
test/        catalog, installer, page, e2e
```

## Develop

```sh
npm run build    # catalog/ + src/ → public/
npm run dev      # http://localhost:3000
npm test         # catalog, installer + shellcheck, page
npm run verify   # network checks
```
