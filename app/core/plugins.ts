// Plugins: bundles of skills and connectors (MCP servers) published in a "marketplace", a GitHub repo with a list
// of plugins. Claude Code and Codex both have plugins, and Codex reads Claude-style marketplaces. The other agents
// have no such thing, but a plugin's skills are ordinary skills, so those can be turned on for them.
// Nothing here touches the network.
import { isRepo } from "./github.ts";

export interface Market { repo: string; title: string; by: string }
export const MARKETS: Market[] = [{ repo: "anthropics/knowledge-work-plugins", title: "Knowledge work plugins", by: "Anthropic" }];

export interface Plugin {
  /** The marketplace repo it is listed in, and the name that marketplace gives itself. */
  market: string;
  marketName: string;
  name: string;
  title: string;
  description: string;
  category: string;
  homepage: string;
  /** The GitHub repo and folder holding the plugin's files; repo is null when they are somewhere we cannot read. */
  repo: string | null;
  path: string;
  /** Kept in the marketplace's own repo (written by its owner), not linked from someone else's. */
  own: boolean;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const cleanPath = (p: string) => p.replace(/^\.?\/+|\/+$/g, "");
const safePath = (p: string) => p.split("/").every((s) => !s || (/^[A-Za-z0-9_.-]+$/.test(s) && s !== ".."));

export const marketUrl = (repo: string) => `https://raw.githubusercontent.com/${repo}/HEAD/.claude-plugin/marketplace.json`;
export const treeUrl = (repo: string) => `https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`;
export const connectorsUrl = (repo: string, path: string) => `https://raw.githubusercontent.com/${repo}/HEAD/${path ? `${path}/` : ""}.mcp.json`;

/** The plugins a marketplace lists. Throws when the file is not a marketplace. */
export function parseMarket(repo: string, json: unknown): { name: string; plugins: Plugin[] } {
  const d = rec(json);
  if (!Array.isArray(d.plugins) || !/^[A-Za-z0-9_.-]+$/.test(str(d.name))) throw new Error("That repository is not a plugin marketplace.");
  const plugins = d.plugins.map(rec).filter((p) => /^[A-Za-z0-9_.-]+$/.test(str(p.name))).map((p): Plugin => {
    const src = p.source;
    let where: { repo: string | null; path: string; own: boolean };
    if (typeof src === "string") where = { repo, path: cleanPath(src), own: true };
    else {
      const s = rec(src), m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(str(s.url)), named = str(s.repo);
      const r = m ? m[1] : isRepo(named) ? named : null;
      where = { repo: r && isRepo(r) ? r : null, path: cleanPath(str(s.path)), own: false };
    }
    if (!safePath(where.path)) where = { ...where, repo: null, path: "" };
    return { market: repo, marketName: str(d.name), name: str(p.name), title: str(p.displayName) || str(p.name), description: str(p.description), category: str(p.category), homepage: str(p.homepage), ...where };
  });
  return { name: str(d.name), plugins };
}

/** From a repo's file list (GitHub's tree answer), the folders of the skills inside a plugin's folder. */
export function pluginSkills(tree: unknown, path: string): string[] {
  const list = rec(tree).tree;
  if (!Array.isArray(list)) throw new Error(str(rec(tree).message) || "GitHub did not list the repository's files.");
  const prefix = path ? `${path}/` : "";
  return list.map((e) => str(rec(e).path)).filter((p) => p.startsWith(prefix) && /^(?:skills\/)?[^/]+\/SKILL\.md$/.test(p.slice(prefix.length)) && safePath(p))
    .map((p) => p.slice(0, -"/SKILL.md".length)).sort();
}

/** From a repo's file list, every folder that holds a skill, wherever it sits; one per folder name (the first wins). */
export function repoSkills(tree: unknown): string[] {
  const list = rec(tree).tree;
  if (!Array.isArray(list)) throw new Error(str(rec(tree).message) || "GitHub did not list the repository's files.");
  const seen = new Set<string>();
  return list.map((e) => str(rec(e).path)).filter((p) => /^.+\/SKILL\.md$/.test(p) && safePath(p) && !p.split("/").some((x) => x.startsWith("-")))
    .map((p) => p.slice(0, -"/SKILL.md".length)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .filter((p) => { const name = p.split("/").pop()!; return seen.has(name) ? false : !!seen.add(name); });
}

/** The connectors a plugin's .mcp.json names: each one's name and the host it talks to. */
export function parseConnectors(json: unknown): { name: string; host: string }[] {
  return Object.entries(rec(rec(json).mcpServers)).map(([name, v]) => {
    let host = "";
    try { host = new URL(str(rec(v).url)).host; } catch { /* a local command: no host to show */ }
    return { name, host };
  });
}

export interface InstalledPlugin {
  /** "name@marketplace", as Claude Code records it. */
  id: string;
  name: string;
  market: string;
  version: string;
  /** Where its files are on this computer, when recorded. */
  path: string;
  /** The agents that have it. */
  agents: string[];
}
/** The agents that have plugins of their own. */
export const PLUGIN_AGENTS = ["claude-code", "codex"];
/** Claude Code's list of installed plugins (~/.claude/plugins/installed_plugins.json). Anything unexpected is skipped. */
export function parseInstalledPlugins(text: string | null): InstalledPlugin[] {
  if (!text) return [];
  let d: unknown;
  try { d = JSON.parse(text); } catch { return []; }
  return Object.entries(rec(rec(d).plugins)).map(([id, v]) => {
    const first = rec(Array.isArray(v) ? v[0] : v), at = id.lastIndexOf("@");
    return { id, name: at > 0 ? id.slice(0, at) : id, market: at > 0 ? id.slice(at + 1) : "", version: str(first.version), path: str(first.installPath), agents: ["claude-code"] };
  }).filter((p) => p.name).sort((a, b) => a.name.localeCompare(b.name));
}

/** Codex's plugins: the `[plugins."name@marketplace"]` tables of ~/.codex/config.toml (already parsed) that are not switched off. */
export function parseCodexPlugins(config: unknown): InstalledPlugin[] {
  return Object.entries(rec(rec(config).plugins)).filter(([, v]) => rec(v).enabled !== false).map(([id]) => {
    const at = id.lastIndexOf("@");
    return { id, name: at > 0 ? id.slice(0, at) : id, market: at > 0 ? id.slice(at + 1) : "", version: "", path: "", agents: ["codex"] };
  }).filter((p) => p.name);
}

/** One row per plugin, however many agents have it. */
export function mergePlugins(...lists: InstalledPlugin[][]): InstalledPlugin[] {
  const by = new Map<string, InstalledPlugin>();
  for (const p of lists.flat()) {
    const have = by.get(p.id);
    if (have) { have.agents = [...new Set([...have.agents, ...p.agents])]; have.version ||= p.version; have.path ||= p.path; }
    else by.set(p.id, { ...p });
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}
