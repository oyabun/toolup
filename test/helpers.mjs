// Runs the installer against stand-in agent CLIs (test/stubs) in a throwaway HOME, so the real
// script is exercised end to end without touching the machine.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, readdirSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const script = fileURLToPath(new URL("../src/install.sh", import.meta.url));
// The installer still knows local (npx / uvx) servers and Docker, though the site now lists only remote ones, so its tests run
// against a small catalog of their own that includes a few of each.
export const catalogUrl = new URL("./fixtures/catalog.tsv", import.meta.url).href;
const stubs = fileURLToPath(new URL("./stubs", import.meta.url));

// A machine with the given agents installed ("claude", "codex", "gemini", "code", "cursor").
export const realCatalogUrl = new URL("../public/catalog.tsv", import.meta.url).href;
// The agents found by a folder in the home directory (the later additions): name them in `agents` to have them present.
export const MORE_AGENTS = { windsurf: ".codeium/windsurf", cline: ".cline", "qwen-code": ".qwen", "deepseek-harness": ".dsh", openclaw: ".openclaw", goose: ".config/goose", kiro: ".kiro", pi: ".pi/agent", hermes: ".hermes" };
export const EVERY_AGENT = ["claude", "codex", "gemini", "code", "cursor", ...Object.keys(MORE_AGENTS)];
export function machine(agents = ["claude", "codex", "gemini", "code", "cursor"], { real = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kitem-"));
  const home = join(dir, "home"), state = join(dir, "state"), bin = join(dir, "bin");
  spawnSync("mkdir", ["-p", home, state, bin]);
  for (const a of ["claude", "codex", "gemini", "code"]) if (agents.includes(a)) spawnSync("ln", ["-s", join(stubs, a), join(bin, a)]);
  for (const s of ["npx", "uvx", "docker"]) spawnSync("ln", ["-s", join(stubs, s), join(bin, s)]);
  // an agent found by its folder is one whose folder holds something of its own, not just skills
  const own = (d) => spawnSync("mkdir", ["-p", join(home, d, "state")]);
  if (agents.includes("cursor")) own(".cursor");
  for (const [a, d] of Object.entries(MORE_AGENTS)) if (agents.includes(a)) own(d);
  const path = `${bin}:${process.env.PATH}`;
  const run = (...args) => {
    const t = Date.now();
    const r = spawnSync("bash", [script, ...args], {
      encoding: "utf8", timeout: 60000,
      env: { PATH: path, HOME: home, STUB_STATE: state, CATALOG_URL: real ? realCatalogUrl : catalogUrl, NO_COLOR: "1", LANG: "C.UTF-8" },
    });
    return { code: r.status, out: r.stdout + r.stderr, stdout: r.stdout, ms: Date.now() - t };
  };
  const calls = () => (existsSync(join(state, "calls.log")) ? readFileSync(join(state, "calls.log"), "utf8").trim().split("\n") : []);
  // Everything a run could have changed, as one comparable string.
  const snapshot = () => {
    const out = [];
    const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); out.push(p.slice(dir.length) + (lstatSync(p).isSymbolicLink() ? " ->" : "")); if (lstatSync(p).isDirectory()) walk(p); } };
    walk(home); walk(state.replace(/state$/, "state"));
    for (const f of ["home/.cursor/mcp.json", "home/.config/Code/User/mcp.json", "home/.gemini/settings.json"]) if (existsSync(join(dir, f))) out.push(readFileSync(join(dir, f), "utf8"));
    return out.filter((l) => !l.endsWith("calls.log")).join("\n");
  };
  return { dir, home, state, run, calls, snapshot };
}

export const lines = (out, mark) => out.split("\n").filter((l) => l.trim().startsWith(mark)).map((l) => l.trim().slice(mark.length).trim());
