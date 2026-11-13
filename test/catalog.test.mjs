// The curated catalog: ids, short codes, references between files. (That every skill exists in its repo and every
// remote URL answers is a network check: npm run verify.) Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const agents = read("catalog/agents.json");
const mcp = read("catalog/mcp.json");
const { repos, skills } = read("catalog/skills.json");
const categories = read("catalog/categories.json");
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

test("the agents are in the table, each fully described", () => {
  assert.deepEqual(agents.map((a) => a.id), ["claude-code", "codex", "gemini", "cursor", "vscode", "windsurf", "cline", "qwen-code", "deepseek-harness", "openclaw", "goose", "kiro", "pi", "hermes"]);
  for (const a of agents) {
    assert.ok(["claude", "codex", "gemini", "vscode", "json", "skills"].includes(a.method), a.id);   // "skills": no servers wired from here, skills only
    assert.ok(a.bin || a.paths.length, `${a.id} needs a way to be detected`);
    assert.ok(a.skills, `${a.id} needs a skills CLI agent name`);
    if (a.method === "json" || a.method === "vscode") assert.ok(a.config?.length && a.serversKey, `${a.id} needs a config file and servers key`);
  }
  // the name the open skills CLI knows each agent by. DeepSeek Harness is not one of them: it reads the shared
  // ~/.agents/skills folder, which is where the CLI's "codex" target installs.
  assert.deepEqual(agents.map((a) => a.skills), ["claude-code", "codex", "gemini-cli", "cursor", "github-copilot", "windsurf", "cline", "qwen-code", "codex", "openclaw", "goose", "kiro-cli", "pi", "hermes-agent"]);
  for (const a of agents) if (a.httpExtra) assert.doesNotThrow(() => JSON.parse(`{${a.httpExtra}}`), `${a.id}: httpExtra must be JSON members`);
});

test("servers: every one is a remote https URL that signs in with the browser or needs nothing", () => {
  assert.equal(mcp.length, 56);
  for (const m of mcp) {
    assert.equal(m.transport, "http", `${m.id}: the catalog lists remote servers only`);
    assert.match(m.url, /^https:\/\/[^\s"']+$/, m.id);
    assert.ok(["oauth", "none"].includes(m.auth), m.id);
    assert.ok(!m.cmd && !m.needs && !m.docker, `${m.id}: nothing to install or run locally`);
  }
});

test("the brief's remote servers are there, at the URLs it gave", () => {
  const by = Object.fromEntries(mcp.map((m) => [m.id, m]));
  assert.equal(by.github.url, "https://api.githubcopilot.com/mcp/");
  assert.equal(by.vercel.url, "https://mcp.vercel.com");
  assert.equal(by.stripe.url, "https://mcp.stripe.com");
  assert.equal(by.context7.url, "https://mcp.context7.com/mcp");
});

test("skills: 176 curated picks, each in a known category and a known repo or a hand-picked one", () => {
  assert.equal(skills.length, 176);
  for (const s of skills) {
    assert.ok(s.cats && s.cats.length, `${s.id}: needs a category`);
    for (const c of s.cats) assert.ok(categories[c], `${s.id}: category ${c}`);
    assert.match(s.repo, /^[\w.-]+\/[\w.-]+$/, s.id);
    assert.ok(s.name && s.ds, s.id);
  }
});

test("the eight featured repos come first, and every listed repo has skills picked from it", () => {
  assert.deepEqual(repos.slice(0, FEATURED.length).map((r) => r.repo), FEATURED);
  for (const r of repos) assert.ok(skills.some((s) => s.repo === r.repo), `nothing picked from ${r.repo}`);
});

test("Helmcode skills carry the badge", () => {
  assert.equal(repos.find((r) => r.repo === "helmcode/community-skills").badge, "helmcode");
  assert.deepEqual(skills.filter((s) => s.repo === "helmcode/community-skills").map((s) => s.id).sort(), ["building-a-beatdeck", "finops", "remotion-product-video"]);
});

test("packs: the four role packs, every id real", () => {
  assert.deepEqual(packs.map((p) => p.name), ["Superpowered workflow", "Frontend", "Product designer", "Backend"]);
  const ids = new Set(everything.map((x) => x.id));
  for (const p of packs) for (const id of p.ids) assert.ok(ids.has(id), `${p.name}: ${id}`);
});

test("nothing in the catalog holds a secret", () => {
  const all = ["agents", "mcp", "skills", "packs"].map((n) => readFileSync(new URL(`../catalog/${n}.json`, import.meta.url), "utf8")).join("");
  assert.doesNotMatch(all, /(ghp_|github_pat_|sk-[A-Za-z0-9]{10}|Bearer |api[_-]?key|secret)/i);
});

test("every server works without a secret: no keys, tokens or connection strings can be part of a one-line install", () => {
  for (const m of mcp) {
    if (m.transport === "http") {
      assert.ok(!/[?#]/.test(m.url), `${m.id}: a URL with a query string could carry a key`);
      assert.ok(!/@/.test(new URL(m.url).username + m.url.replace(/^https:\/\/[^/]*/, "")), `${m.id}: credentials in the URL`);
    } else {
      for (const t of m.cmd.split(" ")) {
        assert.ok(!/^--?(api-?key|token|secret|password|key)\b/i.test(t), `${m.id}: ${t} looks like a credential flag`);
        assert.ok(!/[A-Z][A-Z0-9_]{3,}=/.test(t), `${m.id}: ${t} looks like an env assignment`);
        assert.ok(!/^(postgres(ql)?|mongodb(\+srv)?|mysql|redis):\/\//.test(t), `${m.id}: a connection string`);
      }
    }
  }
});

test("servers that need a key, token or connection string are left out on purpose", () => {
  const ids = new Set(mcp.map((m) => m.id));
  for (const id of ["postgres", "mongodb", "firecrawl", "brave-search", "figma-context"]) assert.ok(!ids.has(id), `${id} needs a secret, so it cannot be a one-line install`);
});

test("servers and skills share one list of categories: each item is in at least one, some in several, none empty", () => {
  for (const [kind, list] of [["server", mcp], ["skill", skills]]) {
    for (const x of list) {
      assert.ok(x.cats && x.cats.length, `${kind} ${x.id} has no category`);
      assert.equal(new Set(x.cats).size, x.cats.length, `${kind} ${x.id} repeats a category`);
      for (const c of x.cats) assert.ok(categories[c], `${kind} ${x.id}: unknown category ${c}`);
    }
    assert.ok(list.some((x) => x.cats.length > 1), `one ${kind} can sit in several categories`);
  }
  for (const c of Object.keys(categories)) assert.ok([...mcp, ...skills].some((x) => x.cats.includes(c)), `category ${c} is empty`);
  assert.equal(read("catalog/skills.json").categories, undefined, "no second list of categories for skills");
});
