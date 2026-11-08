// The curated catalog: ids, short codes, references between files. (That every skill exists in its repo and every
// remote URL answers is a network check: npm run verify.) Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const agents = read("catalog/agents.json");
const mcp = read("catalog/mcp.json");
const { categories, repos, skills } = read("catalog/skills.json");
const packs = read("catalog/packs.json");
const everything = [...agents, ...mcp, ...skills];
const FEATURED = ["anthropics/skills", "obra/superpowers", "mattpocock/skills", "vercel-labs/agent-skills", "addyosmani/agent-skills", "helmcode/community-skills", "openai/skills", "emilkowalski/skills"];

test("MCP servers and skills share one id namespace, so every id is unique", () => {
  const seen = new Map();
  for (const x of everything) { assert.ok(!seen.has(x.id), `duplicate id ${x.id}`); seen.set(x.id, 1); assert.match(x.id, /^[a-z0-9][a-z0-9-]*$/, x.id); }
});

test("every item has a unique two-letter share code", () => {
  const seen = new Set();
  for (const x of everything) { assert.match(x.k, /^[a-z0-9]{2}$/, `${x.id}: ${x.k}`); assert.ok(!seen.has(x.k), `duplicate code ${x.k} (${x.id})`); seen.add(x.k); }
  assert.ok(!seen.has("zz"), "zz is the Docker switch in share links");
});

test("the five v1 agents are in the table, each fully described", () => {
  assert.deepEqual(agents.map((a) => a.id), ["claude-code", "codex", "gemini", "cursor", "vscode"]);
  for (const a of agents) {
    assert.ok(["claude", "codex", "gemini", "vscode", "json"].includes(a.method), a.id);
    assert.ok(a.bin || a.paths.length, `${a.id} needs a way to be detected`);
    assert.ok(a.skills, `${a.id} needs a skills CLI agent name`);
    if (a.method === "json" || a.method === "vscode") assert.ok(a.config?.length && a.serversKey, `${a.id} needs a config file and servers key`);
  }
  assert.deepEqual(agents.map((a) => a.skills), ["claude-code", "codex", "gemini-cli", "cursor", "github-copilot"]);
});

test("servers: remote ones are https URLs, local ones a command the installer can split on spaces", () => {
  assert.equal(mcp.length, 22);
  for (const m of mcp) {
    assert.ok(["http", "stdio"].includes(m.transport), m.id);
    if (m.transport === "http") { assert.match(m.url, /^https:\/\/[^\s"']+$/, m.id); assert.ok(["oauth", "none"].includes(m.auth), m.id); assert.ok(!m.cmd); }
    else {
      assert.ok(!m.url);
      for (const t of m.cmd.split(" ")) assert.match(t, /^[A-Za-z0-9_@%+=:,./$-]+$/, `${m.id}: unsafe token ${t}`);
      assert.ok(m.needs?.length, `${m.id} should say which runtime it needs`);
      assert.ok(m.cmd.startsWith(m.needs[0] === "uv" ? "uvx " : "npx "), m.id);
    }
  }
});

test("the Docker catalog names are the ones we verified", () => {
  const docker = Object.fromEntries(mcp.filter((m) => m.docker).map((m) => [m.id, m.docker]));
  assert.deepEqual(docker, { github: "github-official", playwright: "playwright", context7: "context7", fetch: "fetch", git: "git", memory: "memory", "sequential-thinking": "sequentialthinking" });
});

test("the brief's servers are all there, at the URLs and commands it gave", () => {
  const by = Object.fromEntries(mcp.map((m) => [m.id, m]));
  assert.equal(by.github.url, "https://api.githubcopilot.com/mcp/");
  assert.equal(by.vercel.url, "https://mcp.vercel.com");
  assert.equal(by.stripe.url, "https://mcp.stripe.com");
  assert.equal(by.filesystem.cmd, "npx -y @modelcontextprotocol/server-filesystem $HOME");
  assert.equal(by.playwright.cmd, "npx -y @playwright/mcp@latest");
  assert.equal(by.fetch.cmd, "uvx mcp-server-fetch");
});

test("skills: 45 curated picks, each in a known category and a known repo or a hand-picked one", () => {
  assert.equal(skills.length, 45);
  for (const s of skills) {
    assert.ok(categories[s.cat], `${s.id}: category ${s.cat}`);
    assert.match(s.repo, /^[\w.-]+\/[\w.-]+$/, s.id);
    assert.ok(s.name && s.ds, s.id);
  }
});

test("the eight featured repos are listed, each with skills picked from it", () => {
  assert.deepEqual(repos.map((r) => r.repo), FEATURED);
  for (const r of repos) assert.ok(skills.some((s) => s.repo === r.repo), `nothing picked from ${r.repo}`);
});

test("Helmcode skills carry the badge", () => {
  assert.equal(repos.find((r) => r.repo === "helmcode/community-skills").badge, "helmcode");
  assert.deepEqual(skills.filter((s) => s.repo === "helmcode/community-skills").map((s) => s.id).sort(), ["building-a-beatdeck", "finops", "remotion-product-video"]);
});

test("kits: the six role packs, every id real", () => {
  assert.deepEqual(packs.map((p) => p.name), ["Superpowered workflow", "Frontend", "Product designer", "Backend", "Docker-first", "Docs & ops"]);
  const ids = new Set(everything.map((x) => x.id));
  for (const p of packs) for (const id of p.ids) assert.ok(ids.has(id), `${p.name}: ${id}`);
  assert.ok(packs.find((p) => p.name === "Docker-first").docker);
});

test("nothing in the catalog holds a secret", () => {
  const all = ["agents", "mcp", "skills", "packs"].map((n) => readFileSync(new URL(`../catalog/${n}.json`, import.meta.url), "utf8")).join("");
  assert.doesNotMatch(all, /(ghp_|github_pat_|sk-[A-Za-z0-9]{10}|Bearer |api[_-]?key|secret)/i);
});
