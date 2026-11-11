// Other catalogs the app can search, besides Tool up!'s own. Each one is a URL to ask and a way to read
// the answer; nothing here touches the network, so it is all tested against saved answers.
import { bareUrl } from "./server.ts";
import type { Kind } from "./types.ts";

/** One search result, in the same shape whatever catalog it came from. */
export interface Found {
  source: string;
  kind: Kind;
  id: string;
  name: string;
  /** Who publishes it: a GitHub repo for a skill, a namespace for a server. */
  by: string;
  description: string;
  /** "888K installs", "12K stars", or "". */
  popularity: string;
  /** Its page, to read more. */
  page: string;
  /** How to install it, or null when the app cannot (see `blocked`). */
  install: { type: "skill"; repo: string; skill: string; path: string } | { type: "mcp"; id: string; url: string } | null;
  /** Why it cannot be installed from here. */
  blocked: string;
}

export interface Source {
  id: string;
  name: string;
  kind: Kind;
  site: string;
  about: string;
  /** Says so when searches are limited without an API key. */
  keyNote?: string;
  /** The address to ask for a search. */
  url(q: string): string;
  /** Read the answer. Throws when it is not what this catalog normally sends. */
  parse(json: unknown): Found[];
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
export const compact = (n: unknown) => (typeof n !== "number" || !isFinite(n) ? "" : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const part = /^[A-Za-z0-9_.-]+$/;
const isRepo = (r: string) => { const p = r.split("/"); return p.length === 2 && p.every((x) => part.test(x) && x !== "." && x !== ".."); };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
const enc = encodeURIComponent;

const skillsSh: Source = {
  id: "skills-sh", name: "skills.sh", kind: "skill", site: "https://skills.sh",
  about: "The open skills directory, ranked by installs.",
  url: (q) => `https://skills.sh/api/search?q=${enc(q)}&limit=30`,
  parse(json) {
    const d = rec(json);
    if (!Array.isArray(d.skills)) throw new Error("skills.sh sent something unexpected.");
    return d.skills.map(rec).map((s): Found => {
      const repo = str(s.source), skill = str(s.skillId) || str(s.name), ok = isRepo(repo) && part.test(skill);
      return {
        source: "skills-sh", kind: "skill", id: str(s.id) || `${repo}/${skill}`, name: str(s.name) || skill, by: repo, description: "",
        popularity: compact(s.installs) && `${compact(s.installs)} installs`, page: `https://skills.sh/${str(s.id)}`,
        install: ok ? { type: "skill", repo, skill, path: "" } : null, blocked: ok ? "" : "Not on GitHub, so it can't be fetched from here.",
      };
    });
  },
};

const skillsMp: Source = {
  id: "skillsmp", name: "SkillsMP", kind: "skill", site: "https://skillsmp.com",
  about: "A large index of skills found on GitHub, ranked by stars.",
  keyNote: "Without an API key SkillsMP allows about 50 searches a day.",
  url: (q) => `https://skillsmp.com/api/v1/skills/search?q=${enc(q)}&limit=30&sortBy=stars`,
  parse(json) {
    const d = rec(rec(json).data);
    if (!Array.isArray(d.skills)) throw new Error(str(rec(rec(json).error).message) || str(rec(json).error) || "SkillsMP sent something unexpected.");
    return d.skills.map(rec).map((s): Found => {
      // https://github.com/<owner>/<repo>/tree/<branch>/<path to the skill folder>
      const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)(?:\/tree\/[^/]+\/(.+?))?\/?$/.exec(str(s.githubUrl));
      const repo = m?.[1] || "", path = m?.[2] || "", skill = path.split("/").pop() || str(s.name);
      const ok = isRepo(repo) && part.test(skill) && path.split("/").every((x) => !x || (part.test(x) && x !== ".."));
      return {
        source: "skillsmp", kind: "skill", id: str(s.id), name: str(s.name) || skill, by: repo || str(s.author), description: str(s.description),
        popularity: compact(s.stars) && `${compact(s.stars)} stars`, page: str(s.skillUrl),
        install: ok ? { type: "skill", repo, skill, path } : null, blocked: ok ? "" : "No GitHub folder listed, so it can't be fetched from here.",
      };
    });
  },
};

const skillsDirectory: Source = {
  id: "skillsdirectory", name: "Skills Directory", kind: "skill", site: "https://www.skillsdirectory.com",
  about: "A directory of skills on GitHub, with security checks on some of them.",
  url: (q) => `https://www.skillsdirectory.com/api/registry?q=${enc(q)}&limit=30`,
  parse(json) {
    const d = rec(json);
    if (!Array.isArray(d.skills)) throw new Error(str(d.error) || "Skills Directory sent something unexpected.");
    return d.skills.map(rec).map((s): Found => {
      const repo = str(s.repository), slug = str(s.slug), author = str(s.author).toLowerCase();
      // the slug is "<author>-<skill folder>"; a repo that is one skill has it at the top instead
      const skill = author && slug.startsWith(`${author}-`) ? slug.slice(author.length + 1) : slug;
      const ok = isRepo(repo) && part.test(skill);
      return {
        source: "skillsdirectory", kind: "skill", id: slug, name: str(s.name) || skill, by: repo || str(s.author), description: str(s.description),
        popularity: [s.verified === true ? "verified" : "", compact(s.stars) && `${compact(s.stars)} stars`].filter(Boolean).join(" · "),
        page: slug ? `https://www.skillsdirectory.com/skills/${slug}` : "",
        install: ok ? { type: "skill", repo, skill, path: "" } : null, blocked: ok ? "" : "No GitHub repository listed, so it can't be fetched from here.",
      };
    });
  },
};

const mcpRegistry: Source = {
  id: "mcp-registry", name: "MCP Registry", kind: "mcp", site: "https://registry.modelcontextprotocol.io",
  about: "The official registry of MCP servers. Anyone can publish there, so check who is behind a server.",
  url: (q) => `https://registry.modelcontextprotocol.io/v0/servers?search=${enc(q)}&limit=40&version=latest`,
  parse(json) {
    const d = rec(json);
    if (!Array.isArray(d.servers)) throw new Error("The MCP Registry sent something unexpected.");
    return d.servers.map((e) => rec(rec(e).server)).filter((s) => str(s.name)).map((s): Found => {
      const full = str(s.name), [ns, short] = full.includes("/") ? [full.slice(0, full.indexOf("/")), full.slice(full.indexOf("/") + 1)] : ["", full];
      const remotes = list(s.remotes).map(rec);
      // a remote the installer can add as is: plain HTTP, no header the user would have to fill in, no {placeholders}
      const open = remotes.find((r) => str(r.type) === "streamable-http" && !list(r.headers).some((h) => rec(h).isRequired || rec(h).isSecret || /[{}]/.test(str(rec(h).value))) && !/[{}]/.test(str(r.url)) && str(r.url).startsWith("https://") && bareUrl(str(r.url)));
      const blocked = open ? "" : remotes.length ? "Needs a key or a sign-up first: add it by hand." : "Runs on your computer and needs setting up: add it by hand.";
      return {
        source: "mcp-registry", kind: "mcp", id: full, name: str(s.title) || short, by: ns, description: str(s.description), popularity: "",
        page: str(rec(s.repository).url) || str(s.websiteUrl),
        install: open ? { type: "mcp", id: slug(full), url: str(open.url) } : null, blocked,
      };
    });
  },
};

export const SOURCES: Source[] = [skillsSh, skillsMp, skillsDirectory, mcpRegistry];

/** Catalogs that exist but need an account and a key (or a licence) before they can be asked anything. */
export const NOT_YET = [
  { name: "Smithery", why: "needs an API key" },
  { name: "Glama", why: "needs an API key, and its licence requires attribution on every page" },
  { name: "PulseMCP", why: "needs an API key" },
];
