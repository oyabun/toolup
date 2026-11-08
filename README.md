# Kit'Em!

**Kit your agents in one line.** Pick MCP servers and skills at [kitenm.sh](https://kitenm.sh) and get one Terminal line that installs them into every AI coding agent on your machine. A sibling of [Get'Em!](https://getem.sh), which installs the agents themselves.

```sh
curl -fsSL kitenm.sh | bash -s -- github playwright grill-me tdd frontend-design
```

Positional arguments are catalog ids (servers and skills share one id namespace).

| Option | |
| --- | --- |
| `--to claude-code,cursor` | only kit these agents (default: every supported agent found) |
| `--docker` | route servers that have a Docker MCP Catalog entry through the Docker MCP Gateway (one `MCP_DOCKER` entry per agent) |
| `--dry-run` | print every action without changing anything |
| `--update` | re-install the chosen skills at their latest version |
| `--list` | print every id |

Agents (v1): Claude Code, Codex CLI, Gemini CLI, Cursor, VS Code + GitHub Copilot. Every step checks state first, so running it again only adds what's missing. No token or secret ever goes in the line, the share link or the script: OAuth servers ask for sign-in on first use.

## How it's built

```
catalog/agents.json    the agent table: how to detect each agent and how to wire it (add an agent = add an entry)
catalog/mcp.json       MCP servers: remote URL or local command, auth, Docker catalog name, runtime needed
catalog/skills.json    skills (owner/repo + category), the featured repos, the categories
catalog/packs.json     the role kits
catalog/installs.json  skills.sh install counts (refreshed daily by a job)
src/install.sh         the installer: one readable bash script, bash 3.2 safe, set -uo pipefail
scripts/build.mjs      catalog/*.json → public/catalog.json, catalog.tsv, install.sh
scripts/verify.mjs     network checks: every skill exists in its repo, every remote URL answers
scripts/installs.mjs   refreshes the install counts from skills.sh
public/                the static site (index.html, style.css, app.js) and the built files
test/                  catalog, installer (against stand-in CLIs), page (jsdom) and a clean-container e2e
```

The page never hard-codes a server or skill. "Download .sh" takes the hosted `install.sh`, bakes the catalog and your picks into it, and hands it over, so it works without the website. Both use the same script, so `--dry-run` shows exactly what a real run does.

### Adding an agent

Add one object to `catalog/agents.json`. `method` is how servers get written: `claude`, `codex` and `gemini` use the agent's own CLI, `vscode` uses `code --add-mcp`, and `json` merges into a JSON file (`config`, `serversKey`, and `urlKey` if it isn't `url`: Windsurf uses `serverUrl`). `skills` is the agent's name in the [skills CLI](https://github.com/vercel-labs/skills). Add a `skillsDir` only if the agent isn't one of the "universal" ones that read `~/.agents/skills`. Give it a `k` code nobody uses. A new CLI-based method needs a small case in `mcp_present` and `mcp_add` in `src/install.sh`.

## Credits

Logos are [Lobe Icons](https://github.com/lobehub/lobe-icons) (MIT) for the AI providers, [Simple Icons](https://simpleicons.org) (CC0) for other brands, and [Lucide](https://lucide.dev) (ISC) where neither has one. Each entry's `icon` field picks one (`lobe:claude-color`, `si:github`, `lu:globe#2ead33`); the build inlines it, so the page loads no icon files.

## Develop

```sh
npm run build     # catalog/ + src/ → public/
npm run dev       # http://localhost:3000 (curl http://localhost:3000 serves the installer, like production)
npm test          # catalog, installer + shellcheck, page
npm run verify    # network: skills exist in their repos, remote MCP URLs answer
npm run installs  # refresh skills.sh install counts
docker build -f test/e2e/Dockerfile -t kitem-e2e . && docker run --rm kitem-e2e   # real CLIs, clean container, run twice
```

`npm test` runs `shellcheck` when it is installed (CI always has it).

## Deploy

`curl -fsSL kitenm.sh | bash` needs the bare domain to answer curl with the script and browsers with the page, which a plain static host (GitHub Pages) can't do. `vercel.json` does it with a rewrite on curl/wget's User-Agent; `/install.sh` works on any host. Set `SITE_URL` (default `https://kitenm.sh`) at build time if the domain differs: it is baked into `install.sh` for the catalog download.

CI: `test.yml` (every push), `verify.yml` (catalog changes and weekly), `e2e.yml` (installer in a clean container), `installs.yml` (daily counts).
