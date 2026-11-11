// Reading other catalogs' answers. The samples are cut down from what each API really sends.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCES } from "../core/catalogs.ts";

const by = (id: string) => SOURCES.find((s) => s.id === id)!;

test("skills.sh: a repo and a skill id make it installable", () => {
  const s = by("skills-sh");
  assert.match(s.url("react native"), /^https:\/\/skills\.sh\/api\/search\?q=react%20native/);
  const [a] = s.parse({ skills: [{ id: "vercel-labs/agent-skills/vercel-react-best-practices", source: "vercel-labs/agent-skills", skillId: "vercel-react-best-practices", name: "vercel-react-best-practices", installs: 888317 }] });
  assert.deepEqual(a.install, { type: "skill", repo: "vercel-labs/agent-skills", skill: "vercel-react-best-practices", path: "" });
  assert.equal(a.popularity, "888K installs");
  assert.equal(a.kind, "skill");
  assert.throws(() => s.parse({ error: "Query must be at least 2 characters" }));
});

test("SkillsMP: the GitHub link gives the repo and the folder", () => {
  const s = by("skillsmp");
  const [a, b] = s.parse({ success: true, data: { skills: [
    { id: "x", name: "telegram-e2e-userbot", author: "openclaw", description: "Prove it.", githubUrl: "https://github.com/openclaw/openclaw/tree/main/.agents/skills/telegram-e2e-userbot", skillUrl: "https://skillsmp.com/creators/openclaw", stars: 394204 },
    { id: "y", name: "odd", author: "someone", description: "", githubUrl: "", stars: 3 },
  ] } });
  assert.deepEqual(a.install, { type: "skill", repo: "openclaw/openclaw", skill: "telegram-e2e-userbot", path: ".agents/skills/telegram-e2e-userbot" });
  assert.equal(a.popularity, "394K stars");
  assert.equal(b.install, null);
  assert.ok(b.blocked);
});

test("MCP Registry: only an open HTTP remote can be installed from here", () => {
  const s = by("mcp-registry");
  const found = s.parse({ servers: [
    { server: { name: "com.notion/mcp", description: "Notion.", remotes: [{ type: "streamable-http", url: "https://mcp.notion.com/mcp" }, { type: "sse", url: "https://mcp.notion.com/sse" }] } },
    { server: { name: "ai.smithery/x", description: "Hosted.", remotes: [{ type: "streamable-http", url: "https://server.smithery.ai/@x/mcp", headers: [{ name: "Authorization", isRequired: true, isSecret: true }] }] } },
    { server: { name: "io.github.a/local", title: "Local One", description: "npm.", packages: [{ registryType: "npm" }], repository: { url: "https://github.com/a/local" } } },
    { server: { name: "ai.smithery/y", remotes: [{ type: "streamable-http", url: "https://server.smithery.ai/@y/mcp", headers: [{ name: "Authorization", value: "Bearer {smithery_api_key}", isSecret: true }] }] } },
    { server: { name: "com.tpl/x", remotes: [{ type: "streamable-http", url: "https://{tenant}.example.com/mcp" }] } },
  ] });
  assert.deepEqual(found[0].install, { type: "mcp", id: "com-notion-mcp", url: "https://mcp.notion.com/mcp" });
  assert.equal(found[0].name, "mcp");
  assert.equal(found[0].by, "com.notion");
  assert.match(found[1].blocked, /key/);
  assert.equal(found[2].name, "Local One");
  assert.match(found[2].blocked, /your computer/);
  assert.equal(found[2].page, "https://github.com/a/local");
  assert.equal(found[3].install, null, "a secret header means a key, required or not");
  assert.equal(found[4].install, null, "a URL with a placeholder is not usable as is");
});

test("Skills Directory: the repo, and the skill's folder out of the slug", () => {
  const s = by("skillsdirectory");
  assert.match(s.url("git"), /^https:\/\/www\.skillsdirectory\.com\/api\/registry\?q=git&limit=30$/);
  const [a, b] = s.parse({ registry: "skillsdirectory", skills: [
    { name: "Motion", slug: "terminalskills-motion", description: "Animation.", repository: "TerminalSkills/skills", author: "TerminalSkills", stars: 155, verified: false },
    { name: "Solo", slug: "solo", description: "", repository: "", author: "x", stars: 2, verified: true },
  ] });
  assert.deepEqual(a.install, { type: "skill", repo: "TerminalSkills/skills", skill: "motion", path: "" });
  assert.equal(a.popularity, "155 stars");
  assert.equal(b.install, null);
  assert.equal(b.popularity, "verified · 2 stars");
  assert.throws(() => s.parse({ error: "nope" }), /nope/);
});
