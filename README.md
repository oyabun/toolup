<p align="center">
  <img src="public/favicon.svg" width="72" alt="Tool up!">
</p>

<h1 align="center">Tool up!</h1>

<p align="center">
  <img src="public/images/toolbox-closed.png" width="320" alt="A toolbox">
</p>

One line to tool up your AI agents with MCP servers and skills: [toolup.sh](https://toolup.sh)

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
