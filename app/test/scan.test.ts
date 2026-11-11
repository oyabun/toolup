// The scan against a throwaway home directory laid out like a real machine.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { nodeHost } from "../core/host-node.ts";
import { scan } from "../core/scan.ts";
import { normalize, parseJsonc } from "../core/server.ts";
import type { Catalog } from "../core/types.ts";

const catalog: Catalog = JSON.parse(readFileSync(new URL("../../public/catalog.json", import.meta.url), "utf8"));

/** A machine: files under a fresh home, and the commands that are "installed". */
function machine(files: Record<string, string>, bins: string[], links: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "toolup-app-"));
  const home = join(root, "home"), bin = join(root, "bin");
  mkdirSync(home); mkdirSync(bin);
  for (const [p, text] of Object.entries(files)) { mkdirSync(dirname(join(home, p)), { recursive: true }); writeFileSync(join(home, p), text); }
  for (const [from, to] of Object.entries(links)) { mkdirSync(dirname(join(home, from)), { recursive: true }); symlinkSync(join(home, to), join(home, from)); }
  for (const b of bins) writeFileSync(join(bin, b), "");
  return { home, host: nodeHost({ home, path: [bin] }) };
}
const SECRET = "ghp_THISMUSTNEVERAPPEAR1234567890";
const skill = (name: string, ds: string) => `---\nname: ${name}\ndescription: ${ds}\n---\n\n# ${name}\n`;

const full = () => machine({
  ".claude.json": JSON.stringify({
    numStartups: 3,
    mcpServers: {
      github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      sentry: { type: "http", url: "https://mcp.sentry.dev/mcp" },
      internal: { command: "node", args: ["/opt/tools/server.js", "--api-key", SECRET], env: { DB_PASSWORD: SECRET } },
    },
    projects: { "/work/x": { mcpServers: { projectonly: { url: "https://example.com/mcp" } } } },
  }),
  ".codex/config.toml": `model = "gpt"\n\n[mcp_servers.gh]\nurl = "https://api.githubcopilot.com/mcp"\n\n[mcp_servers.files]\ncommand = "npx"\nargs = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]\n`,
  ".cursor/mcp.json": `{\n  // my servers\n  "mcpServers": {\n    "GitHub": { "command": "npx", "args": ["-y", "mcp-remote", "https://api.githubcopilot.com/mcp/?token=${SECRET}"] },\n  },\n}\n`,
  ".gemini/settings.json": "{ not json",
  ".claude/skills/own-skill/SKILL.md": skill("Own Skill", "Only Claude has this."),
  ".claude/skills/not-a-skill/readme.txt": "nothing",
  ".agents/skills/tdd/SKILL.md": skill("tdd", "Test first."),
}, ["claude", "codex", "gemini"], { ".claude/skills/tdd": ".agents/skills/tdd" });

test("finds the harnesses that are installed, by command or by folder", async () => {
  const inv = await scan(full().host, catalog);
  const here = Object.fromEntries(inv.harnesses.map((h) => [h.id, h.present]));
  assert.deepEqual(here, { "claude-code": true, codex: true, gemini: true, cursor: true, vscode: false });
});

test("the same server under different names and formats is one item across harnesses", async () => {
  const inv = await scan(full().host, catalog);
  const gh = inv.items.find((i) => i.catalogId === "github")!;
  assert.ok(gh, "matched to the catalog by its URL");
  assert.equal(gh.name, "GitHub");
  assert.deepEqual(Object.keys(gh.in).sort(), ["claude-code", "codex", "cursor"]);
  assert.equal(gh.in.codex.name, "gh", "each harness keeps the name it uses");
  assert.equal(gh.in.cursor.name, "GitHub");
  const sentry = inv.items.find((i) => i.catalogId === "sentry")!;
  assert.deepEqual(Object.keys(sentry.in), ["claude-code"], "Sentry is only in Claude Code: a gap to fill");
});

test("servers the user added themselves are listed as custom, with their transport", async () => {
  const inv = await scan(full().host, catalog);
  const files = inv.items.find((i) => i.in.codex?.name === "files")!;
  assert.equal(files.catalogId, null);
  assert.equal(files.transport, "stdio");
  assert.match(files.target!, /server-filesystem/);
  assert.ok(!inv.items.some((i) => i.in["claude-code"]?.name === "projectonly"), "project-level servers are out of scope");
});

test("no secret value ever reaches the inventory", async () => {
  const inv = await scan(full().host, catalog);
  assert.ok(!JSON.stringify(inv).includes(SECRET));
  const internal = inv.items.find((i) => i.in["claude-code"]?.name === "internal")!;
  assert.ok(internal.hasSecrets);
  assert.match(internal.target!, /--api-key •••/);
  assert.ok(inv.items.find((i) => i.catalogId === "github")!.hasSecrets, "a token in a URL counts");
  assert.ok(!inv.items.find((i) => i.catalogId === "sentry")!.hasSecrets);
});

test("a config that will not parse is reported, not fatal", async () => {
  const inv = await scan(full().host, catalog);
  const gemini = inv.harnesses.find((h) => h.id === "gemini")!;
  assert.match(gemini.problems[0], /settings\.json.*not valid JSON/);
});

test("skills: own folders, the shared folder, links, and what is not a skill", async () => {
  const inv = await scan(full().host, catalog);
  const skills = inv.items.filter((i) => i.kind === "skill");
  assert.deepEqual(skills.map((s) => s.key).sort(), ["skill:own-skill", "skill:tdd"]);
  const own = skills.find((s) => s.key === "skill:own-skill")!;
  assert.equal(own.name, "Own Skill");
  assert.equal(own.description, "Only Claude has this.");
  assert.equal(own.catalogId, null);
  assert.deepEqual(Object.keys(own.in), ["claude-code"]);
  const tdd = skills.find((s) => s.key === "skill:tdd")!;
  assert.equal(tdd.catalogId, "tdd", "matched to the catalog by its id");
  assert.deepEqual(Object.keys(tdd.in).sort(), ["claude-code", "codex", "cursor", "gemini"], "the shared folder serves every harness that reads it");
  assert.ok(tdd.in["claude-code"].linked && !tdd.in.codex.linked);
});

test("an empty machine gives an empty inventory", async () => {
  const inv = await scan(machine({}, []).host, catalog);
  assert.ok(inv.harnesses.every((h) => !h.present));
  assert.deepEqual(inv.items, []);
});

test("normalize: remote, wrapped remote and local servers", () => {
  assert.equal(normalize("a", { url: "https://X.dev/mcp/" }).key, "url:https://x.dev/mcp");
  assert.equal(normalize("a", { httpUrl: "https://x.dev/mcp" }).key, "url:https://x.dev/mcp", "Gemini's key for HTTP");
  assert.equal(normalize("a", { url: "https://x.dev/sse" }).transport, "sse");
  assert.equal(normalize("a", { command: "npx", args: ["mcp-remote@latest", "https://x.dev/mcp"] }).key, "url:https://x.dev/mcp");
  assert.equal(normalize("a", { command: "/usr/local/bin/npx", args: ["-y", "pkg"] }).key, normalize("b", { command: "npx", args: ["pkg"] }).key);
  assert.ok(normalize("a", { url: "https://x.dev/mcp", headers: { Authorization: "Bearer x" } }).hasSecrets);
  assert.equal(normalize("a", "nonsense").transport, "unknown");
});

test("parseJsonc: comments and trailing commas, but strings are left alone", () => {
  assert.deepEqual(parseJsonc('{ /* a */ "u": "http://x//y, }", // b\n "l": [1, 2,], }'), { u: "http://x//y, }", l: [1, 2] });
});

test("a local server two harnesses run with different arguments is still one row", async () => {
  const m = machine({
    ".claude.json": JSON.stringify({ mcpServers: { pencil: { command: "/Applications/Pen.app/Contents/Resources/app/mcp", args: ["--app", "claude"] } } }),
    ".codex/config.toml": `[mcp_servers.pencil]\ncommand = "/Applications/Pen.app/Contents/Resources/app/mcp"\nargs = ["--app", "codex"]\n\n[mcp_servers.other]\ncommand = "/Applications/Pen.app/Contents/Resources/app/mcp"\n`,
  }, ["claude", "codex"]);
  const inv = await scan(m.host, catalog);
  const pencil = inv.items.filter((i) => i.name === "pencil");
  assert.equal(pencil.length, 1);
  assert.deepEqual(Object.keys(pencil[0].in).sort(), ["claude-code", "codex"]);
  assert.equal(inv.items.length, 2, "a different name stays its own server");
});

test("Tool up!'s store: a skill linked into some agents, and one turned on for none", async () => {
  const m = machine({
    ".toolup/skills/house-style/SKILL.md": skill("House Style", "How we write."),
    ".toolup/skills/parked/SKILL.md": skill("Parked", "Not on anywhere."),
  }, ["claude", "codex"], { ".claude/skills/house-style": ".toolup/skills/house-style" });
  const inv = await scan(m.host, catalog);
  const house = inv.items.find((i) => i.key === "skill:house-style")!;
  assert.deepEqual(Object.keys(house.in), ["claude-code"], "on for Claude Code only");
  assert.ok(house.in["claude-code"].linked);
  assert.ok(house.store!.endsWith("/.toolup/skills/house-style"));
  const parked = inv.items.find((i) => i.key === "skill:parked")!;
  assert.deepEqual(parked.in, {}, "kept, but no agent has it");
  assert.ok(parked.store);
});

test("where a skill came from: Tool up!'s note beside it, else the catalog's repo", async () => {
  const m = machine({
    ".toolup/skills/house-style/SKILL.md": skill("House Style", "How we write."),
    ".toolup/skills/house-style/.toolup.json": JSON.stringify({ repo: "acme/skills", path: "skills/house-style", sha: "abc123" }),
    ".claude/skills/tdd/SKILL.md": skill("tdd", "Test first."),
    ".claude/skills/mine/SKILL.md": skill("mine", "Private."),
    ".claude/skills/mine/.toolup.json": "{ not json",
  }, ["claude"]);
  const inv = await scan(m.host, catalog), by = (k: string) => inv.items.find((i) => i.key === `skill:${k}`)!;
  assert.deepEqual(by("house-style").origin, { repo: "acme/skills", path: "skills/house-style", sha: "abc123" });
  assert.deepEqual(by("tdd").origin, { repo: catalog.skills.find((s) => s.id === "tdd")!.repo, path: null, sha: "" }, "a catalog skill installed some other way: the repo is known, the version is not");
  assert.equal(by("mine").origin, null);
});

test("plugins installed in Claude Code are listed", async () => {
  const m = machine({ ".claude/plugins/installed_plugins.json": JSON.stringify({ version: 2, plugins: { "sales@knowledge-work-plugins": [{ version: "2.1.0", installPath: "/x" }] } }) }, ["claude"]);
  assert.deepEqual((await scan(m.host, catalog)).plugins.map((p) => [p.name, p.market, p.version]), [["sales", "knowledge-work-plugins", "2.1.0"]]);
  const both = machine({
    ".claude/plugins/installed_plugins.json": JSON.stringify({ plugins: { "sales@knowledge-work-plugins": [{ version: "2.1.0" }] } }),
    ".codex/config.toml": `[plugins."sales@knowledge-work-plugins"]\nenabled = true\n\n[plugins."legal@knowledge-work-plugins"]\nenabled = true\n`,
  }, ["claude", "codex"]);
  assert.deepEqual((await scan(both.host, catalog)).plugins.map((p) => [p.name, p.agents]), [["legal", ["codex"]], ["sales", ["claude-code", "codex"]]]);
  assert.deepEqual((await scan(machine({}, []).host, catalog)).plugins, []);
});

test("a catalog skill kept in a folder of another name is still recognised, by the name it gives itself", async () => {
  const { host } = machine({ ".claude/skills/taste-skill/SKILL.md": skill("design-taste-frontend", "Anti-slop frontend.") }, ["claude"]);
  const item = (await scan(host, catalog)).items.find((i) => i.key === "skill:taste-skill")!;
  assert.equal(item.catalogId, "design-taste-frontend");
  assert.equal(item.name, "Design Taste", "it takes the catalog's name");
});
