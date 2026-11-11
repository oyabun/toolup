// Reading a plugin marketplace, a repo's file list, a plugin's connectors and Claude Code's installed list.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mergePlugins, parseCodexPlugins, parseConnectors, parseInstalledPlugins, parseMarket, pluginSkills, repoSkills } from "../core/plugins.ts";

const market = { name: "knowledge-work-plugins", plugins: [
  { name: "sales", displayName: "Sales", source: "./sales", description: "Sales skills.", category: "productivity" },
  { name: "noibu", source: { source: "git-subdir", url: "https://github.com/Noibu/ai-plugin.git", path: "src", ref: "main" }, homepage: "https://noibu.com" },
  { name: "tavily", source: { source: "url", url: "https://github.com/tavily-ai/skills.git" } },
  { name: "elsewhere", source: { source: "url", url: "https://gitlab.com/a/b.git" } },
  { name: "sneaky", source: "../../etc" },
  { name: "bad name!", source: "./x" },
] };

test("a marketplace: where each plugin's files are", () => {
  const { name, plugins } = parseMarket("anthropics/knowledge-work-plugins", market);
  assert.equal(name, "knowledge-work-plugins");
  const by = Object.fromEntries(plugins.map((p) => [p.name, p]));
  assert.deepEqual([by.sales.repo, by.sales.path, by.sales.own, by.sales.title], ["anthropics/knowledge-work-plugins", "sales", true, "Sales"]);
  assert.deepEqual([by.noibu.repo, by.noibu.path, by.noibu.own], ["Noibu/ai-plugin", "src", false]);
  assert.deepEqual([by.tavily.repo, by.tavily.path], ["tavily-ai/skills", ""]);
  assert.equal(by.elsewhere.repo, null, "not on GitHub: it can be installed in Claude Code, but its skills cannot be read");
  assert.equal(by.sneaky.repo, null, "a path that climbs out of the repo is not followed");
  assert.equal(by["bad name!"], undefined);
  assert.throws(() => parseMarket("a/b", { plugins: "no" }));
});

test("the skills inside a plugin's folder, from the repo's file list", () => {
  const tree = { tree: ["sales/skills/call-prep/SKILL.md", "sales/skills/call-prep/notes.md", "sales/skills/account-plan/SKILL.md", "sales/README.md", "design/skills/critique/SKILL.md", "sales/skills/deep/er/SKILL.md"].map((path) => ({ path })) };
  assert.deepEqual(pluginSkills(tree, "sales"), ["sales/skills/account-plan", "sales/skills/call-prep"]);
  assert.deepEqual(pluginSkills({ tree: [{ path: "skills/search/SKILL.md" }, { path: "one/SKILL.md" }] }, ""), ["one", "skills/search"]);
  assert.throws(() => pluginSkills({ message: "API rate limit exceeded" }, "sales"), /rate limit/);
});

test("connectors: a name and where it talks to", () => {
  assert.deepEqual(parseConnectors({ mcpServers: { slack: { type: "http", url: "https://mcp.slack.com/mcp" }, local: { command: "npx" } } }), [{ name: "slack", host: "mcp.slack.com" }, { name: "local", host: "" }]);
  assert.deepEqual(parseConnectors("nope"), []);
});

test("Claude Code's installed plugins", () => {
  const text = JSON.stringify({ version: 2, plugins: { "sales@knowledge-work-plugins": [{ scope: "user", installPath: "/Users/me/.claude/plugins/cache/x/sales/2.1.0", version: "2.1.0" }], "solo": { version: "1" } } });
  assert.deepEqual(parseInstalledPlugins(text), [
    { id: "sales@knowledge-work-plugins", name: "sales", market: "knowledge-work-plugins", version: "2.1.0", path: "/Users/me/.claude/plugins/cache/x/sales/2.1.0", agents: ["claude-code"] },
    { id: "solo", name: "solo", market: "", version: "1", path: "", agents: ["claude-code"] },
  ]);
  assert.deepEqual(parseInstalledPlugins("{ broken"), []);
  assert.deepEqual(parseInstalledPlugins(null), []);
});

test("Codex's plugins come from its config, and one plugin in two agents is one row", () => {
  const codex = parseCodexPlugins({ plugins: { "sales@knowledge-work-plugins": { enabled: true }, "off@m": { enabled: false }, "plain@m": {} } });
  assert.deepEqual(codex.map((p) => [p.name, p.market, p.agents]), [["sales", "knowledge-work-plugins", ["codex"]], ["plain", "m", ["codex"]]]);
  const claude = parseInstalledPlugins(JSON.stringify({ plugins: { "sales@knowledge-work-plugins": [{ version: "2.1.0" }] } }));
  const all = mergePlugins(claude, codex);
  assert.deepEqual(all.map((p) => [p.name, p.agents, p.version]), [["plain", ["codex"], ""], ["sales", ["claude-code", "codex"], "2.1.0"]]);
  assert.deepEqual(parseCodexPlugins(null), []);
});

test("every skill folder in a repo, wherever it sits, one per name", () => {
  const tree = { tree: ["README.md", "SKILL.md", "skills/pdf/SKILL.md", "skills/pdf/ref.md", "tdd/SKILL.md", "deep/er/pdf/SKILL.md", "bad name/SKILL.md", "-x/SKILL.md"].map((path) => ({ path })) };
  assert.deepEqual(repoSkills(tree), ["tdd", "skills/pdf"]);
  assert.throws(() => repoSkills({ message: "Not Found" }), /Not Found/);
});
