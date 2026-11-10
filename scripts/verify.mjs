// Network checks, run by .github/workflows/verify.yml (and by hand: npm run verify):
//   1. every skill id exists in its repo, per `npx skills add <repo> --list`
//   2. every remote MCP URL answers an MCP initialize request
//   3. every local MCP server starts and answers an MCP initialize request
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
const only = process.argv[2]; // "skills", "mcp" (remote URLs) or "stdio" (local servers) to run one part
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
  const home = await mkdtemp(join(tmpdir(), "toolup-verify-"));
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
        try { res = await fetch(m.url, { method: "POST", body, redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "toolup-sh-verify" } }); }
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

// Local servers: start each one the way an agent will and send an MCP `initialize`. A package that was renamed, pulled or
// broken fails here the same way a dead URL fails above. Needs npx and uvx (CI installs uv).
async function checkStdio() {
  const { spawn } = await import("node:child_process");
  const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "kitenm-verify", version: "0" } } }) + "\n";
  const probe = (m) => new Promise((resolve) => {
    const [bin, ...args] = m.cmd.replaceAll("$HOME", process.env.HOME).split(" ");
    const p = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(t); p.kill("SIGKILL"); resolve(r); };
    const t = setTimeout(() => finish(`no answer in 180s ${err.slice(-160).replace(/\s+/g, " ")}`), 180000);
    p.stdout.on("data", (d) => { out += d; if (/"protocolVersion"/.test(out) && /"result"/.test(out)) finish(null); });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => finish(e.message));
    p.on("exit", (c) => finish(`exited ${c} ${err.slice(-160).replace(/\s+/g, " ")}`));
    p.stdin.write(init);
  });
  const queue = mcp.filter((m) => m.transport === "stdio");
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let m; (m = queue.shift()); ) {
      const why = await probe(m);
      if (why) fail(`${m.id}: \`${m.cmd}\` did not answer an MCP initialize (${why})`); else console.log(`ok   ${m.id}: started and answered (${m.cmd})`);
    }
  }));
}

if (only === undefined || only === "skills") await checkSkills();
if (only === undefined || only === "mcp") await checkMcp();
if (only === undefined || only === "stdio") await checkStdio();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
