// Network checks, run by .github/workflows/verify.yml (and by hand: npm run verify):
//   1. every skill id exists in its repo, per `npx skills add <repo> --list`
//   2. every remote MCP URL answers an MCP initialize request
// Exits 1 on a hard failure. A server whose sign-in model changed (401 vs 200) is only a warning.
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const root = new URL("..", import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, root), "utf8"));
const { skills } = await read("catalog/skills.json");
const mcp = await read("catalog/mcp.json");
const only = process.argv[2]; // "skills" or "mcp" to run one half
let failed = 0;
const fail = (m) => { failed++; console.log(`::error::${m}`); };
const warn = (m) => console.log(`::warning::${m}`);

async function listRepo(repo, home) {
  const { stdout, stderr } = await run("npx", ["-y", "skills", "add", repo, "--list"], {
    env: { ...process.env, HOME: home, NO_COLOR: "1", CI: "1" }, timeout: 180000, maxBuffer: 1 << 24,
  });
  const text = (stdout + stderr).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  return new Set([...text.matchAll(/^│ {4}([a-z0-9][\w.-]*)\s*$/gm)].map((m) => m[1]));
}

async function checkSkills() {
  const home = await mkdtemp(join(tmpdir(), "kitem-verify-"));
  const byRepo = Map.groupBy(skills, (s) => s.repo);
  const queue = [...byRepo];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let item; (item = queue.shift()); ) {
      const [repo, wanted] = item;
      try {
        const have = await listRepo(repo, home);
        if (have.size === 0) { fail(`${repo}: \`skills add --list\` printed no skills`); continue; }
        const missing = wanted.filter((s) => !have.has(s.id)).map((s) => s.id);
        if (missing.length) fail(`${repo} has no skill named ${missing.join(", ")} (it lists ${have.size})`);
        else console.log(`ok   ${repo}: ${wanted.map((s) => s.id).join(", ")}`);
      } catch (e) { fail(`${repo}: ${String(e.message).split("\n")[0]}`); }
    }
  }));
}

async function checkMcp() {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "kitenm-verify", version: "0" } } });
  await Promise.all(mcp.filter((m) => m.transport === "http").map(async (m) => {
    try {
      let res, err;
      for (let attempt = 0; attempt < 3 && !res; attempt++) {   // a slow or flaky host gets three tries before it counts as down
        try { res = await fetch(m.url, { method: "POST", body, redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "kitenm-sh-verify" } }); }
        catch (e) { err = e; }
      }
      if (!res) throw err;
      await res.body?.cancel();
      if (res.status === 404 || res.status >= 500) return fail(`${m.id}: ${m.url} answered HTTP ${res.status}`);
      const expected = m.auth === "oauth" ? 401 : 200;
      if (res.status !== expected) warn(`${m.id}: expected HTTP ${expected} for auth "${m.auth}", got ${res.status}`);
      console.log(`ok   ${m.id}: HTTP ${res.status} ${m.url}`);
    } catch (e) { fail(`${m.id}: ${m.url} did not answer (${e.cause?.code || e.message})`); }
  }));
}

if (only !== "mcp") await checkSkills();
if (only !== "skills") await checkMcp();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
