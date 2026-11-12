// Reading an install command someone copied from a README or a web page, so the app can do what it says:
//   npx skills add owner/repo --skill name          a skill (or every skill in the repo)
//   claude mcp add --transport http name https://…   an MCP server (also codex, gemini, code --add-mcp, mcp-remote, add-mcp, or a JSON snippet)
//   /plugin marketplace add owner/repo               a plugin, with the list it comes from
//   /plugin install name@list
// Nothing here runs the command: it is only read, and the app's own installers do the work.
import { isRepo } from "./github.ts";

export type Pasted =
  /** Skills from a GitHub repo; `skills` empty means every skill the repo holds. */
  | { type: "skill"; repo: string; skills: string[] }
  /** A server reached at a web address. `secrets`: the command carried a key or a header, which is not copied. */
  | { type: "server"; name: string; url: string; secrets: boolean }
  /** A server that runs as a program on this computer: read, but the app cannot add those yet. */
  | { type: "local-server"; name: string }
  /** A plugin and the list (marketplace) it is in; `repo` is that list's GitHub repo when the paste said so. */
  | { type: "plugin"; plugin: string; market: string; repo: string | null }
  /** Only a plugin list was named, no plugin. */
  | { type: "market"; repo: string };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const NAME = /^[A-Za-z0-9_.-]+$/;

/** Shell words, with quotes honoured: `a "b c" 'd'` is three words. */
export function words(line: string): string[] {
  const out: string[] = [];
  let cur = "", quote = "", open = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = ""; else if (c === "\\" && quote === '"' && i + 1 < line.length) cur += line[++i]; else cur += c; }
    else if (c === '"' || c === "'") { quote = c; open = true; }
    else if (c === "\\" && i + 1 < line.length) { cur += line[++i]; open = true; }
    else if (/\s/.test(c)) { if (open || cur) out.push(cur); cur = ""; open = false; }
    else cur += c;
  }
  if (open || cur) out.push(cur);
  return out;
}

/** "owner/repo", from that, from "owner/repo@skill", or from a GitHub address (with the folder inside it, if any). */
function repoOf(src: string): { repo: string; skill: string } | null {
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/(?:tree|blob)\/[^/]+\/(.+?))?\/?(?:[#?].*)?$/.exec(src);
  if (url) {
    const repo = `${url[1]}/${url[2]}`, folder = (url[3] || "").replace(/\/SKILL\.md$/, "").split("/").pop() || "";
    return isRepo(repo) ? { repo, skill: NAME.test(folder) ? folder : "" } : null;
  }
  const [repo, skill = ""] = src.split("@");
  return isRepo(repo) && !repo.startsWith("-") && (!skill || NAME.test(skill)) ? { repo, skill } : null;
}

const isUrl = (s: string) => /^https?:\/\/[^\s]+$/.test(s);
/** A name for a server that came without one: the middle of its host ("mcp.sentry.dev" → "sentry"). */
function nameFor(url: string): string {
  try {
    const parts = new URL(url).hostname.split(".").filter((p) => !["www", "mcp", "api"].includes(p));
    return (parts.length > 1 ? parts[parts.length - 2] : parts[0]) || "server";
  } catch { return "server"; }
}
/** The server a JSON entry describes: `{url}` (or httpUrl, serverUrl) is remote, `{command}` runs here. */
function fromEntry(name: string, entry: unknown): Pasted | null {
  const e = rec(entry), url = str(e.url) || str(e.httpUrl) || str(e.serverUrl);
  const carries = (v: unknown) => Object.keys(rec(v)).length > 0;
  if (isUrl(url)) return { type: "server", name: name || nameFor(url), url, secrets: carries(e.headers) || carries(e.env) };
  if (str(e.command)) return { type: "local-server", name: name || str(e.command) };
  return null;
}
/** A settings snippet: {"mcpServers": {"name": {…}}} (or "servers"), {"name": "…", "url": "…"}, or one bare entry. */
function fromJson(text: string): Pasted | null {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  const d = rec(j), group = rec(d.mcpServers ?? d.servers);
  for (const [name, entry] of Object.entries(group)) { const got = fromEntry(name, entry); if (got) return got; }
  return fromEntry(str(d.name), d);
}

/** Flags that take a value, so the word after them is not the server's name or address. */
const VALUED = new Set(["--transport", "-t", "--scope", "-s", "--env", "-e", "--header", "-H", "--name", "-n", "--agent", "-a", "--bearer-token-env-var", "--trust", "--timeout", "--description", "--include-tools", "--exclude-tools"]);
const SECRET = new Set(["--env", "-e", "--header", "-H", "--bearer-token-env-var"]);

/** `… mcp add [flags] name target… [-- command…]`, as claude, codex and gemini all write it. */
function mcpAdd(args: string[]): Pasted | null {
  const plain: string[] = [];
  let url = "", name = "", secrets = false, local = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") { local = args.length > i + 1; break; }
    const eq = a.startsWith("--") && a.includes("=") ? a.slice(0, a.indexOf("=")) : "";
    if (SECRET.has(a) || SECRET.has(eq)) secrets = true;
    if (a === "--url") { url = args[++i] || ""; continue; }
    if (eq === "--url") { url = a.slice(6); continue; }
    if (a === "--name" || a === "-n") { name = args[++i] || ""; continue; }
    if (VALUED.has(a)) { i++; continue; }
    if (a.startsWith("-")) continue;
    plain.push(a);
  }
  name = name || plain.find((p) => !isUrl(p)) || "";
  url = url || plain.find(isUrl) || "";
  if (url && isUrl(url)) return { type: "server", name: name || nameFor(url), url, secrets };
  return name && (local || plain.length > 1) ? { type: "local-server", name } : null;
}

function readLine(w: string[]): Pasted | null {
  const at = (...seq: string[]) => { for (let i = 0; i + seq.length <= w.length; i++) if (seq.every((s, k) => w[i + k] === s)) return i + seq.length; return -1; };
  let i: number;
  // plugins: "/plugin install name@list", "claude plugin install name@list", "/plugin marketplace add owner/repo"
  const plug = w.findIndex((x) => x === "/plugin" || x === "plugin" || x === "plugins");
  if (plug >= 0 && w[plug + 1] === "marketplace" && w[plug + 2] === "add") {
    const r = repoOf(w[plug + 3] || "");
    return r ? { type: "market", repo: r.repo } : null;
  }
  if (plug >= 0 && w[plug + 1] === "install") {
    const [plugin, market = ""] = (w.slice(plug + 2).find((x) => !x.startsWith("-")) || "").split("@");
    return NAME.test(plugin) && (!market || NAME.test(market)) ? { type: "plugin", plugin, market, repo: null } : null;
  }
  // skills: "npx skills add owner/repo --skill a b", "npx -y skills@latest add https://github.com/owner/repo"
  i = w.findIndex((x, k) => /^(?:skills|add-skill)(?:@.+)?$/.test(x) && (x.startsWith("add-skill") || w[k + 1] === "add"));
  if (i >= 0) {
    const args = w.slice(i + (w[i].startsWith("add-skill") ? 1 : 2)), skills: string[] = [];
    let src: { repo: string; skill: string } | null = null;
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (a === "--skill" || a === "-s") { while (args[k + 1] && !args[k + 1].startsWith("-")) skills.push(args[++k]); continue; }
      if (a.startsWith("--skill=")) { skills.push(a.slice(8)); continue; }
      if (a === "--agent" || a === "-a") { while (args[k + 1] && !args[k + 1].startsWith("-")) k++; continue; }
      if (!a.startsWith("-") && !src) src = repoOf(a);
    }
    if (!src) return null;
    const all = skills.includes("*") ? [] : [...new Set([...(src.skill ? [src.skill] : []), ...skills])];
    return all.every((s) => NAME.test(s)) ? { type: "skill", repo: src.repo, skills: all } : null;
  }
  // servers
  if ((i = at("mcp", "add-json")) >= 0) return fromEntry(w[i] || "", (() => { try { return JSON.parse(w[i + 1] || ""); } catch { return null; } })());
  if ((i = at("mcp", "add")) >= 0) return mcpAdd(w.slice(i));
  if ((i = at("--add-mcp")) >= 0) return fromJson(w[i] || "");
  i = w.findIndex((x) => /^add-mcp(?:@.+)?$/.test(x));
  if (i >= 0) return mcpAdd(w.slice(i + 1));
  i = w.findIndex((x) => /^mcp-remote(?:@.+)?$/.test(x));
  if (i >= 0) { const url = w.slice(i + 1).find(isUrl); return url ? { type: "server", name: nameFor(url), url, secrets: w.includes("--header") } : null; }
  return null;
}

/**
 * A GitHub repository given by its address (and, when `loose`, as plain owner/repo): its skills, to pick from.
 * An address that points at one skill's folder names that skill.
 */
export function githubSkills(text: string, loose = false): Pasted | null {
  const t = text.trim();
  if (!t || /\s/.test(t) || (!loose && !/^(?:https?:\/\/)?(?:www\.)?github\.com\//i.test(t))) return null;
  const r = repoOf(t);
  return r ? { type: "skill", repo: r.repo, skills: r.skill ? [r.skill] : [] } : null;
}

/**
 * What a pasted piece of text asks for, or null when it is not an install command (so a normal paste goes ahead).
 * Several lines are read together: a plugin's "marketplace add" line tells where its "install" line's list lives.
 */
export function parsePaste(text: string): Pasted | null {
  const t = text.trim();
  if (!t || t.length > 20000) return null;
  if (t.startsWith("{")) return fromJson(t);
  const repo = githubSkills(t);
  if (repo) return repo;
  const lines = t.replace(/\\\r?\n/g, " ").split(/\r?\n|&&|;/).map((l) => l.trim().replace(/^(?:[$>#]\s+)+/, "")).filter(Boolean).slice(0, 20);
  const got = lines.map((l) => readLine(words(l))).filter((p): p is Pasted => !!p);
  const plugin = got.find((p) => p.type === "plugin"), market = got.find((p) => p.type === "market");
  if (plugin && plugin.type === "plugin") return { ...plugin, repo: market && market.type === "market" ? market.repo : null };
  return got[0] || null;
}
