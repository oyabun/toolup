// The installer, run for real against stand-in agent CLIs. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { machine, script, lines } from "./helpers.mjs";

// Lines reporting something the run did (not the "agent found" lines, which also use a tick).
const done = (out) => lines(out, "✓").filter((l) => /^(claude|codex|gemini|code|npx|docker|brew|curl)\b| → /.test(l));
const SELECTION = ["github", "context7", "playwright", "fetch", "filesystem", "grill-me", "tdd", "frontend-design"];

test("the script is valid bash", () => {
  const r = spawnSync("bash", ["-n", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("the script passes shellcheck", { skip: spawnSync("shellcheck", ["--version"]).error ? "shellcheck not installed" : false }, () => {
  const r = spawnSync("shellcheck", ["-s", "bash", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
});

test("--list prints every id in the catalog", () => {
  const { code, out } = machine().run("--list");
  assert.equal(code, 0, out);
  for (const id of ["github", "playwright", "grill-me", "claude-code", "cursor"]) assert.match(out, new RegExp(`^${id}\\s`, "m"), id);
});

test("an unknown id is reported and nothing runs", () => {
  const m = machine();
  const { code, out } = m.run("--dry-run", "github", "not-a-real-thing");
  assert.equal(code, 1);
  assert.match(out, /not-a-real-thing: not in the catalog/);
  assert.equal(m.calls().length, 0);
});

test("--to rejects an agent we don't know", () => {
  assert.match(machine().run("--to", "emacs", "github").out, /unknown agent 'emacs'/);
});

test("--dry-run changes nothing", () => {
  const m = machine(), before = m.snapshot();
  const { code, out } = m.run("--dry-run", ...SELECTION);
  assert.equal(code, 0, out);
  assert.equal(m.snapshot(), before);
  assert.deepEqual(m.calls().filter((c) => /mcp add|--add-mcp|skills add|enable/.test(c)), []);
});

test("--dry-run prints what a real run then does", () => {
  const d = machine(), dry = d.run("--dry-run", ...SELECTION);
  const m = machine();
  const real = m.run(...SELECTION);
  const norm = (m) => (l) => l.replaceAll(m.home, "~");
  assert.equal(real.code, 0, real.out);
  const cli = /^(claude|codex|gemini|code|npx|docker|brew) /;
  assert.deepEqual(lines(dry.out, "→").filter((l) => cli.test(l)).map(norm(d)), lines(real.out, "✓").filter((l) => cli.test(l)).map(norm(m)));
  // Cursor is merged into its JSON file rather than through a CLI: same servers either way.
  const merged = (out, mark) => lines(out, mark).filter((l) => /cursor|mcp\.json/.test(l)).length;
  assert.equal(merged(dry.out, "→"), merged(real.out, "✓"));
  assert.ok(merged(real.out, "✓") > 0);
});

test("a real run wires every detected agent and installs the skills", () => {
  const m = machine();
  const { code, out } = m.run(...SELECTION);
  assert.equal(code, 0, out);
  for (const agent of ["claude", "codex", "gemini"]) for (const s of ["github", "context7", "playwright", "fetch", "filesystem"]) assert.ok(existsSync(join(m.state, agent, s)), `${agent}/${s}`);
  const cursor = JSON.parse(readFileSync(join(m.home, ".cursor/mcp.json"), "utf8")).mcpServers;
  assert.deepEqual(cursor.github, { url: "https://api.githubcopilot.com/mcp/" });
  assert.deepEqual(cursor.playwright, { command: "npx", args: ["-y", "@playwright/mcp@latest"] });
  const vscode = JSON.parse(readFileSync(join(m.home, ".config/Code/User/mcp.json"), "utf8")).servers;
  assert.deepEqual(vscode.github, { type: "http", url: "https://api.githubcopilot.com/mcp/" });
  for (const s of ["grill-me", "tdd", "frontend-design"]) {
    assert.ok(existsSync(join(m.home, ".agents/skills", s)), s);
    assert.ok(existsSync(join(m.home, ".claude/skills", s)), `${s} linked into Claude Code`);
  }
});

test("running it a second time changes nothing", () => {
  const m = machine();
  assert.equal(m.run(...SELECTION).code, 0);
  const after = m.snapshot(), calls = m.calls().length;
  const again = m.run(...SELECTION);
  assert.equal(again.code, 0, again.out);
  assert.equal(m.snapshot(), after);
  assert.deepEqual(m.calls().slice(calls).filter((c) => /mcp add|--add-mcp|skills add|enable/.test(c)), []);
  assert.deepEqual(done(again.out), []);
  assert.match(again.out, /•/);
});

test("it only adds what is missing", () => {
  const m = machine();
  m.run("github");
  const second = m.run("github", "context7");
  assert.deepEqual(done(second.out).filter((l) => /^(claude|codex|gemini) /.test(l)).map((l) => l.split(" ")[0]).sort(), ["claude", "codex", "gemini"]);
  assert.match(second.out, /github → Claude Code .*already set/);
});

test("--to kits only the agents named", () => {
  const m = machine();
  m.run("--to", "claude-code,cursor", "github", "tdd");
  assert.ok(existsSync(join(m.state, "claude/github")));
  assert.ok(!existsSync(join(m.state, "codex/github")));
  assert.ok(!existsSync(join(m.state, "gemini/github")));
  assert.ok(!existsSync(join(m.home, ".config/Code/User/mcp.json")));
  assert.ok(existsSync(join(m.home, ".cursor/mcp.json")));
  assert.ok(m.calls().some((c) => /skills add .* -a claude-code -a cursor /.test(c)), m.calls().join("\n"));
});

test("agents that aren't installed are reported and skipped", () => {
  const m = machine(["claude"]);
  const { out } = m.run("github");
  assert.match(out, /✓ Claude Code/);
  assert.match(out, /– Codex CLI not found/);
  assert.match(out, /– Cursor not found/);
  assert.ok(!existsSync(join(m.home, ".cursor")));
});

test("skills pass only the detected agents to the skills CLI, one call per repo", () => {
  const m = machine(["claude", "gemini"]);
  m.run("grill-me", "tdd", "brainstorming", "frontend-design");
  const adds = m.calls().filter((c) => c.startsWith("npx -y skills add"));
  assert.equal(adds.length, 3);
  assert.ok(adds.every((c) => c.includes("-a claude-code -a gemini-cli") && !/-a (cursor|codex|github-copilot)/.test(c)), adds.join("\n"));
  assert.ok(adds.some((c) => c.includes("mattpocock/skills -g -y -a claude-code -a gemini-cli --skill grill-me --skill tdd")));
});

test("--update re-installs skills that are already there; servers stay put", () => {
  const m = machine();
  m.run("github", "tdd");
  const n = m.calls().length;
  m.run("--update", "github", "tdd");
  const more = m.calls().slice(n);
  assert.ok(more.some((c) => /skills add .*--skill tdd/.test(c)));
  assert.ok(!more.some((c) => /mcp add|--add-mcp/.test(c)));
});

test("--docker enables catalog servers once and gives each agent a single MCP_DOCKER", () => {
  const m = machine();
  const { code, out } = m.run("--docker", "github", "playwright", "chrome-devtools", "filesystem");
  assert.equal(code, 0, out);
  for (const n of ["github-official", "playwright"]) assert.ok(existsSync(join(m.state, "docker", n)), n);
  assert.ok(!existsSync(join(m.state, "docker/chrome-devtools")));
  for (const agent of ["claude", "codex", "gemini"]) {
    assert.ok(existsSync(join(m.state, agent, "MCP_DOCKER")), agent);
    assert.ok(!existsSync(join(m.state, agent, "github")) && !existsSync(join(m.state, agent, "playwright")), `${agent} has no per-server entries`);
    assert.ok(existsSync(join(m.state, agent, "chrome-devtools")) && existsSync(join(m.state, agent, "filesystem")), `${agent} wires the rest directly`);
  }
  assert.match(readFileSync(join(m.state, "claude/MCP_DOCKER"), "utf8"), /MCP_DOCKER -- docker mcp gateway run|docker mcp gateway run/);
  const again = m.run("--docker", "github", "playwright", "chrome-devtools", "filesystem");
  assert.deepEqual(done(again.out), []);
});

test("--docker needs no Node or uv for servers that run in the gateway", () => {
  assert.doesNotMatch(machine().run("--dry-run", "--docker", "playwright", "fetch").out, /Runtimes[\s\S]*(Node|uv)/);
});

test("Codex remote servers are saved without waiting for its sign-in", () => {
  const m = machine(["codex"]);
  const { code, out, ms } = m.run("github");
  assert.equal(code, 0, out);
  assert.ok(existsSync(join(m.state, "codex/github")));
  assert.ok(ms < 30000, `took ${ms}ms: the OAuth wait was not cut short`);
});

test("$HOME is expanded when the script runs, not baked in", () => {
  const m = machine(["claude"]);
  const catalog = readFileSync(new URL("../public/catalog.tsv", import.meta.url), "utf8");
  assert.match(catalog, /server-filesystem \$HOME\t/);
  m.run("filesystem");
  assert.match(readFileSync(join(m.state, "claude/filesystem"), "utf8"), new RegExp(`server-filesystem ${m.home}\\b`));
});

test("Cursor's JSON is merged, never overwritten", () => {
  const m = machine(["cursor"]);
  spawnSync("bash", ["-c", `echo '{"theme":"x","mcpServers":{"github":{"url":"mine"},"other":{"command":"x"}}}' > "${m.home}/.cursor/mcp.json"`]);
  m.run("github", "context7");
  const j = JSON.parse(readFileSync(join(m.home, ".cursor/mcp.json"), "utf8"));
  assert.equal(j.theme, "x");
  assert.deepEqual(j.mcpServers.github, { url: "mine" });
  assert.deepEqual(j.mcpServers.other, { command: "x" });
  assert.equal(j.mcpServers.context7.url, "https://mcp.context7.com/mcp");
});

test("an old Node stops the skills step with a clear message", () => {
  const m = machine(["claude"]);
  spawnSync("bash", ["-c", `printf '#!/bin/bash\\necho v20.1.0\\n' > "${m.dir}/bin/node"; chmod +x "${m.dir}/bin/node"`]);
  const { out } = m.run("tdd");
  assert.match(out, /Skills need Node\.js 22\.20 or newer \(found v20\.1\.0\)/);
  assert.ok(!m.calls().some((c) => c.includes("skills add")));
});

test("the script and its catalog carry no tokens or secrets", () => {
  const text = readFileSync(script, "utf8") + readFileSync(new URL("../public/catalog.tsv", import.meta.url), "utf8");
  assert.doesNotMatch(text, /(ghp_|github_pat_|sk-[A-Za-z0-9]{10}|Bearer\s|api[_-]?key\s*=|token\s*=)/i);
});
