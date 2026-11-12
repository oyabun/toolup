// Reading a pasted install command: skills, MCP servers and plugins, and leaving ordinary text alone.
import assert from "node:assert/strict";
import { test } from "node:test";
import { githubSkills, parsePaste, words } from "../core/paste.ts";

test("shell words honour quotes", () => {
  assert.deepEqual(words(`a "b c" 'd e' f\\ g ""`), ["a", "b c", "d e", "f g", ""]);
});

test("skills: the skills CLI in its usual spellings", () => {
  assert.deepEqual(parsePaste("npx skills add vercel-labs/agent-skills"), { type: "skill", repo: "vercel-labs/agent-skills", skills: [] });
  assert.deepEqual(parsePaste("$ npx -y skills@latest add anthropics/skills --skill frontend-design -g -y"), { type: "skill", repo: "anthropics/skills", skills: ["frontend-design"] });
  assert.deepEqual(parsePaste("npx skills add anthropics/skills -s pdf docx -a claude-code cursor"), { type: "skill", repo: "anthropics/skills", skills: ["pdf", "docx"] });
  assert.deepEqual(parsePaste("npx skills add mattpocock/skills@tdd"), { type: "skill", repo: "mattpocock/skills", skills: ["tdd"] });
  assert.deepEqual(parsePaste("bunx skills add https://github.com/anthropics/skills/tree/main/skills/pdf"), { type: "skill", repo: "anthropics/skills", skills: ["pdf"] });
  assert.deepEqual(parsePaste("npx skills add https://github.com/owner/repo.git --skill '*'"), { type: "skill", repo: "owner/repo", skills: [] });
  assert.deepEqual(parsePaste("npx add-skill owner/repo"), { type: "skill", repo: "owner/repo", skills: [] });
  assert.equal(parsePaste("npx skills add ../../etc"), null);
  assert.equal(parsePaste("npx skills add owner/repo --skill 'a b'"), null);
});

test("servers: each agent's own command, and the wrappers", () => {
  const sentry = { type: "server", name: "sentry", url: "https://mcp.sentry.dev/mcp", secrets: false };
  assert.deepEqual(parsePaste("claude mcp add --transport http sentry https://mcp.sentry.dev/mcp"), sentry);
  assert.deepEqual(parsePaste("claude mcp add sentry --scope user -t http https://mcp.sentry.dev/mcp"), sentry);
  assert.deepEqual(parsePaste("codex mcp add sentry --url https://mcp.sentry.dev/mcp"), sentry);
  assert.deepEqual(parsePaste("gemini mcp add -s user --transport http sentry https://mcp.sentry.dev/mcp"), sentry);
  assert.deepEqual(parsePaste("npx -y mcp-remote https://mcp.sentry.dev/mcp"), sentry);
  assert.deepEqual(parsePaste("npx add-mcp https://mcp.sentry.dev/mcp"), sentry);
  assert.deepEqual(parsePaste(`code --add-mcp '{"name":"sentry","url":"https://mcp.sentry.dev/mcp"}'`), sentry);
  assert.deepEqual(parsePaste(`claude mcp add-json sentry '{"type":"http","url":"https://mcp.sentry.dev/mcp"}'`), sentry);
});

test("servers: a settings snippet", () => {
  assert.deepEqual(parsePaste(`{ "mcpServers": { "linear": { "url": "https://mcp.linear.app/mcp" } } }`), { type: "server", name: "linear", url: "https://mcp.linear.app/mcp", secrets: false });
  assert.deepEqual(parsePaste(`{"mcpServers":{"fs":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem"]}}}`), { type: "local-server", name: "fs" });
  assert.equal(parsePaste(`{"hello":"world"}`), null);
});

test("servers: keys are noticed, and programs are told apart from addresses", () => {
  assert.deepEqual(parsePaste(`claude mcp add --transport http api https://api.example.com/mcp --header "Authorization: Bearer abc"`), { type: "server", name: "api", url: "https://api.example.com/mcp", secrets: true });
  assert.deepEqual(parsePaste("claude mcp add -e API_KEY=abc files -- npx -y @modelcontextprotocol/server-filesystem ~/code"), { type: "local-server", name: "files" });
  assert.deepEqual(parsePaste("codex mcp add files -- npx -y some-server"), { type: "local-server", name: "files" });
});

test("plugins: the install line, alone or with the list it comes from", () => {
  assert.deepEqual(parsePaste("/plugin install sales@knowledge-work-plugins"), { type: "plugin", plugin: "sales", market: "knowledge-work-plugins", repo: null });
  assert.deepEqual(parsePaste("/plugin marketplace add anthropics/knowledge-work-plugins\n/plugin install sales@knowledge-work-plugins"), { type: "plugin", plugin: "sales", market: "knowledge-work-plugins", repo: "anthropics/knowledge-work-plugins" });
  assert.deepEqual(parsePaste("claude plugin marketplace add https://github.com/owner/list && claude plugin install thing@list"), { type: "plugin", plugin: "thing", market: "list", repo: "owner/list" });
  assert.deepEqual(parsePaste("/plugin marketplace add owner/list"), { type: "market", repo: "owner/list" });
});

test("ordinary text is not a command", () => {
  for (const t of ["", "frontend design", "owner/repo", "https://example.com/owner/repo", "npm install skills", "how do I add an mcp server?", "claude mcp list", "x".repeat(30000)]) assert.equal(parsePaste(t), null, t);
});

test("a GitHub address on its own is a repository of skills to pick from", () => {
  assert.deepEqual(parsePaste("https://github.com/mengto/skills"), { type: "skill", repo: "mengto/skills", skills: [] });
  assert.deepEqual(parsePaste("github.com/arla6ka/design.how/"), { type: "skill", repo: "arla6ka/design.how", skills: [] });
  assert.deepEqual(parsePaste("https://github.com/Leonxlnx/taste-skill/tree/HEAD/skills/taste-skill"), { type: "skill", repo: "Leonxlnx/taste-skill", skills: ["taste-skill"] });
  assert.equal(githubSkills("owner/repo"), null, "plain owner/repo is too easily ordinary text for a paste");
  assert.deepEqual(githubSkills("owner/repo", true), { type: "skill", repo: "owner/repo", skills: [] }, "but fine where a repository is what was asked for");
  assert.equal(githubSkills("https://github.com/owner", true), null);
});
