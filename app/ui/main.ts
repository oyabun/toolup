// The window. Two views over the same machine:
//   Installed  one row per MCP server or skill, one column per agent; an empty cell is a gap you can fill
//   Catalog    the Tool up! catalog as cards, to pick from and install
// Installing always goes through the Tool up! installer, and always shows what it will do first.
import catalogJson from "../../public/catalog.json";
import detailsJson from "../../catalog/details.json";
import { SOURCES, type Found } from "../core/catalogs.ts";
import { expand, ownSkillsDir, SKILL_STORE, takesServers } from "../core/harnesses.ts";
import { latestCommitUrl, parseLatestCommit, repoUrl } from "../core/github.ts";
import { connectorsUrl, MARKETS, marketUrl, parseConnectors, parseMarket, PLUGIN_AGENTS, pluginSkills, repoSkills, treeUrl, type Plugin } from "../core/plugins.ts";
import { githubSkills, parsePaste, type Pasted } from "../core/paste.ts";
import { bareUrl, normalize, parseJsonc } from "../core/server.ts";
import { scanSkill, worst, type Finding } from "../core/safety.ts";
import { listen } from "@tauri-apps/api/event";
import { parse as parseToml } from "smol-toml";
import { frontMatter, scan } from "../core/scan.ts";
import type { Catalog, HarnessReport, Inventory, Item } from "../core/types.ts";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { claudePlugin, codexMarketplace, parkSkill, fetchSkills, openUrl, reveal, fetchJson, fetchSkill, inspectSkill, installSkill, linkSkill, removeSkill, toolup, toolupServers, toolupRemove, skillTexts, writeText, copySkill, backupStore, startLinks, pickFolder, openTerminal } from "./actions.ts";
import { inTauri, tauriHost } from "./host-tauri.ts";
import { columns, rows, type Tab, type View } from "./model.ts";
import { AGENT_MARKS } from "./agent-marks.ts";
import { getAgentUrl } from "./agent-links.ts";
import { COVERS } from "./covers.ts";
import { coolIcon } from "./icons.ts";
import { sample } from "./sample.ts";
import { MEADOW, SCENE, type Spot } from "./meadow.ts";
import { mountMeadow } from "./meadow-live.ts";
import { mdDoc, mdLine } from "../core/md.ts";

interface Icon { svg?: string; path?: string; stroke?: string; color?: string; generic?: boolean }
interface Listed { id: string; name: string; chip?: string; by?: string; repo?: string; ds?: string; cats?: string[]; transport?: string; auth?: string; installs?: number; icon: Icon; sec: "mcp" | "skill" }
interface Pack { name: string; ds: string; ids: string[] }
const catalog = catalogJson as unknown as Catalog;
const raw = catalogJson as unknown as { agents: Listed[]; mcp: Listed[]; skills: Listed[]; categories: Record<string, string>; packs: Pack[] };
const cards: Listed[] = [...raw.mcp.map((x) => ({ ...x, sec: "mcp" as const })), ...raw.skills.map((x) => ({ ...x, sec: "skill" as const }))];
const listed = new Map(cards.map((x) => [x.id, x]));
const agents = new Map(raw.agents.map((a) => [a.id, a]));
/** Whether servers can be added to this agent; some get skills only (see core/harnesses.ts). */
const serves = (id: string) => { const a = catalog.agents.find((x) => x.id === id); return !!a && takesServers(a); };
const PAGE = 24;
// the same facts for every catalog item, read from its GitHub repo by scripts/details.mjs
interface More { kind: string; repo: string | null; path: string | null; stars: number; license: string; updated: string; homepage: string; about: string; examples: string[]; images: { src: string; alt: string }[] }
const more = detailsJson as unknown as Record<string, More>;

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
const fmt = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

const GLYPH: Record<string, string> = {
  down: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  move: '<path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
  all: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  mcp: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
  skill: '<path d="M12 5v16"/><path d="M20 19A2 2 0 0 0 22 17V5a2 2 0 0 0-2-2l-4 0a5 5 0 0 0-4 2 5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4a5 5 0 0 1 4 2 5 5 0 0 1 4-2z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  warn: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  dots: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  github: '<path fill="currentColor" stroke="none" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>',   // GitHub's mark (Simple Icons, CC0), for what leads to a repository
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
};
const glyph = (k: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[k]}</svg>`;

// logos, drawn the way the site draws them: a square tile for a server or an agent, a round one for a skill
function light(hex = "#888") {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.62;
}
function logo(icon: Icon, cls = "") {
  if (icon.svg) return `<span class="ico brand ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24">${icon.svg}</svg></span>`;
  const inner = icon.path ? `<path d="${icon.path}" fill="currentColor"/>` : `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon.stroke}</g>`;
  return `<span class="ico ${cls}" style="background:${icon.color};color:${light(icon.color) ? "#16161a" : "#fff"}" aria-hidden="true"><svg viewBox="0 0 24 24">${inner}</svg></span>`;
}
function initial(name: string, seed: string, cls: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="ico initial ${cls}" style="background:hsl(${h} 42% 42%)" aria-hidden="true">${esc(name.trim()[0]?.toUpperCase() || "?")}</span>`;
}
/** An agent's logo as a bare one-colour mark. */
const mono = (id: string, icon: Icon) => `<svg class="mono" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true">${AGENT_MARKS[id] || (icon.path ? `<path d="${icon.path}"/>` : `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon.stroke || ""}</g>`)}</svg>`;
const shape = (kind: string) => (kind === "skill" ? "round" : "");
const kindGlyph = (kind: string) => (kind === "skill" ? "book-open" : "cat-mcp");
const cardLogo = (x: Listed, cls = "") => (x.icon.generic ? coolIcon(x.name, x.ds || "", x.cats?.[0], kindGlyph(x.sec), `${shape(x.sec)} ${cls}`) : logo(x.icon, `${shape(x.sec)} ${cls}`));
// in the Installed list, something without a brand logo gets a quiet symbol for its kind (letters there look like people)
function itemLogo(i: Item, cls = "") {
  const known = i.catalogId ? listed.get(i.catalogId) : undefined;
  return known ? cardLogo(known, cls) : coolIcon(i.name, i.description || "", undefined, kindGlyph(i.kind), `${shape(i.kind)} ${cls}`);
}
const kindBadge = (k: "mcp" | "skill") => `<span class="kind kb-${k}">${glyph(k)}${k === "mcp" ? "MCP" : "Skill"}</span>`;

/* ---------- state ---------- */
type Screen = "installed" | "catalog" | "projects" | "settings";
interface Step { logo: string; title: string; detail: string; state: "todo" | "skip" | "done" | "fail" | "info";
  /** Set on a step the user can leave out: what to hand to the sheet's `pick` when its box is ticked or cleared. */
  pick?: string; picked?: boolean }
/** The one dialog every change goes through: it lists what will happen, then what did. */
interface Sheet {
  /** The question asked: "Install 3 items?" */
  title: string;
  sub: string;
  /** The button that goes ahead. */
  confirm: string;
  danger: boolean;
  phase: "preview" | "ready" | "running" | "done" | "failed";
  steps: Step[];
  note: string;
  /** What the installer printed; only offered when something failed. */
  log: string;
  /** Folders and links, for whoever wants them: shown only when "Details" is opened. */
  tech: string[];
  /** Nothing to do: only Close is offered. */
  idle: boolean;
  fromTray: boolean;
  /** Catalog items this sheet installs, when they can be kept as a preset (a "Save as preset…" link is offered). */
  presetIds?: string[];
  /** Nothing worth reading afterwards: the dialog closes itself once it has worked. */
  closeWhenDone?: boolean;
  /** The agents this applies to, when the user can turn each one on or off here. */
  targets: Set<string> | null;
  /** A web page worth offering beside the buttons. */
  link: { label: string; url: string } | null;
  /** A choice the user can make before going ahead: [value, label, what it means]. */
  choice: { value: string; options: [string, string, string][] } | null;
  /** A step's box was ticked or cleared (`id`), or all of them at once (`all`: true ticks, false clears). */
  pick?: (id: string | null, all?: boolean) => void;
  /** Work out the steps (again, when the choice changes). Changes nothing on the machine. */
  prepare: (s: Sheet) => Promise<void>;
  /** Do it. True when all of it worked. */
  run: (s: Sheet) => Promise<boolean>;
}
let inv: Inventory | null = null, failed = "";
const demo = !inTauri();
let screen: Screen = "installed", q = "";
const view: View = { tab: "all", q: "" };   // the Installed grid
const shop = { tab: "all" as Tab, cat: "", page: PAGE, detail: "", pack: -1, plugin: "", list: "", coll: "" };   // the Catalog: the category and kind being browsed, the pack and the item whose page is open
// other catalogs: which are switched on (Settings), and the search in the one being looked at
const saved = (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: it lasts until the window closes */ } };
// which sources the Catalog looks in; Tool up!'s own list unless the user has chosen otherwise
const enabled = new Set((saved("toolup.sources.v2") || `${saved("toolup.sources") || "toolup"},plugins`).split(",").filter((id) => id === "toolup" || id === "plugins" || SOURCES.some((s) => s.id === id)));
// plugins: the marketplace's list (fetched once), each repo's skill folders and each plugin's connectors (fetched when a plugin is opened)
const MARKET = MARKETS[0];
let market: { state: "idle" | "loading" | "ok" | "error"; name: string; plugins: Plugin[]; error: string } = { state: "idle", name: "", plugins: [], error: "" };
const trees: Record<string, { state: "loading" | "ok" | "error"; json: unknown; error: string }> = {};
const connectors: Record<string, { name: string; host: string }[] | "loading"> = {};
let detailDoc: { id: string; state: "loading" | "ok" | "error"; text: string } | null = null;
type ExtState = { state: "loading" | "ok" | "error"; items: Found[]; error: string };
// how a new skill is installed: one shared copy that agents link to, or a copy for each agent (Settings; can be changed per install)
let skillMode = saved("toolup.skill-mode") === "copy" ? "copy" : "link";
const SKILL_MODES: [string, string, string][] = [
  ["link", "One shared copy", "Recommended. Every agent uses the same skill, so an update or a delete happens once."],
  ["copy", "A copy for each agent", "Each agent gets its own. Changing one does not change the others."],
];
let ext: Record<string, ExtState> = {};
let searchTimer = 0, searchSeq = 0;
const picked = new Set<string>();
let into: Set<string> | null = null;                           // agents to install into; null until the first scan
let sheet: Sheet | null = null, home = "";
let menuAt = 0;
let menu: { key: string; x: number; y: number } | null = null;   // the row menu that is open, and where
const app = document.querySelector<HTMLDivElement>("#app")!;

// agents the user has switched off in Settings: installed, but left out of everything Tool up! shows and does
const agentsOff = new Set(saved("toolup.agents-off").split(",").filter(Boolean));
const cols = () => (inv ? columns(inv).filter((h) => !agentsOff.has(h.id)) : []);
/** Which installed agents already have a catalog item. */
function haveIt(id: string): string[] {
  const item = inv?.items.find((i) => i.catalogId === id);
  return item ? cols().filter((h) => item.in[h.id]).map((h) => h.id) : [];
}

/* ---------- Installed ---------- */
// One row per skill or server, and on that row a labelled switch for each agent.
function agentSwitch(i: Item, h: HarnessReport) {
  const a = agents.get(h.id), on = !!i.in[h.id];
  const busy = flipping.has(`${i.key}|${h.id}`);
  const make = (act: string, title: string) => `<button class="swt${busy ? " busy" : ""}" type="button" role="switch" aria-checked="${on}" ${busy ? 'aria-busy="true"' : ""} ${act || 'aria-disabled="true"'} title="${esc(title)}" aria-label="${esc(h.name)}">${a ? mono(h.id, a.icon) : `<span>${esc(h.name.slice(0, 2))}</span>`}</button>`;
  if (i.kind === "skill") return on
    ? make(`data-unskill="${esc(i.key)}" data-from="${h.id}"`, `${h.name}: on. Click to turn it off.`)
    : make(`data-enable="${esc(i.key)}" data-into="${h.id}"`, `${h.name}: off. Click to turn it on.`);
  if (on) return serves(h.id) && plainName(i.in[h.id].name) ? make(`data-unsrv="${esc(i.key)}" data-from="${h.id}"`, `${h.name}: on. Click to remove it from ${h.name}.`) : make("", `${h.name}: on.`);
  if (!serves(h.id)) return make("", `${h.name}: Tool up! adds skills to it, not MCP servers, for now.`);
  if (i.catalogId) return make(`data-fill="${esc(i.catalogId)}" data-into="${h.id}"`, `${h.name}: off. Click to add it.`);
  if (copyable(i)) return make(`data-copysrv="${esc(i.key)}" data-into="${h.id}"`, `${h.name}: off. Click to add it.`);
  return make("", `${h.name}: off. It runs as a program or carries keys, so Tool up! does not copy it to another agent.`);
}
function row(i: Item, cs: HarnessReport[]) {
  const known = i.catalogId ? listed.get(i.catalogId) : undefined;
  const sub = i.kind === "skill" ? known?.ds || i.description || "" : known?.ds || "Added by you";
  return `<li class="row k-${i.kind}"><button class="row-main" type="button" data-about="${esc(i.key)}" title="Details">${itemLogo(i)}<span class="row-t"><b>${esc(i.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span></button>
    ${hasUpdate(i) ? `<button class="get upd${flipping.has(`${i.key}|update`) ? " busy" : ""}" type="button" data-update="${esc(i.key)}" title="A newer version is on GitHub. Click to update.">Update</button>` : ""}
    <span class="swts" role="group" aria-label="Agents for ${esc(i.name)}">${cs.map((h) => agentSwitch(i, h)).join("")}</span>
    <button class="dots" type="button" data-menu="${esc(i.key)}" aria-haspopup="menu" aria-expanded="${menu?.key === i.key}" title="More" aria-label="More for ${esc(i.name)}">${glyph("dots")}</button></li>`;
}
/**
 * An empty place: Tool up!'s mark, pressed into a small sunken box in the paper's own warm tone, what is (not) here, and what to do about it.
 * `clear` names what a "Clear filters" button resets: the Installed list's search and kind, or the Catalog's.
 */
const LOGO = `<svg class="empty-logo" viewBox="0 0 704 576" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="M64 320H192V384H64V448H256V384H448V448H640V384H512V320H640V256H448V320H256V256H64V320ZM256 128H448V64H256V128ZM704 512H640V576H64V512H0V128H192V0H512V128H704V512Z"/></svg>`;
function emptyState(title: string, text: string, opts: { clear?: "installed" | "catalog"; add?: boolean } = {}) {
  const clear = opts.clear ? `<button class="btn${opts.add ? "" : " pri"}" type="button" ${opts.clear === "installed" ? "data-clear-inst" : 'data-crumb="home"'}>Clear filters</button>` : "";
  const add = opts.add ? `<button class="btn pri" type="button" data-screen="catalog">${glyph("plus")}Add from the catalog</button>` : "";
  return `<div class="empty"><span class="empty-mark">${LOGO}</span><b>${esc(title)}</b><span>${esc(text)}</span>${clear || add ? `<div class="empty-b">${clear}${add}</div>` : ""}</div>`;
}
const tabsHtml = (cur: Tab, counts: Record<Tab, number>) => `<div class="kinds" role="group" aria-label="Show">${(["all", "mcp", "skill"] as Tab[]).map((k) => `<button class="tab t-${k}" type="button" data-tab="${k}" aria-pressed="${cur === k}">${glyph(k)}<span>${k === "all" ? "All" : k === "mcp" ? "MCPs" : "Skills"}</span><small>${counts[k]}</small></button>`).join("")}</div>`;

function installed() {
  const cs = cols(), r = rows(inv!, { ...view, q }), all = { ...r };
  if (instAgent && !cs.some((h) => h.id === instAgent)) instAgent = "";
  if (instAgent) for (const k of ["all", "mcp", "skill"] as Tab[]) r[k] = r[k].filter((i) => !!i.in[instAgent]);
  const group = (title: string, items: Item[]) => (items.length ? `<section class="grp"><h2>${title}</h2><ul class="${rowsCls()}">${items.map((i) => row(i, cs)).join("")}</ul></section>` : "");
  const ql = q.trim().toLowerCase();
  const pluggedAll = inv!.plugins.filter((p) => !ql || `${p.name} ${p.market}`.toLowerCase().includes(ql));
  const plugged = pluggedAll.filter((p) => !instAgent || p.agents.includes(instAgent));
  const plugins = plugged.length ? `<section class="grp"><h2>Plugins</h2><ul class="${rowsCls()}">${plugged.map((p) => `<li class="row k-skill"><span class="row-main">${coolIcon(p.name, "", undefined, "box", "")}<span class="row-t"><b>${esc(p.name)}</b><small>Plugin${p.market ? ` from ${esc(p.market)}` : ""}${p.version ? ` · version ${esc(p.version)}` : ""}</small></span></span>
      <span class="swts">${cs.map((h) => { const a = agents.get(h.id); return p.agents.includes(h.id)
        ? `<span class="swt" role="img" aria-checked="true" aria-disabled="true" title="${esc(h.name)}: on. Plugins are switched on and off inside ${esc(h.name)}." aria-label="On for ${esc(h.name)}">${a ? mono(h.id, a.icon) : ""}</span>`
        : PLUGIN_AGENTS.includes(h.id) ? `<span class="swt" role="img" aria-checked="false" aria-disabled="true" title="${esc(h.name)}: off. Install it for ${esc(h.name)} from the Catalog." aria-label="Off for ${esc(h.name)}">${a ? mono(h.id, a.icon) : ""}</span>`
        : `<span class="swt none" aria-hidden="true"></span>`; }).join("")}</span><span class="dots-gap"></span></li>`).join("")}</ul></section>` : "";
  // Custom: what is not on Tool up!'s own list, so whatever you pasted a command for or added yourself
  const custom = instFilter === "custom", mine = (items: Item[]) => items.filter((i) => !i.catalogId), own = mine(r.all).length;
  const show = (k: string) => instFilter === "all" || custom || instFilter === k;
  const lists = (show("skill") ? group("Skills", custom ? mine(r.skill) : r.skill) : "") + (show("plugin") && !custom ? plugins : "") + (show("mcp") ? group("MCP servers", custom ? mine(r.mcp) : r.mcp) : "");
  const counts: [string, string, number][] = [["all", "All", r.all.length + plugged.length], ["skill", "Skills", r.skill.length], ["mcp", "MCP servers", r.mcp.length], ["plugin", "Plugins", plugged.length], ["custom", "Custom", own]];
  // the same row of buttons as the Catalog's: one per kind, the one switched on dark with a small x that clears it (back to everything)
  const filter = `<nav class="catnav" aria-label="Show">${counts.filter(([k]) => k !== "all").map(([k, label, n]) => `<button class="chip" type="button" data-inst="${k}" aria-pressed="${instFilter === k}"${instFilter === k ? ` title="Clear ${label}"` : ""}>${k === "plugin" ? glyph("box") : k === "custom" ? glyph("plus") : glyph(k)}<span>${label}</span><small>${n}</small>${instFilter === k ? `<span class="chip-clear" aria-hidden="true">${glyph("x")}</span>` : ""}</button>`).join("")}${agentNav((id) => all.all.filter((i) => !!i.in[id]).length + pluggedAll.filter((p) => p.agents.includes(id)).length)}<span class="catnav-end">${layToggle("installed")}</span></nav>`;
  const some = counts.find(([k]) => k === instFilter)![2] > 0;
  const filtered = !!q.trim() || instFilter !== "all" || !!instAgent;
  const empty = !inv!.items.length && !inv!.plugins.length
    ? emptyState("Nothing here yet", "Your agents have no skills or MCP servers. Add some from the catalog, paste an install command, or drop a .skill file on this window.", { add: true })
    : emptyState(q.trim() ? "Nothing matches" : "None of these yet", q.trim() ? "Nothing on this computer matches your search." : "You have nothing of this kind on this computer.", { clear: filtered ? "installed" : undefined, add: true });
  return `${meadow()}<div class="head"><div><h1>On this computer</h1><p>What your agents can do. Each switch turns it on or off for that agent. Paste any install command here to add it.</p></div>
      ${updatable().length ? `<button class="btn" type="button" data-update-all>${glyph("refresh")}Update all <small>${updatable().length}</small></button>` : ""}${addMenu()}</div>
    ${inv!.items.length || inv!.plugins.length ? filter : ""}
    ${some ? lists : empty}`;
}

/* ---------- the meadow: the agents in use on this computer, each as its companion in the scene above the list ---------- */
// Where you moved each one and how big you made it (Arrange); anything not moved sits where the artwork put it.
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
let spots: Record<string, Spot> = (() => { try { return JSON.parse(saved("toolup.meadow") || "{}") as Record<string, Spot>; } catch { return {}; } })();
let arranging = false, chosen = "";
// how much of the scene's height shows, from its bottom up (the handle under it changes this); arranging shows all of it
const SHOWN_MIN = 0.3, SHOWN_DEF = 0.72;
let meadowOff = saved("toolup.meadow-off") === "1";   // hidden altogether: from the scene's own arrange bar, or in Settings (which brings it back)
let meadowStill = saved("toolup.meadow-still") === "1";   // the scene as a still picture: no moving sea, no moving companions
const setMeadowOff = (off: boolean) => { meadowOff = off; save("toolup.meadow-off", off ? "1" : ""); if (off) { arranging = false; chosen = ""; } };
let shown = clamp(+saved("toolup.meadow-h") || SHOWN_DEF, SHOWN_MIN, 1);
const clipCss = () => `aspect-ratio:${SCENE.width}/${(SCENE.height * shown).toFixed(1)}`;
const spotOf = (id: string): Spot => { const d = MEADOW[id], m = spots[id]; return { x: m?.x ?? d.x, y: m?.y ?? d.y, w: m?.w ?? d.w }; };
// the point is where its feet touch the ground; what is lower in the scene is nearer, so it is drawn over what is higher
const spriteCss = (id: string) => { const p = spotOf(id); return `left:${p.x}%;top:${p.y}%;width:${p.w}%;aspect-ratio:1/${MEADOW[id].ratio};z-index:${Math.round(p.y * 10) + 1};--x:${p.x};--y:${p.y};--w:${p.w};--r:${MEADOW[id].ratio}`; };
const shadowCss = (id: string) => { const p = spotOf(id); return `left:${p.x}%;top:${p.y}%;width:${(p.w * 0.86).toFixed(2)}%;z-index:${Math.round(p.y * 10)}`; };
function meadow() {
  const here = cols().filter((h) => MEADOW[h.id]);
  if (meadowOff || !here.length) return "";
  if (chosen && !here.some((h) => h.id === chosen)) chosen = "";
  const sel = here.find((h) => h.id === chosen);
  const tools = arranging
    ? `<div class="meadow-bar" role="group" aria-label="Arrange the agents"><span class="meadow-who">${sel ? esc(sel.name) : "Drag an agent to move it"}</span>
        ${sel ? `<label class="meadow-size"><span>Size</span><input type="range" min="2" max="30" step="0.25" value="${spotOf(sel.id).w}" data-meadow-size aria-label="Size of ${esc(sel.name)}"></label>` : ""}
        <button class="btn small" type="button" data-meadow-hide title="Take the scene off this screen. Settings brings it back.">Hide</button><button class="btn small" type="button" data-meadow-reset${Object.keys(spots).length ? "" : " disabled"}>Reset</button><button class="btn small pri" type="button" data-meadow-arrange>Done</button></div>`
    : `<button class="meadow-edit" type="button" data-meadow-arrange title="Move and resize the agents" aria-label="Arrange the agents">${glyph("move")}</button>`;
  return `<figure class="meadow${arranging ? " arranging" : ""}"><div class="meadow-clip"${arranging ? "" : ` style="${clipCss()}"`}><div class="meadow-scene" id="meadow" style="aspect-ratio:${SCENE.width}/${SCENE.height}">
      <img class="meadow-bg" src="./meadow/scene.webp" alt="${esc(SCENE.alt)}" draggable="false">
      ${here.map((h) => `<span class="meadow-sh" data-meadow-sh="${h.id}" style="${shadowCss(h.id)}" aria-hidden="true"></span><button class="meadow-a${chosen === h.id && arranging ? " on" : ""}${instAgent === h.id && !arranging ? " only" : ""}" type="button" data-meadow="${h.id}" style="${spriteCss(h.id)}" title="${arranging ? `${esc(h.name)}: drag to move, arrow keys to nudge` : instAgent === h.id ? "Show every agent's again" : `Show only what ${esc(h.name)} has`}" aria-label="${esc(h.name)}"${arranging ? "" : ` aria-pressed="${instAgent === h.id}"`}><img src="./meadow/${h.id}.webp" alt="" draggable="false"><span class="meadow-shade" aria-hidden="true"><img src="./meadow/${h.id}.webp" alt="" draggable="false"></span></button>`).join("")}
    </div></div>${tools}</figure>${arranging ? "" : `<div class="meadow-grip" role="separator" aria-orientation="horizontal" tabindex="0" data-meadow-grip aria-label="Height of the scene" aria-valuemin="${SHOWN_MIN * 100}" aria-valuemax="100" aria-valuenow="${Math.round(shown * 100)}" title="Drag to make the scene taller or shorter"><i></i></div>`}`;
}
/** Put one agent's companion where its spot now says, without drawing the whole window again (so a drag stays smooth). */
function placeSprite(id: string) {
  const a = document.querySelector<HTMLElement>(`[data-meadow="${id}"]`), sh = document.querySelector<HTMLElement>(`[data-meadow-sh="${id}"]`);
  if (a) a.style.cssText = spriteCss(id);
  if (sh) sh.style.cssText = shadowCss(id);
}
const moveSpot = (id: string, x: number, y: number) => { spots[id] = { ...spotOf(id), x: +clamp(x, 0, 100).toFixed(2), y: +clamp(y, (1 - shown) * 100 + 14, 100).toFixed(2) }; placeSprite(id); };   // never up into the part that is out of sight
const keepSpots = () => save("toolup.meadow", JSON.stringify(spots));
let dragging: { id: string; dx: number; dy: number } | null = null;
// the handle under the scene: drag it (or use the up and down arrows on it) to show more or less of the scene
let sizing = false;
const setShown = (v: number) => {
  shown = +clamp(v, SHOWN_MIN, 1).toFixed(3);
  const clip = document.querySelector<HTMLElement>(".meadow-clip"), grip = document.querySelector<HTMLElement>("[data-meadow-grip]");
  if (clip) clip.style.cssText = clipCss();
  grip?.setAttribute("aria-valuenow", String(Math.round(shown * 100)));
};
document.addEventListener("pointerdown", (e) => {
  const grip = (e.target as HTMLElement).closest<HTMLElement>("[data-meadow-grip]");
  if (!grip) return;
  sizing = true; grip.setPointerCapture(e.pointerId); grip.classList.add("on"); e.preventDefault();
});
document.addEventListener("pointermove", (e) => {
  const clip = sizing && document.querySelector<HTMLElement>(".meadow-clip");
  if (!clip) return;
  const box = clip.getBoundingClientRect();
  setShown((e.clientY - box.top) / (box.width * SCENE.height / SCENE.width));
});
const endSizing = () => { if (!sizing) return; sizing = false; save("toolup.meadow-h", String(shown)); document.querySelector("[data-meadow-grip]")?.classList.remove("on"); };
document.addEventListener("pointerup", endSizing);
document.addEventListener("pointercancel", endSizing);
document.addEventListener("keydown", (e) => {
  if (!(e.target as HTMLElement).closest?.("[data-meadow-grip]") || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
  e.preventDefault(); setShown(shown + (e.key === "ArrowDown" ? 0.04 : -0.04)); save("toolup.meadow-h", String(shown));
});
document.addEventListener("pointerdown", (e) => {
  const a = arranging ? (e.target as HTMLElement).closest<HTMLElement>("[data-meadow]") : null, scene = document.querySelector<HTMLElement>("#meadow");
  if (!a || !scene) return;
  const box = scene.getBoundingClientRect(), p = spotOf(a.dataset.meadow!);
  // keep hold of the point that was grabbed, so the agent does not jump to the pointer
  dragging = { id: a.dataset.meadow!, dx: (e.clientX - box.left) / box.width * 100 - p.x, dy: (e.clientY - box.top) / box.height * 100 - p.y };
  a.setPointerCapture(e.pointerId);
  e.preventDefault();
});
document.addEventListener("pointermove", (e) => {
  const scene = dragging && document.querySelector<HTMLElement>("#meadow");
  if (!dragging || !scene) return;
  const box = scene.getBoundingClientRect();
  moveSpot(dragging.id, (e.clientX - box.left) / box.width * 100 - dragging.dx, (e.clientY - box.top) / box.height * 100 - dragging.dy);
});
const dropSprite = () => { if (!dragging) return; chosen = dragging.id; dragging = null; keepSpots(); paint(); document.querySelector<HTMLElement>(`[data-meadow="${chosen}"]`)?.focus(); };
document.addEventListener("pointerup", dropSprite);
document.addEventListener("pointercancel", dropSprite);
document.addEventListener("keydown", (e) => {
  const a = arranging ? (e.target as HTMLElement).closest<HTMLElement>("[data-meadow]") : null;
  const step = e.shiftKey ? 2 : 0.5, by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (!a || !by[e.key]) return;
  e.preventDefault();
  const id = a.dataset.meadow!, p = spotOf(id);
  chosen = id; moveSpot(id, p.x + by[e.key][0], p.y + by[e.key][1]); keepSpots();
});

/* ---------- Catalog ---------- */
// Laid out like an app store: featured packs with a cover, shelves, categories, and a page for each item.
// A search looks in every source that is switched on (the Sources menu), Tool up!'s own list first.
const sourceOf = (id: string) => SOURCES.find((s) => s.id === id);
const CAT_HUE: Record<string, number> = { code: 262, test: 150, design: 330, docs: 32, media: 12, cloud: 205, work: 245, pay: 165, web: 190, ai: 285, biz: 20, util: 220 };
/** One line icon per category (the same ones the website's category list uses), and "custom" for what you added yourself. */
const CAT_ICON: Record<string, string> = {
  code: '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
  test: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  design: '<circle cx="13.5" cy="6.5" r=".6"/><circle cx="17.5" cy="10.5" r=".6"/><circle cx="8.5" cy="7.5" r=".6"/><circle cx="6.5" cy="12.5" r=".6"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.7-1.7H16c3 0 5.6-2.5 5.6-5.6C22 6 17.5 2 12 2z"/>',
  docs: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
  media: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/>',
  work: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  pay: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  web: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  ai: '<path d="M9.9 15.5A2 2 0 0 0 8.5 14.1l-6.1-1.6a.5.5 0 0 1 0-1L8.5 9.9A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z"/>',
  biz: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  util: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  custom: '<path d="M12 20h9"/><path d="M16.4 3.6a2 2 0 0 1 2.8 2.8L7 18.6 3 20l1.4-4z"/>',
};
const catIcon = (c: string) => `<span class="cat-ic" style="--h:${c === "custom" ? 285 : CAT_HUE[c] ?? 250}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CAT_ICON[c] || GLYPH.all}</svg></span>`;
const cardBy = (x: Listed) => (x.sec === "skill" ? x.repo || "" : x.by || "");

/** Get, with a small arrow beside it for the other things to do with a catalog item (see getMenuHtml). */
function getButton(id: string) {
  const n = cols().length, have = haveIt(id).length, name = listed.get(id)?.name || id;
  const main = have && have === n ? `<span class="get done" title="On for every agent">Installed</span>` : `<button class="get" type="button" data-get="${id}" title="${have ? `In ${have} of your ${plural(n, "agent")}` : "Install"}">Install</button>`;
  return `<span class="get-split">${main}<button class="get get-more" type="button" data-get-menu="${id}" aria-haspopup="menu" aria-expanded="${getMenu?.id === id}" title="More" aria-label="More for ${esc(name)}">${glyph("chev")}</button></span>`;
}
/** The menu behind Get's arrow: install, or put in one of your own collections. */
let getMenu: { id: string; x: number; y: number } | null = null;
function getMenuHtml() {
  const x = getMenu && listed.get(getMenu.id);
  if (!getMenu || !x) return "";
  const id = x.id;
  const mi = (attr: string, icon: string, label: string, title = "") => `<button type="button" role="menuitem" ${attr}${title ? ` title="${esc(title)}"` : ""}>${glyph(icon)}${label}</button>`;
  return `<div class="menu getmenu" role="menu" aria-label="More for ${esc(x.name)}" style="top:${getMenu.y}px;right:${getMenu.x}px">${menuGroups([
    ["", [mi(`data-detail="${id}"`, "info", "Details")]],
    ["", [
      mi(`data-get="${id}"`, "down", "Install…"),
    ]],
    ["Your collections", [
      ...presets.map((p, n) => (p.ids.includes(id) ? mi(`data-preset-drop="${n}" data-id="${id}"`, "check", esc(p.name), "Click to take it out of this collection") : mi(`data-preset-add="${n}" data-id="${id}"`, "all", `Add to ${esc(p.name)}`))),
      mi(`data-preset-new="${id}"`, "plus", "New collection…"),
    ]],
  ])}</div>`;
}
/** One item the way a store lists it: icon, name, a line about it, Get. */
// the Catalog's lists come two ways: a grid of cells, several to a line, or one item to a line. The choice is kept.
let layout = saved("toolup.layout") === "list" ? "list" : "grid";
const appsCls = () => (layout === "list" ? "apps list" : "apps");
// the Installed list has the same choice, kept apart: it starts as a list, the Catalog as a grid
let instLayout = saved("toolup.layout.installed") === "grid" ? "grid" : "list";
const rowsCls = () => (instLayout === "grid" ? "rows cards" : "rows");
const layToggle = (which = "catalog") => `<div class="lay" role="group" aria-label="Layout">${([["grid", "Grid", `<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>`], ["list", "List", `<path d="M4 6h16M4 12h16M4 18h16"/>`]] as const)
  .map(([k, label, d]) => `<button type="button" data-lay="${k}" data-lay-for="${which}" aria-pressed="${(which === "installed" ? instLayout : layout) === k}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg></button>`).join("")}</div>`;
// a count of installs carries a small download mark in front of it
const appMeta = (parts: string[]) => (parts.length ? `<span class="app-m">${parts.map((t) => (/ installs$/.test(t) ? `<span class="inst-n">${glyph("down")}${esc(t)}</span>` : `<span>${esc(t)}</span>`)).join("")}</span>` : "");
function appRow(x: Listed) {
  // name, then who makes it and how many installed it, then what it does
  const who = x.sec === "skill" ? (x.repo || "").split("/")[0] : x.by || "";
  const meta = [who, x.sec === "skill" && x.installs ? `${fmt(x.installs)} installs` : ""].filter(Boolean);
  return `<div class="app k-${x.sec}"><button class="app-main" type="button" data-detail="${x.id}">${cardLogo(x)}<span class="app-t"><b>${esc(x.name)}</b>${appMeta(meta)}<small>${esc(x.ds || cardBy(x))}</small></span></button>${getButton(x.id)}</div>`;
}
/** A shelf's heading; when there is a full list of that kind (see LISTS), the heading itself is the link to it. */
const SHELF = 6;   // how many items a Discover shelf shows before "See all"
const shelfHead = (title: string, list = "", n = 0) => `<div class="shelf-h"><h2>${list ? `<button class="shelf-link" type="button" data-list="${list}" title="See all ${n}">${esc(title)}${glyph("next")}</button>` : esc(title)}</h2>${list ? `<span class="shelf-tools"><button class="btn small" type="button" data-list="${list}">See all (${n})</button></span>` : ""}</div>`;
/** Under a shelf's few items: the way to the rest of them. */
const shelfFoot = (title: string, list = "", n = 0) => (list ? `<button class="shelf-more" type="button" data-list="${list}">See all ${n} ${esc(LISTS[list]?.title.replace(/^MCP s/, "MCP s").replace(/^(?!MCP)./, (c) => c.toLowerCase()) || title.toLowerCase())}${glyph("next")}</button>` : "");
const shelf = (title: string, sub: string, items: Listed[], list = "", n = 0) => (items.length ? `<section class="shelf">${shelfHead(title, list, n)}${sub ? `<p>${esc(sub)}</p>` : ""}<div class="${appsCls()}">${items.map(appRow).join("")}</div>${shelfFoot(title, list, n)}</section>` : "");
// the full list of each kind, reached from "See all" on its shelf; the breadcrumb leads back to Discover
const LISTS: Record<string, { title: string; about: string }> = {
  skills: { title: "Skills", about: "Every skill on Tool up!'s list, the most installed first." },
  mcp: { title: "MCP servers", about: "Every server on Tool up!'s list, from the tools' own makers. You sign in the first time an agent uses one." },
  plugins: { title: "Plugins", about: "" },
  custom: { title: "Custom", about: "" },
};
/**
 * The Catalog's own row of buttons, on every one of its lists: one for each kind (the full list of it), one for
 * what is yours, and a menu of the categories. The one you are in is marked.
 */
let catsOpen = false, srcOpen = false;
function catNav() {
  const kind = q.trim() ? "" : shop.list, cat = q.trim() ? "" : shop.cat;
  // a kind that is switched on carries a small x: clicking it again clears it
  const chip = (list: string, icon: string, label: string, n: number | string) => `<button class="chip" type="button" data-list="${list}" aria-pressed="${kind === list}"${kind === list ? ` title="Clear ${esc(label)}"` : ""}>${glyph(icon)}<span>${esc(label)}</span>${n === "" ? "" : `<small>${n}</small>`}${kind === list ? `<span class="chip-clear" aria-hidden="true">${glyph("x")}</span>` : ""}</button>`;
  const cats = Object.entries(raw.categories).map(([c, label]) => `<button type="button" role="menuitem" data-cat="${c}" aria-current="${cat === c}"><span class="with-cat">${catIcon(c)}${esc(label)}</span><small>${cards.filter((x) => (x.cats || []).includes(c)).length}</small></button>`).join("");
  return `<nav class="catnav stick" aria-label="Browse the catalog">
    ${chip("skills", "skill", "Skills", raw.skills.length)}
    ${chip("mcp", "mcp", "MCP servers", raw.mcp.length)}
    ${enabled.has("plugins") ? chip("plugins", "box", "Plugins", market.state === "ok" ? market.plugins.length : "") : ""}
    ${chip("custom", "plus", "Custom", customItems().length)}
    <div class="catdd"><span class="chip-pair"><button class="chip" type="button" data-cats aria-haspopup="menu" aria-expanded="${catsOpen}" aria-pressed="${!!cat}">${glyph("all")}<span>${cat ? esc(catLabel(cat)) : "Categories"}</span>${glyph("chev")}</button>${cat ? `<button class="chip-x" type="button" data-cat="" title="Clear the category" aria-label="Clear the category">${glyph("x")}</button>` : ""}</span>
      ${catsOpen ? `<div class="catdd-list filt-cats" role="menu" aria-label="Categories"><button type="button" role="menuitem" data-cat="" aria-current="${!cat}"><span>All categories</span><small>${cards.length}</small></button>${cats}</div>` : ""}</div>
    ${layToggle()}<div class="catdd catnav-end"><button class="chip" type="button" data-srcs aria-haspopup="true" aria-expanded="${srcOpen}">${glyph("search")}<span>Sources</span><small>${enabled.size}</small>${glyph("chev")}</button>
      ${srcOpen ? `<div class="catdd-list filt" role="group" aria-label="Sources to look in">${sourceRows()}</div>` : ""}</div></nav>`;
}
/** What the list on screen is called: the kind, the category, or both ("Design & frontend · Skills"). */
const listTitle = () => [shop.cat ? catLabel(shop.cat) : "", LISTS[shop.list]?.title || ""].filter(Boolean).join(" · ");
function listView(kind: "skills" | "mcp") {
  const inCat = (x: Listed) => !shop.cat || (x.cats || []).includes(shop.cat);
  const all = (kind === "skills" ? [...raw.skills].sort((a, b) => (b.installs || 0) - (a.installs || 0) || a.name.localeCompare(b.name)).map((x) => listed.get(x.id)!) : cards.filter((x) => x.sec === "mcp").sort(byName)).filter(inCat);
  const vis = all.slice(0, shop.page), rest = all.length - vis.length;
  return `<div class="crumb-row">${crumbs(listTitle())}</div>${catNav()}<section class="shelf"><h1 class="page-t">${esc(listTitle())}</h1><p>${esc(shop.cat ? `The ${kind === "skills" ? "skills" : "servers"} on Tool up!'s list in this category.` : LISTS[kind].about)}</p>
    <div class="bar"><span class="count">${plural(all.length, kind === "skills" ? "skill" : "server")}</span></div>
    ${vis.length ? `<div class="${appsCls()}">${vis.map(appRow).join("")}</div>` : emptyState(`No ${kind === "skills" ? "skills" : "servers"} in this category`, "Tool up!'s list has none here. Clear the filters to see everything.", { clear: "catalog" })}
    ${rest > 0 ? `<button class="btn more" type="button" data-more>Show ${Math.min(PAGE, rest)} more <small>${rest} left</small></button>` : ""}</section>`;
}

/** The tick boxes for where the Catalog looks: the Sources menu in its row of buttons (see catNav). */
function sourceRows() {
  const row = (id: string, name: string, kind: string, about: string) => `<label class="sw"><input type="checkbox" data-catalog="${id}" ${enabled.has(id) ? "checked" : ""}><span class="set-t"><b>${esc(name)}</b>${kind ? kindBadge(kind as "mcp" | "skill") : ""}<small>${esc(about)}</small></span></label>`;
  return `${row("toolup", "Tool up!", "", "Picked by hand and checked every week.")}
      ${row("plugins", MARKET.title, "", `Plugins from ${MARKET.by} and its partners: skills and connectors for a kind of work.`)}
      ${SOURCES.map((s) => row(s.id, s.name, s.kind, s.about)).join("")}
      <p>The other sources are open directories anyone can publish to. Look at who is behind something before you install it.</p>`;
}
const sourcesMenu = () => "";   // the Sources button moved into the Catalog's row of buttons

// Custom: a category of the Catalog that Tool up! does not write. It holds what is on this computer but not on
// Tool up!'s own list: whatever you pasted an install command for, or added yourself.
const customItems = () => (inv ? inv.items.filter((i) => !i.catalogId) : []);
const catLabel = (c: string) => raw.categories[c];
/** Something of your own, drawn like any other Catalog entry; it opens the same page the Installed list does. */
function customRow(i: Item) {
  const on = cols().filter((h) => i.in[h.id]).map((h) => chipOf(h.id));
  const sub = i.kind === "skill" ? i.description || i.origin?.repo || "A skill you added" : i.transport === "stdio" ? "Runs on this computer" : (() => { try { return new URL(i.target || "").host; } catch { return "A server you added"; } })();
  return `<div class="app k-${i.kind}"><button class="app-main" type="button" data-about="${esc(i.key)}">${itemLogo(i)}<span class="app-t"><b>${esc(i.name)}</b>${appMeta([i.origin?.repo.split("/")[0] || "Added by you", i.kind === "skill" ? "Skill" : "MCP server"])}<small>${esc(sub)}</small></span></button>
    <span class="get done" title="${on.length ? `On for ${esc(on.join(", "))}` : "Saved, and off for every agent"}">${on.length ? "Installed" : "Saved"}</span></div>`;
}
function customShelf(ql: string, page: boolean) {
  const all = customItems().filter((i) => !ql || `${i.name} ${i.description || ""} ${i.origin?.repo || ""}`.toLowerCase().includes(ql)).sort((a, b) => a.name.localeCompare(b.name));
  const r: Record<Tab, Item[]> = { all, mcp: all.filter((i) => i.kind === "mcp"), skill: all.filter((i) => i.kind === "skill") };
  const list = page ? r[shop.tab] : all;
  if (!page && !list.length) return "";
  return `<section class="shelf">${page ? `<h1 class="page-t">Custom</h1>` : `<h2>Custom</h2>`}<p>Not on Tool up!'s list: what you pasted an install command for, or added yourself.</p>
    ${page ? `<div class="bar">${tabsHtml(shop.tab, { all: r.all.length, mcp: r.mcp.length, skill: r.skill.length })}</div>` : ""}
    ${list.length ? `<div class="${appsCls()}">${list.map(customRow).join("")}</div>` : (page ? emptyState(all.length ? "None of this kind" : "Nothing of your own yet", all.length ? "Your own items are of the other kind." : "Paste an install command anywhere in this window, or drop a .skill file on it, and it shows up here.", { clear: "catalog" }) : `<p class="none">Nothing of yours matches.</p>`)}</section>`;
}

/** Where an idea for a new pack goes: a new issue on the project's GitHub page. */
const SUGGEST_PACK = `https://github.com/oyabun/toolup/issues/new?title=${encodeURIComponent("Starter pack idea: ")}`;
function discover() {
  if (!enabled.has("toolup")) return emptyState(`Search ${[...enabled].map((id) => sourceOf(id)?.name).filter(Boolean).join(", ") || "a catalog"}`, enabled.size ? "Type at least two letters in the search box above." : "Switch on a source in the Sources menu.");
  const feat = raw.packs.map((p, i) => {
    const c = COVERS[i % COVERS.length], items = p.ids.map((id) => listed.get(id)).filter((x): x is Listed => !!x);
    return `<article class="feat" style="background-image:url(${c.file})"><button class="feat-open" type="button" data-pack="${i}" aria-label="See what is in ${esc(p.name)}"></button><div class="feat-in">
      <h3>${esc(p.name)}</h3><p>${esc(p.ds)}</p>
      <div class="feat-b"><span class="feat-logos">${items.slice(0, 6).map((x) => cardLogo(x, "mini")).join("")}</span><span class="feat-n">${plural(items.length, "item")}</span><button class="get light" type="button" data-pack="${i}" aria-label="View ${esc(p.name)}">View</button></div></div></article>`;
  }).join("") + `<article class="feat feat-more"><div class="feat-in"><h3>More coming soon</h3><p>New packs are on the way. Is there one you would use?</p>
      <div class="feat-b"><button class="get" type="button" data-url="${SUGGEST_PACK}">Suggest a pack</button></div></div></article>`;
  const top = [...raw.skills].sort((a, b) => (b.installs || 0) - (a.installs || 0)).slice(0, SHELF).map((x) => listed.get(x.id)!);
  const servers = raw.mcp.slice(0, SHELF).map((x) => listed.get(x.id)!);
  const arrow = (dir: number, label: string, d: string) => `<button class="car-arrow ${dir < 0 ? "prev" : "next"}" type="button" data-car="${dir}" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg></button>`;
  return `<section class="shelf packs-shelf"><div class="shelf-h"><h2>Starter packs</h2></div><p>Skills and servers picked for one kind of work. Open a pack to see what is in it, then install all of it or only parts.</p><div class="carousel at-start"><div class="feats">${feat}</div>${arrow(-1, "Earlier packs", "m15 6-6 6 6 6")}${arrow(1, "More packs", "m9 6 6 6-6 6")}<div class="car-dots" role="group" aria-label="Starter packs"></div></div></section>
    ${presetShelf()}
    ${collShelf()}
    ${shelf("Popular skills", "The skills people install most.", top, "skills", raw.skills.length)}
    ${shelf("Connect your tools", "MCP servers from the tools' own makers. You sign in the first time an agent uses one.", servers, "mcp", raw.mcp.length)}
    ${pluginShelf()}`;
}

function results() {
  const term = q.trim(), ql = term.toLowerCase();
  const hit = (x: Listed) => (!shop.cat || (x.cats || []).includes(shop.cat)) && (!ql || [x.name, x.ds, x.by || x.repo, x.id, ...(x.cats || []).map((c) => raw.categories[c])].join(" ").toLowerCase().includes(ql));
  const all = enabled.has("toolup") ? cards.filter(hit).sort(byName) : [];
  const r: Record<Tab, Listed[]> = { all, mcp: all.filter((x) => x.sec === "mcp"), skill: all.filter((x) => x.sec === "skill") };
  const list = r[shop.tab], vis = list.slice(0, shop.page), rest = list.length - vis.length;
  const own = enabled.has("toolup") ? `<section class="shelf">${shop.cat && !term ? `<h1 class="page-t">${esc(raw.categories[shop.cat])}</h1>` : `<h2>Tool up!</h2>`}
      <div class="bar">${tabsHtml(shop.tab, { all: r.all.length, mcp: r.mcp.length, skill: r.skill.length })}</div>
      ${vis.length ? `<div class="${appsCls()}">${vis.map(appRow).join("")}</div>` : emptyState("Nothing in Tool up!'s list matches", term ? "Try another word, or clear the search and filters." : "Nothing of this kind in this category.", { clear: "catalog" })}
      ${rest > 0 ? `<button class="btn more" type="button" data-more>Show ${Math.min(PAGE, rest)} more <small>${rest} left</small></button>` : ""}</section>` : "";
  const others = SOURCES.filter((s) => enabled.has(s.id)).map((s) => {
    const e = ext[s.id];
    // a source with nothing to show is left out: no search yet (it needs two letters), or a search that found nothing there
    if (term.length < 2 || (e && e.state === "ok" && !e.items.length)) return "";
    const body = !e || e.state === "loading" ? `<p class="none">Searching ${esc(s.name)}…</p>`
      : e.state === "error" ? `<p class="note bad">${glyph("warn")}<span>${esc(e.error)}</span></p>`
      : `<div class="grid">${e.items.map((f, i) => foundCard(f, s.id, i)).join("")}</div>`;
    return `<section class="shelf"><h2>${esc(s.name)}</h2><p>${esc(s.about)} Not checked by Tool up!.</p>${body}</section>`;
  }).join("");
  const plug = term && enabled.has("plugins") ? pluginHits(ql) : [];
  const plugs = term && enabled.has("plugins") ? `<section class="shelf"><h2>Plugins</h2>${plug.length ? `<div class="${appsCls()}">${plug.slice(0, 30).map(pluginRow).join("")}</div>` : `<p class="none">${market.state === "loading" ? "Loading the plugin list…" : "No plugin matches."}</p>`}</section>` : "";
  return `<div class="crumb-row">${crumbs(shop.cat && !term ? raw.categories[shop.cat] : "Search")}${sourcesMenu()}</div>${catNav()}${own}${shop.cat ? "" : customShelf(ql, false)}${plugs}${others}`;
}
function foundCard(f: Found, source: string, i: number) {
  const where = f.install?.type === "mcp" ? new URL(f.install.url).host : "";
  return `<div class="item ext k-${f.kind}">
    <span class="top">${coolIcon(f.name, f.description, undefined, kindGlyph(f.kind), shape(f.kind))}<span class="who"><span class="nm">${esc(f.name)}</span>${f.by ? `<span class="by">${esc(f.by)}</span>` : ""}</span></span>
    <span class="ds">${esc(f.description)}</span>
    <span class="meta">${[f.popularity, where].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</span>
    <span class="base">${kindBadge(f.kind)}${f.install ? `<button class="get" type="button" data-found="${source}:${i}">Install</button>` : `<span class="blocked">${esc(f.blocked)}</span>`}</span></div>`;
}

/** The page for one Tool up! item. */
/** What the catalog knows about an item: its numbers, its pictures and how to start with it. Its page in the Catalog and its window on Installed both show these. */
function catalogParts(x: Listed) {
  const skill = x.sec === "skill", d = more[x.id], repo = d?.repo || (skill ? x.repo : "") || "";
  const when = d?.updated ? new Date(d.updated).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—";
  const facts: [string, string][] = [
    ["Kind", skill ? "Skill" : "MCP server"],
    [skill ? "Installs" : "Sign-in", skill ? (x.installs ? fmt(x.installs) : "—") : x.auth === "oauth" ? "In your browser" : "None needed"],
    ["Stars", d?.stars ? fmt(d.stars) : "—"],
    ["Licence", d?.license || "—"],
    ["Updated", when],
    ["Category", (x.cats || []).map((c) => raw.categories[c]).join(", ") || "—"],
  ];
  const shots = d?.images?.length ? `<section class="shelf"><h2>Pictures</h2><div class="shots">${d.images.map((im, i) => `<button type="button" data-shot="${esc(im.src)}" aria-label="Enlarge picture ${i + 1}"><img src="${esc(im.src)}" alt="${esc(im.alt)}" loading="eager" decoding="async"></button>`).join("")}</div></section>` : "";
  const start = `<section class="shelf"><h2>Quick start</h2><p>${skill ? `Once it is on, ask your agent in your own words. It reaches for the skill when it fits, or you can name it: “Use ${esc(x.name)} to …”.` : `Once it is added, ask your agent for something that needs ${esc(x.name)}.${x.auth === "oauth" ? " The first time, a sign-in page opens in your browser." : ""}`}</p>
    ${d?.examples?.length ? `<ul class="tries">${d.examples.map((e) => `<li class="say"><span>${esc(e)}</span><button class="copy" type="button" data-copy="${esc(e)}" title="Copy" aria-label="Copy">${glyph("copy")}</button></li>`).join("")}</ul><p class="src-note">Examples from ${repo ? esc(repo) : "its page"} on GitHub.</p>` : ""}</section>`;
  return { facts, shots, start, d, repo };
}
function detailView() {
  const x = listed.get(shop.detail)!, skill = x.sec === "skill", n = cols().length, have = haveIt(x.id);
  const d = more[x.id], repo = d?.repo || (skill ? x.repo : "") || "";
  const { facts, shots, start } = catalogParts(x);
  facts.push(["On this computer", have.length ? `${have.length} of ${plural(n, "agent")}` : "Not installed"]);
  const packs = raw.packs.filter((p) => p.ids.includes(x.id)).map((p) => p.name);
  const family = cards.filter((y) => y.id !== x.id && y.sec === x.sec && cardBy(y) && cardBy(y) === cardBy(x)).sort(byName).slice(0, 9);
  const url = !skill ? (raw.mcp.find((m) => m.id === x.id) as unknown as { url?: string })?.url : "";
  const doc = detailDoc?.id === x.id ? detailDoc : null;
  const extra = skill ? `<section class="shelf"><h2>What it tells your agents</h2>
      ${!doc ? `<p>A skill is a page of instructions. You can read this one before you install it.</p><button class="btn" type="button" data-readmore="${x.id}">Read the instructions</button>`
        : doc.state === "loading" ? `<p class="none">Fetching it from ${esc(x.repo)}…</p>`
        : doc.state === "error" ? `<p class="note bad">${glyph("warn")}<span>${esc(doc.text)}</span></p>`
        : `<div class="doc md">${mdDoc(doc.text)}</div>`}</section>`
    : `<section class="shelf"><h2>How it connects</h2><p>${url ? `Your agents talk to <b>${esc(new URL(url).host)}</b>.` : ""} ${x.auth === "oauth" ? "The first time an agent uses it, a sign-in page opens in your browser. Tool up! never sees your password or any key." : "No account or key is needed."}</p></section>`;
  return `${crumbs(x.name)}
    <div class="hero k-${x.sec}">${cardLogo(x, "big")}<div class="hero-t"><h1>${esc(x.name)}</h1><p>${esc(cardBy(x))}</p><span class="hero-b">${getButton(x.id)}${repo ? `<button class="btn small" type="button" data-url="${esc(repoUrl(repo, d?.path || ""))}">${glyph("github")}View on GitHub</button>` : ""}</span></div></div>
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    ${shots}
    <section class="shelf"><h2>About</h2><p class="about">${mdLine(x.ds || "", true)}</p>${d?.about && clean(d.about) !== clean(x.ds || "") ? `<p class="about">${mdLine(d.about, true)}</p>` : ""}${packs.length ? `<p>Part of the ${esc(packs.join(", "))} pack${packs.length > 1 ? "s" : ""}.</p>` : ""}</section>
    ${start}
    ${extra}
    ${skill && x.repo && collOf(x.repo) ? `<section class="shelf"><div class="shelf-h"><h2><button class="shelf-link" type="button" data-coll="${esc(x.repo)}" title="The whole collection">More from ${esc(collOf(x.repo)!.title)}${glyph("next")}</button></h2></div><div class="${appsCls()}">${family.map(appRow).join("")}</div></section>` : shelf(`More from ${cardBy(x)}`, "", family)}`;
}

/** Where you are in the Catalog, each step a way back: Discover › a pack or a category › the item. */
function crumbs(here: string) {
  const trail: [string, string][] = [["Discover", "home"]];
  if (shop.plugin && shop.list === "plugins") trail.push(["Plugins", "list"]);
  else if (shop.detail && shop.pack < 0 && !q.trim() && (shop.list === "skills" || shop.list === "mcp")) trail.push([listTitle(), "list"]);
  else if (shop.plugin && q.trim()) trail.push(["Search", "list"]);
  if (shop.detail && shop.coll && collOf(shop.coll) && !q.trim()) trail.push([collOf(shop.coll)!.title, "list"]);
  if (shop.detail && shop.pack >= 0) trail.push([raw.packs[shop.pack].name, "pack"]);
  else if (shop.detail && shop.cat && (q.trim() || !(shop.list === "skills" || shop.list === "mcp"))) trail.push([catLabel(shop.cat), "list"]);
  else if (shop.detail && q.trim()) trail.push(["Search", "list"]);
  return `<nav class="crumbs" aria-label="You are here">${trail.map(([label, to]) => `<button type="button" data-crumb="${to}">${esc(label)}</button>${glyph("next")}`).join("")}<span aria-current="page">${esc(here)}</span></nav>`;
}

/** A starter pack's page: everything in it, to install all at once or one by one. */
function packView() {
  const p = raw.packs[shop.pack], c = COVERS[shop.pack % COVERS.length];
  const items = p.ids.map((id) => listed.get(id)).filter((x): x is Listed => !!x);
  const missing = items.filter((x) => haveIt(x.id).length < cols().length).length;
  return `<div class="crumb-row">${crumbs(p.name)}${layToggle()}</div>
    <div class="pack-hero" style="background-image:url(${c.banner || c.file})"><div class="feat-in">
      <span class="eyebrow">Starter pack</span><h1>${esc(p.name)}</h1><p>${esc(p.ds)}</p>
      <div class="feat-b"><span class="feat-n">${plural(items.length, "item")}${missing ? "" : " · all installed"}</span>${missing ? `<button class="get light" type="button" data-getpack="${shop.pack}">Install all ${items.length}</button>` : ""}</div></div></div>
    ${shelf("Skills in this pack", "", items.filter((x) => x.sec === "skill"))}
    ${shelf("MCP servers in this pack", "", items.filter((x) => x.sec === "mcp"))}`;
}

function catalogView() {
  if (shop.detail && listed.has(shop.detail)) return detailView();
  if (shop.coll && collOf(shop.coll) && !q.trim()) return collView(collOf(shop.coll)!);
  if (shop.list === "collections" && !q.trim()) return `<div class="crumb-row">${crumbs("Collections")}</div>${catNav()}<section class="shelf"><h1 class="page-t">Collections</h1><p>A publisher's own set of skills. Install all of one, or only the ones you want.</p><div class="folders">${collections.map(collCard).join("")}</div></section>`;
  if (shop.pack >= 0 && raw.packs[shop.pack]) return packView();
  if (enabled.has("plugins")) loadMarket();
  const open = shop.plugin && market.plugins.find((p) => p.name === shop.plugin);
  if (open) return pluginView(open);
  if (shop.list === "plugins" && !q.trim()) return `<div class="crumb-row">${crumbs("Plugins")}${sourcesMenu()}</div>${catNav()}<section class="shelf"><h1 class="page-t">Plugins</h1><p>${esc(MARKET.title)}, from ${esc(MARKET.by)} and its partners. Claude Code installs a plugin whole; your other agents get its skills.</p>${market.state === "ok" ? `<div class="bar"><span class="count">${plural(market.plugins.length, "plugin")}</span></div><div class="${appsCls()}">${market.plugins.map(pluginRow).join("")}</div>` : market.state === "error" ? `<p class="note bad">${glyph("warn")}<span>The plugin list could not be loaded. ${esc(market.error)}</span></p>` : `<p class="none">Loading plugins…</p>`}</section>`;
  if (!q.trim() && shop.list === "custom") return `<div class="crumb-row">${crumbs("Custom")}</div>${catNav()}${customShelf("", true)}`;
  if (!q.trim() && (shop.list === "skills" || shop.list === "mcp")) return listView(shop.list);
  if (q.trim().length > 0 || shop.cat) return results();
  return `<div class="head"><div><h1>Discover</h1><p>Skills, plugins and MCP servers for your agents. Drop a .skill file on the window to install your own.</p></div>${sourcesMenu()}</div>
    ${catNav()}${discover()}`;
}

/* ---------- plugins ---------- */
function loadMarket() {
  if (market.state !== "idle") return;
  market = { ...market, state: "loading" };
  fetchJson(marketUrl(MARKET.repo)).then((text) => { const m = parseMarket(MARKET.repo, JSON.parse(text)); market = { state: "ok", name: m.name, plugins: [...m.plugins.filter((p) => p.own), ...m.plugins.filter((p) => !p.own)], error: "" }; },
    (e) => { market = { state: "error", name: "", plugins: [], error: said(e) }; }).then(paint);
}
/** The skill folders inside a plugin, once its repo's file list is in; null while it is loading or cannot be read. */
function skillsOf(p: Plugin): string[] | null {
  if (!p.repo) return [];
  const t = trees[p.repo];
  if (!t) {
    const mine = (trees[p.repo] = { state: "loading" as "loading" | "ok" | "error", json: null as unknown, error: "" });
    fetchJson(treeUrl(p.repo)).then((text) => { mine.json = JSON.parse(text); mine.state = "ok"; }, (e) => { mine.state = "error"; mine.error = said(e); }).then(paint);
    return null;
  }
  if (t.state !== "ok") return null;
  try { return pluginSkills(t.json, p.path); } catch { return []; }
}
function connectorsOf(p: Plugin) {
  if (!p.repo) return [];
  const got = connectors[p.name];
  if (got === undefined) {
    connectors[p.name] = "loading";
    fetchJson(connectorsUrl(p.repo, p.path)).then((text) => { connectors[p.name] = parseConnectors(JSON.parse(text)); }, () => { connectors[p.name] = []; }).then(paint);
    return null;
  }
  return got === "loading" ? null : got;
}
const pluginIcon = (p: Plugin, cls = "") => coolIcon(p.title, `${p.category} ${p.description}`, undefined, "box", cls);
const pluginIn = (p: Plugin) => inv?.plugins.find((x) => x.name === p.name)?.agents || [];
const pluginHere = (p: Plugin) => pluginIn(p).length > 0;
/** The agents on this computer that have plugins of their own. */
const pluginAgents = () => cols().map((h) => h.id).filter((id) => PLUGIN_AGENTS.includes(id));
const pluginGet = (p: Plugin) => (pluginAgents().length && pluginAgents().every((a) => pluginIn(p).includes(a)) ? `<span class="get done" title="Installed in ${esc(pluginIn(p).map(chipOf).join(", "))}">Installed</span>` : `<button class="get" type="button" data-getplugin="${esc(p.name)}">Install</button>`);
const pluginRow = (p: Plugin) => `<div class="app"><button class="app-main" type="button" data-plugin="${esc(p.name)}">${pluginIcon(p)}<span class="app-t"><b>${esc(p.title)}</b>${appMeta([p.own ? MARKET.by : p.repo?.split("/")[0] || "A partner", p.description ? p.category : ""].filter(Boolean))}<small>${esc(p.description || p.category)}</small></span></button>${pluginGet(p)}</div>`;
const pluginHits = (ql: string) => market.plugins.filter((p) => `${p.title} ${p.name} ${p.description} ${p.category}`.toLowerCase().includes(ql));
function pluginShelf() {
  if (!enabled.has("plugins")) return "";
  const body = market.state === "ok" ? `<div class="${appsCls()}">${market.plugins.slice(0, SHELF).map(pluginRow).join("")}</div>${shelfFoot("Plugins", "plugins", market.plugins.length)}`
    : market.state === "error" ? `<p class="note bad">${glyph("warn")}<span>The plugin list could not be loaded. ${esc(market.error)}</span></p>` : `<p class="none">Loading plugins…</p>`;
  return `<section class="shelf">${shelfHead("Plugins", market.state === "ok" ? "plugins" : "", market.plugins.length)}<p>Bundles of skills and connectors for a kind of work, from ${esc(MARKET.by)} and its partners.</p>${body}</section>`;
}
function pluginView(p: Plugin) {
  const skills = skillsOf(p), conns = connectorsOf(p), owner = p.own ? MARKET.by : p.repo?.split("/")[0] || "A partner";
  const facts: [string, string][] = [["Kind", "Plugin"], ["From", owner], ["Skills", skills === null ? "…" : String(skills.length)], ["Connectors", conns === null ? "…" : String(conns.length)], ["On this computer", pluginHere(p) ? `In ${pluginIn(p).map(chipOf).join(", ")}` : "Not installed"]];
  // what is inside it, as the same cards the rest of the Catalog uses: one that Tool up! lists is shown as it is listed
  // (logo, description, its own Install); anything else gets a plain card that opens its folder on GitHub
  const words = (id: string) => id.split(/[-_]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  const skillCard = (path: string) => {
    const id = path.split("/").pop()!, known = cards.find((x) => x.sec === "skill" && x.id === id && x.repo === p.repo) || cards.find((x) => x.sec === "skill" && x.id === id);
    if (known) return appRow(known);
    return `<div class="app k-skill"><button class="app-main" type="button" data-url="${esc(repoUrl(p.repo!, path))}" title="Open its folder on GitHub">${coolIcon(words(id), "", undefined, "book-open", "round")}<span class="app-t"><b>${esc(words(id))}</b>${appMeta([owner, "Skill"])}<small>${esc(path)}</small></span></button></div>`;
  };
  const connCard = (c: { name: string; host: string }) => {
    const hostOf = (u?: string) => { try { return new URL(u || "").host; } catch { return ""; } };
    const known = raw.mcp.find((m) => (c.host && hostOf((m as { url?: string }).url) === c.host) || m.id === c.name.toLowerCase());
    if (known && listed.has(known.id)) return appRow(listed.get(known.id)!);
    return `<div class="app k-mcp"><span class="app-main">${coolIcon(words(c.name), "", undefined, "cat-mcp", "")}<span class="app-t"><b>${esc(words(c.name))}</b>${appMeta(["MCP server"])}<small>${esc(c.host || "Runs on this computer")}</small></span></span></div>`;
  };
  return `<div class="crumb-row">${crumbs(p.title)}${layToggle()}</div>
    <div class="hero">${pluginIcon(p, "big")}<div class="hero-t"><h1>${esc(p.title)}</h1><p>${esc(owner)}${p.category ? ` · ${esc(p.category)}` : ""}</p><span class="hero-b">${pluginGet(p)}${p.repo ? `<button class="btn small" type="button" data-url="${esc(repoUrl(p.repo, p.path))}">${glyph("github")}View on GitHub</button>` : ""}</span></div></div>
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    <section class="shelf"><h2>About</h2><p class="about">${mdLine(p.description || "No description.", true)}</p>
      <p>Claude Code installs it as a plugin, with everything in it. Codex has plugins too: Tool up! adds this plugin to Codex's list, and you finish the install inside Codex. Agents without plugins get its skills; its connectors are not added to them.</p></section>
    <section class="shelf"><h2>Skills${skills?.length ? ` <small class="h-n">${skills.length}</small>` : ""}</h2>${skills === null ? `<p class="none">Looking in ${esc(p.repo)}…</p>` : skills.length ? `<p>What it teaches your agents. They come with the plugin; one that is also on Tool up!'s list can be installed on its own.</p><div class="${appsCls()}">${skills.map(skillCard).join("")}</div>` : `<p class="none">${p.repo ? "This plugin has no skills of its own." : "Its files are not on GitHub, so its skills can't be listed here."}</p>`}</section>
    ${conns && conns.length ? `<section class="shelf"><h2>Connectors <small class="h-n">${conns.length}</small></h2><p>The services it can reach. Each one asks you to sign in the first time.</p><div class="${appsCls()}">${conns.map(connCard).join("")}</div></section>` : ""}`;
}
/** Install a plugin: whole in Claude Code, and its skills in the other agents ticked. */
function openInstallPlugin(p: Plugin) {
  const targets = new Set(into!), store = expand(SKILL_STORE, home);
  const order = () => cols().map((h) => h.id).filter((a) => targets.has(a));
  const names = (a: string[]) => a.map(chipOf).join(", ");
  let skills: string[] = [];
  return openSheet({
    title: `Install ${p.title}?`, sub: "Plugin", targets,
    prepare: async (s) => {
      if (p.repo) { const text = trees[p.repo]?.state === "ok" ? null : await fetchJson(treeUrl(p.repo)).catch(() => null); if (text) trees[p.repo] = { state: "ok", json: JSON.parse(text), error: "" }; }
      try { skills = p.repo && trees[p.repo]?.state === "ok" ? pluginSkills(trees[p.repo].json, p.path) : []; } catch { skills = []; }
      const t = order(), claude = t.includes("claude-code"), codex = t.includes("codex"), rest = t.filter((a) => !PLUGIN_AGENTS.includes(a)), has = pluginIn(p);
      s.steps = [
        { logo: pluginIcon(p), title: p.title, detail: p.description.length > 140 ? `${p.description.slice(0, 140)}…` : p.description, state: "info" },
        ...(claude ? [{ logo: logo(agents.get("claude-code")!.icon), title: "Claude Code", detail: has.includes("claude-code") ? "Already installed" : `The whole plugin${skills.length ? `: ${plural(skills.length, "skill")} and its connectors` : ""}`, state: has.includes("claude-code") ? "skip" : "todo" } as Step] : []),
        ...(codex ? [{ logo: logo(agents.get("codex")!.icon), title: "Codex", detail: has.includes("codex") ? "Already installed" : "Added to Codex's plugin list. To finish, open Codex, type /plugins and choose Install.", state: has.includes("codex") ? "skip" : "todo" } as Step] : []),
        ...(rest.length ? [{ logo: tile("folder"), title: names(rest), detail: skills.length ? `Its ${plural(skills.length, "skill")}. Connectors are not added.` : "Nothing to add: its skills can't be read from here.", state: skills.length ? "todo" : "skip" } as Step] : []),
      ];
      s.idle = !s.steps.some((st) => st.state === "todo");
      s.note = !t.length ? "Turn on at least one agent." : "A plugin's skills tell your agents what to do, so only install ones you trust.";
    },
    run: async (s) => {
      const t = order(), rest = t.filter((a) => !PLUGIN_AGENTS.includes(a)), has = pluginIn(p);
      let ok = true; s.log = "";
      if (!demo && t.includes("claude-code") && !has.includes("claude-code")) { const r = await claudePlugin(p.market, p.marketName, p.name); s.log = r.output; ok = r.code === 0; }
      if (!demo && t.includes("codex") && !has.includes("codex")) { const r = await codexMarketplace(p.market); s.log += `\n${r.output}`; ok = ok && r.code === 0; }
      if (!demo && rest.length && skills.length && p.repo) {
        try {
          const dirs = rest.map(ownDir).filter((d): d is string => !!d);
          for (const got of await fetchSkills(p.repo, skills)) {
            const meta = JSON.stringify({ repo: p.repo, path: got.path, sha: "", plugin: p.name, installedAt: new Date().toISOString() });
            if (skillMode === "link") await installSkill(got.staged, [store], dirs, meta); else await installSkill(got.staged, dirs, [], meta);
          }
        } catch (e) { ok = false; s.log += `\n${said(e)}`; }
      }
      await load(true);
      s.steps = s.steps.map((st) => (st.state === "todo" ? { ...st, state: ok ? "done" : "fail" } : st));
      s.note = !ok ? "" : t.includes("codex") && !has.includes("codex") ? "One step left for Codex: open it, type /plugins and choose Install. Your other agents pick it up the next time they start." : "Your agents pick it up the next time they start.";
      return ok;
    },
  });
}

function queueSearch() {
  clearTimeout(searchTimer);
  const term = q.trim(), on = SOURCES.filter((s) => enabled.has(s.id));
  searchSeq++;
  if (screen !== "catalog" || term.length < 2 || !on.length) { ext = {}; return; }
  for (const s of on) ext[s.id] = { state: "loading", items: [], error: "" };
  const seq = searchSeq;
  searchTimer = window.setTimeout(() => {
    for (const s of on) (async () => {
      let next: ExtState;
      try { next = { state: "ok", items: s.parse(JSON.parse(await fetchJson(s.url(term)))), error: "" }; }
      catch (e) { next = { state: "error", items: [], error: said(e) }; }
      if (seq === searchSeq) { ext[s.id] = next; paint(); }
    })();
  }, 350);
}

/* ---------- look: light or dark, and the accent colour (Settings) ---------- */
const THEMES: [string, string][] = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];
// the first is Tool up!'s own violet, tuned by hand; the others are worked out from one colour each (see style.css)
const ACCENTS: [string, string, string][] = [["violet", "Violet", "#7d22d8"], ["blue", "Blue", "#2563eb"], ["teal", "Teal", "#0d8f80"], ["green", "Green", "#2f8f3a"], ["orange", "Orange", "#d9670f"], ["pink", "Pink", "#d6337f"], ["graphite", "Graphite", "#5b5f6b"]];
// On the website the app runs inside a frame, on sample data (?embed). The page around it says so, and tells it which
// look to wear (?theme=dark, then a message whenever the page's own light/dark button is pressed).
const embed = demo && new URLSearchParams(location.search).has("embed");
const asked = embed ? new URLSearchParams(location.search).get("theme") || "" : "";
let theme = THEMES.some(([t]) => t === asked) ? asked : THEMES.some(([t]) => t === saved("toolup.theme")) ? saved("toolup.theme") : "system";
if (embed) window.addEventListener("message", (e) => {
  const d = e.data as { toolup?: string; theme?: string } | null;
  if (e.origin !== location.origin || d?.toolup !== "theme" || !THEMES.some(([t]) => t === d.theme)) return;
  theme = d.theme!; applyLook();
});
let accent = ACCENTS.some(([a]) => a === saved("toolup.accent")) ? saved("toolup.accent") : "violet";
const DARK = "(prefers-color-scheme: dark)", darkRules = new Set<CSSMediaRule>();
function applyLook() {
  const root = document.documentElement;
  // the dark styles are written as "when the system is dark" rules. A fixed choice switches those rules always on
  // (Dark) or always off (Light); "System" puts them back as they were.
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of [...rules]) if (r instanceof CSSMediaRule && /prefers-color-scheme:\s*dark/.test(r.media.mediaText)) darkRules.add(r);
  }
  for (const r of darkRules) r.media.mediaText = theme === "dark" ? "all" : theme === "light" ? "not all" : DARK;
  root.style.colorScheme = theme === "system" ? "" : theme;
  const hex = ACCENTS.find(([a]) => a === accent)![2];
  if (accent === "violet") { delete root.dataset.accent; root.style.removeProperty("--brand"); }
  else { root.dataset.accent = accent; root.style.setProperty("--brand", hex); }
}

// Settings lists the agents found here and the three most used; the rest sit behind "Show more"
let moreAgents = false;
const MAIN_AGENTS = ["claude-code", "codex", "gemini"];
function settingsView() {
  // the agent's own mark, with no tile around it: in its colours while it is in use, in one colour when it is off or not installed
  const bare = (id: string, icon: Icon, off: boolean) => (off || !icon.svg
    ? `<span class="amark${off ? " off" : ""}"${off || !icon.color ? "" : ` style="color:${icon.color}"`} aria-hidden="true">${mono(id, icon)}</span>`
    : `<span class="amark" aria-hidden="true"><svg viewBox="0 0 24 24">${icon.svg}</svg></span>`);
  const agentRow = (h: HarnessReport) => { const a = agents.get(h.id); return `<li class="agent-row">${a ? bare(h.id, a.icon, !h.present || agentsOff.has(h.id)) : ""}<b>${esc(h.name)}</b>${h.present ? `<span class="state ${agentsOff.has(h.id) ? "" : "found"}">${agentsOff.has(h.id) ? "Installed, not used" : "Installed"}</span><label class="tog" title="${agentsOff.has(h.id) ? `Use ${esc(h.name)} in Tool up! again` : `Leave ${esc(h.name)} out: no switches for it, and nothing is installed into it`}"><input type="checkbox" role="switch" data-agent-use="${h.id}" aria-label="Use ${esc(h.name)} in Tool up!" ${agentsOff.has(h.id) ? "" : "checked"}><span class="tog-t" aria-hidden="true"></span></label>` : `<span class="state">Not installed</span>${getAgentUrl(h.id) ? `<button class="get" type="button" data-getagent="${h.id}" title="Opens ${esc(h.name)}'s download page in your browser">Get</button>` : ""}`}</li>`; };
  const shownFirst = inv!.harnesses.filter((h) => h.present || MAIN_AGENTS.includes(h.id)), hidden = inv!.harnesses.filter((h) => !shownFirst.includes(h));
  const agentRows = moreAgents ? [...shownFirst, ...hidden] : shownFirst;
  const html = `
    <h3>Appearance</h3>
    <p class="hint">How the window looks. These are kept on this computer.</p>
    <ul class="sets">
      <li class="look"><span class="set-t"><b>Theme</b><small>Light, dark, or whatever your computer is set to.</small></span>
        <span class="seg" role="group" aria-label="Theme">${THEMES.map(([t, label]) => `<button type="button" data-theme-set="${t}" aria-pressed="${theme === t}">${label}</button>`).join("")}</span></li>
      <li class="look"><span class="set-t"><b>Accent colour</b><small>The colour of buttons, links and what is switched on.</small></span>
        <span class="swatches" role="group" aria-label="Accent colour">${ACCENTS.map(([a, label, hex]) => `<button type="button" data-accent-set="${a}" aria-pressed="${accent === a}" title="${label}" aria-label="${label}" style="--c:${hex}"></button>`).join("")}</span></li>
      <li class="look"><span class="set-t"><b>Agents scene</b><small>The picture of your agents at the top of the Installed screen.</small></span>
        <span class="seg" role="group" aria-label="Agents scene"><button type="button" data-meadow-show="1" aria-pressed="${!meadowOff}">Show</button><button type="button" data-meadow-show="0" aria-pressed="${meadowOff}">Hide</button></span></li>
      ${meadowOff ? "" : `<li class="look"><span class="set-t"><b>Scene animation</b><small>The sea moves and the agents breathe and stir. Still when your Mac asks for reduced motion.</small></span>
        <span class="seg" role="group" aria-label="Scene animation"><button type="button" data-meadow-move="1" aria-pressed="${!meadowStill}">Moving</button><button type="button" data-meadow-move="0" aria-pressed="${meadowStill}">Still</button></span></li>`}
    </ul>
    <h3>Agents</h3>
    <p class="hint">The agents Tool up! looks for on this computer. Switch one off to leave it out: it gets no switches, and nothing is installed into it.</p>
    <ul class="sets">${agentRows.map(agentRow).join("")}${hidden.length ? `<li class="more-row"><button class="link" type="button" data-more-agents>${moreAgents ? "Show fewer" : `Show ${hidden.length} more`}</button></li>` : ""}</ul>
    <h3>Backup</h3>
    <p class="hint">Keep Tool up!'s saved skills in a GitHub repository of yours, and bring them back on another computer. It uses your own git and its sign-in.</p>
    <ul class="sets"><li><label class="key"><span>Repository (use a private one)</span><input id="backup-repo" type="text" value="${esc(backupRepo)}" placeholder="https://github.com/you/skills-backup" autocomplete="off" spellcheck="false"></label></li>
      <li class="look"><span class="set-t"><b>Saved skills</b><small>Back up commits and pushes them. Restore pulls them, and never overwrites what is here.</small></span><span class="pair"><button class="btn" type="button" data-backup="restore">Restore…</button><button class="btn pri" type="button" data-backup="push">Back up…</button></span></li></ul>
    <h3>New skills</h3>
    <p class="hint">How a skill is added when you install one. You can still change it for a single install.</p>
    <ul class="sets">${SKILL_MODES.map(([v, label, hint]) => `<li><label class="sw"><input type="radio" name="skill-mode" value="${v}" ${skillMode === v ? "checked" : ""}><span class="set-t"><b>${esc(label)}</b><small>${esc(hint)}</small></span></label></li>`).join("")}</ul>`;
  // each section (a heading, a line about it, its rows) is a block, one under the other in a single column
  return `<div class="settings"><div class="head"><div><h1>Settings</h1></div></div>${html.split("<h3>").slice(1).map((x) => `<section class="set-sec"><h3>${x}</section>`).join("")}</div>`;
}

/* ---------- the tray (your picks) and the install sheet ---------- */
function tray() {
  if (screen !== "catalog" || !picked.size || !inv) return "";
  const cs = cols(), items = [...picked].map((id) => listed.get(id)!).sort(byName);
  const nm = items.filter((x) => x.sec === "mcp").length, ns = items.length - nm;
  const targets = cs.map((h) => { const a = agents.get(h.id); return `<button class="agent" type="button" data-agent="${h.id}" aria-pressed="${into!.has(h.id)}" title="${esc(h.name)}">${a ? logo(a.icon, "tiny") : ""}<span>${esc(a?.chip || h.name)}</span></button>`; }).join("");
  return `<div class="tray"><div class="tray-in">
    <div class="tray-h"><b>${plural(items.length, "pick")}</b><span>${plural(nm, "MCP")} · ${plural(ns, "skill")}</span><button class="link" type="button" data-save-preset>Save as preset…</button><button class="link" type="button" data-clear>Clear</button></div>
    <ul class="picks" aria-label="Picked items">${items.map((x) => `<li class="k-${x.sec}">${cardLogo(x, "tiny")}<span>${esc(x.name)}</span><button type="button" data-unpick="${x.id}" aria-label="Remove ${esc(x.name)}">${glyph("x")}</button></li>`).join("")}</ul>
    <div class="tray-f"><span class="lbl">Into</span><div class="agents" role="group" aria-label="Agents to install into">${targets || `<span class="lbl">no agents found</span>`}</div>
      <button class="btn pri" type="button" data-install ${cs.length && into!.size ? "" : "disabled"}>Install…</button></div>
  </div></div>`;
}
const tilde = (p: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);
const said = (e: unknown) => (e instanceof Error ? e.message : String(e));
const chipOf = (id: string) => agents.get(id)?.chip || id;
const tile = (k: string, cls = "") => `<span class="ico plain ${cls}" aria-hidden="true">${glyph(k)}</span>`;

function sheetHtml() {
  const s = sheet;
  if (!s) return "";
  const busy = s.phase === "preview" || s.phase === "running";
  const title = { preview: "One moment…", ready: s.title, running: s.danger ? "Removing…" : "Installing…", done: "Done", failed: s.steps.length ? "Some of this did not work" : "That did not work" }[s.phase];
  const mark = { todo: "", skip: glyph("check"), done: glyph("check"), fail: glyph("x"), info: "" };
  // while the question is open, steps that can be left out are tick boxes; once it runs they are plain steps again
  const canPick = s.phase === "ready" && !!s.pick, picks = s.steps.filter((st) => st.pick), ticked = picks.filter((st) => st.picked).length;
  const li = (st: Step) => canPick && st.pick
    ? `<li class="s-${st.state} pickable" role="checkbox" tabindex="0" aria-checked="${!!st.picked}" data-step-pick="${esc(st.pick)}">${st.logo}<span class="st-t"><b>${esc(st.title)}</b>${st.detail ? `<small>${mdLine(st.detail)}</small>` : ""}</span><span class="st-box" aria-hidden="true">${st.picked ? glyph("check") : ""}</span></li>`
    : `<li class="s-${st.state}">${st.logo}<span class="st-t"><b>${esc(st.title)}</b>${st.detail ? `<small>${mdLine(st.detail)}</small>` : ""}</span><span class="st-m">${mark[st.state]}</span></li>`;
  const pickBar = canPick && picks.length > 1 ? `<div class="pick-bar"><span>${ticked} of ${picks.length} selected</span><button class="link" type="button" data-step-all="${ticked === picks.length ? "0" : "1"}">${ticked === picks.length ? "Select none" : "Select all"}</button></div>` : "";
  const steps = s.steps.length ? `${pickBar}<ul class="steps">${s.steps.map(li).join("")}</ul>` : "";
  const choice = s.choice && s.phase === "ready" ? `<label class="how"><span>Install as</span><select name="choice" aria-label="How to install it">${s.choice.options.map(([v, label, hint]) => `<option value="${v}" title="${esc(hint)}" ${s.choice!.value === v ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>` : "";
  const tech = s.tech.length && !busy ? `<details class="log"><summary>Details</summary><div>${esc(s.tech.join("\n"))}</div></details>` : "";
  const pickers = s.targets && s.phase === "ready" ? `<div class="sheet-agents"><span class="lbl">For</span><div class="agents" role="group" aria-label="Agents that get it">${cols().map((h) => { const a = agents.get(h.id); return `<button class="agent" type="button" data-sheet-agent="${h.id}" aria-pressed="${s.targets!.has(h.id)}" title="${esc(h.name)}">${a ? logo(a.icon, "tiny") : ""}<span>${esc(a?.chip || h.name)}</span></button>`; }).join("")}</div></div>` : "";
  const log = s.phase === "failed" && s.log.trim() ? `<details class="log"><summary>What the installer reported</summary><div>${esc(s.log.trim())}</div></details>` : "";
  const buttons = s.phase === "ready" && !s.idle ? `<button class="btn" type="button" data-close>Cancel</button><button class="btn pri ${s.danger ? "danger" : ""}" type="button" data-run>${esc(s.confirm)}</button>`
    : busy ? `<span class="spin" aria-hidden="true"></span>` : `<button class="btn pri" type="button" data-close>Close</button>`;
  return `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t">
    <h2 id="sheet-t">${esc(title)}</h2>
    ${s.sub ? `<p class="sheet-sub">${esc(s.sub)}</p>` : ""}
    ${pickers}${steps}
    ${s.note ? `<p class="sheet-note">${esc(s.note)}</p>` : ""}${tech}${log}
    <div class="sheet-b">${choice}${s.presetIds?.length && s.phase === "ready" ? `<button class="link" type="button" data-sheet-preset>${s.presetIds.length > 1 ? "Save as a collection…" : "Add to a collection…"}</button>` : ""}${s.link && !busy ? `<button class="link" type="button" data-url="${esc(s.link.url)}">${esc(s.link.label)}</button>` : ""}<span class="grow"></span>${buttons}</div></div></div>`;
}
async function openSheet(spec: Pick<Sheet, "title" | "sub" | "prepare" | "run"> & Partial<Sheet>) {
  const s: Sheet = { confirm: "Install", danger: false, phase: "preview", steps: [], note: "", log: "", tech: [], idle: false, fromTray: false, targets: null, link: null, choice: null, ...spec };
  sheet = s; paint();
  try { await s.prepare(s); s.phase = "ready"; }
  catch (e) { s.steps = []; s.note = said(e); s.phase = "failed"; }
  if (sheet === s) paint();
}
/** A step's tick box (or "Select all / none") was used: tell the sheet, work the steps out again, keep the list where it was. */
function pickStep(el: HTMLElement) {
  const s = sheet!, id = el.dataset.stepPick ?? null, top = document.querySelector(".sheet .steps")?.scrollTop || 0;
  s.pick!(id, el.dataset.stepAll === "1");
  s.idle = false;
  return s.prepare(s).catch((e) => { s.steps = []; s.note = said(e); s.idle = true; }).then(() => {
    if (sheet !== s) return;
    paint();
    const list = document.querySelector(".sheet .steps");
    if (list) list.scrollTop = top;
    if (id) document.querySelector<HTMLElement>(`.sheet [data-step-pick="${CSS.escape(id)}"]`)?.focus();
  });
}
async function runSheet() {
  const s = sheet;
  if (!s || s.phase !== "ready") return;
  s.phase = "running"; paint();
  let ok = false;
  try { ok = await s.run(s); }
  catch (e) { s.note = said(e); }
  s.phase = ok ? "done" : "failed";
  if (ok && s.fromTray) picked.clear();
  if (ok && s.closeWhenDone && sheet === s) sheet = null;
  const land = ok ? pastedInto.get(s) : "";
  if (land) { screen = "installed"; instFilter = land; q = ""; document.querySelector<HTMLInputElement>("#q")!.value = ""; }
  paint();
}

/** Catalog items, through the Tool up! installer, into the agents ticked in the sheet (or the one gap clicked). */
function openInstall(ids: string[], targets: Set<string>, fromTray: boolean) {
  const names = (a: string[]) => a.map(chipOf).join(", ");
  const order = () => cols().map((h) => h.id).filter((id) => targets.has(id));
  const steps = (after: boolean, ran = true): Step[] => ids.map((id) => {
    const x = listed.get(id)!, t = order().filter((a) => x.sec !== "mcp" || serves(a)), have = haveIt(id);
    const missing = t.filter((a) => !have.includes(a)), has = t.filter((a) => have.includes(a));
    const base = { logo: cardLogo(x), title: x.name };
    if (!t.length) return { ...base, detail: "None of the agents chosen takes MCP servers from Tool up! yet", state: "skip" };
    if (!after) return { ...base, detail: missing.length ? `Add to ${names(missing)}${has.length ? ` · already in ${names(has)}` : ""}` : `Already in ${names(has)}`, state: missing.length ? "todo" : "skip" };
    if (!missing.length) return { ...base, detail: `In ${names(t)}`, state: "done" };
    return { ...base, detail: ran ? `The installer finished, but it does not show up in ${names(missing)}` : `Not added to ${names(missing)}`, state: "fail" };
  });
  return openSheet({
    title: `Install ${plural(ids.length, "item")}?`, sub: fromTray ? "" : `Into ${names(order())}`, fromTray, targets: fromTray ? targets : null, presetIds: ids.filter((id) => listed.has(id)),
    prepare: async (s) => {
      if (!targets.size) { s.steps = []; s.idle = true; s.note = "Turn on at least one agent."; return; }
      s.steps = steps(false);
      s.idle = s.steps.every((st) => st.state === "skip");
      s.note = s.idle ? "Everything here is already installed." : "Servers that need you to sign in will ask the first time an agent uses them.";
    },
    run: async (s) => {
      const to = order();
      s.note = ""; s.log = "";
      if (demo) { await toolup(ids, to, false); s.steps = s.steps.map((st) => ({ ...st, state: "done" })); return true; }
      // servers go through the Tool up! installer; skills are fetched from their repo, so each agent can have them on or off
      const servers = ids.filter((id) => listed.get(id)?.sec === "mcp"), skills = ids.filter((id) => listed.get(id)?.sec === "skill");
      let ok = true;
      const st = to.filter(serves);
      if (servers.length && st.length) { const r = await toolup(servers, st.length === cols().length ? [] : st, false); s.log = r.output; ok = r.code === 0; }
      for (const id of skills) {
        try { await addCatalogSkill(id, to); }
        catch (e) { ok = false; s.log += `\n${listed.get(id)!.name}: ${said(e)}`; }
      }
      await load(true);
      s.steps = steps(true, ok);
      return ok && s.steps.every((st) => st.state === "done" || st.state === "skip");
    },
  });
}

/** A remote MCP server from another catalog, into the agents ticked. */
function openInstallServer(f: Found, id: string, url: string) {
  const targets = new Set(into!), host = new URL(url).host, key = `url:${bareUrl(url)?.url}`;
  const logoHtml = coolIcon(f.name, f.description, undefined, "cat-mcp", "");
  const order = () => cols().map((h) => h.id).filter((a) => targets.has(a) && serves(a));   // only the agents that take servers
  const names = (a: string[]) => a.map(chipOf).join(", ");
  const have = () => { const item = inv!.items.find((i) => i.key === key); return order().filter((a) => item?.in[a]); };
  return openSheet({
    title: `Install ${f.name}?`, sub: `${f.by ? `${f.by} · ` : ""}${host}`, targets,
    prepare: async (s) => {
      const t = order(), has = have(), missing = t.filter((a) => !has.includes(a));
      s.steps = t.length ? [{ logo: logoHtml, title: f.name, detail: missing.length ? `Add to ${names(missing)}${has.length ? ` · already in ${names(has)}` : ""}` : `Already in ${names(has)}`, state: missing.length ? "todo" : "skip" }] : [];
      s.idle = !missing.length;
      s.note = !t.length ? "Turn on at least one agent." : `This connects your agents to ${host}. It comes from ${sourceOf(f.source)?.name || "a command you pasted"}, not from Tool up!'s checked list.`;
    },
    run: async (s) => {
      const t = order(), r = await toolupServers([{ id, name: f.name, url }], t.length === cols().length ? [] : t, false);
      s.log = r.output; s.note = "";
      if (demo) { s.steps = s.steps.map((st) => ({ ...st, state: "done" })); return true; }
      await load(true);
      const missing = t.filter((a) => !have().includes(a));
      s.steps = [{ logo: logoHtml, title: f.name, detail: missing.length ? `${r.code === 0 ? "The installer finished, but it does not show up in" : "Not added to"} ${names(missing)}` : `In ${names(t)}`, state: missing.length ? "fail" : "done" }];
      return r.code === 0 && !missing.length;
    },
  });
}

/** The latest version of a skill's folder on GitHub, or "" when GitHub cannot be asked right now. */
async function latestSha(repo: string, path: string) {
  try { return parseLatestCommit(JSON.parse(await fetchJson(latestCommitUrl(repo, path)))).sha; }
  catch { return ""; }
}
/** The note left beside a skill: where it came from and which version, so a newer one can be noticed later. */
const metaFor = async (repo: string, path: string) => JSON.stringify({ repo, path, sha: await latestSha(repo, path), installedAt: new Date().toISOString() });
const copyOf = (item: Item) => item.store || Object.values(item.in).find((p) => !p.linked)?.source || Object.values(item.in)[0]?.linkTo || "";

/** Turn a Tool up! catalog skill on for these agents: link to the copy already here, or fetch it from its repo. */
async function addCatalogSkill(id: string, to: string[]) {
  const x = listed.get(id)!, item = inv!.items.find((i) => i.kind === "skill" && (i.catalogId === id || i.key === `skill:${id}`));   // the copy already here, whatever its folder is called
  const want = to.filter((a) => !item?.in[a]).map(ownDir).filter((d): d is string => !!d);
  if (!want.length) return;
  if (item && copyOf(item)) return void (await linkSkill(copyOf(item), want));
  const got = await fetchSkill(x.repo!, id, ""), meta = await metaFor(x.repo!, got.path);
  if (skillMode === "link") await installSkill(got.staged, [expand(SKILL_STORE, home)], want, meta);
  else await installSkill(got.staged, want, [], meta);
}

/** An agent's own skills folder, where a link or a copy turns a skill on for that agent alone. */
const ownDir = (id: string) => { const d = ownSkillsDir(catalog.agents.find((a) => a.id === id)!); return d ? expand(d, home) : null; };

/** A .skill file dropped on the window. */
const openSkillFile = (path: string) => openSkill(path.split(/[\\/]/).pop() || path, path);

/**
 * A skill to install, from a file on this computer or from a folder in a GitHub repo:
 * one shared copy that each agent ticked links to, or a copy for each of them.
 */
function openSkill(label: string, from: string | { repo: string; skill: string; path: string }) {
  const store = expand(SKILL_STORE, home);
  let name = "", shown = "", path = "", origin: { repo: string; path: string } | null = null, findings: Finding[] | null = null;
  const chosen = (s: Sheet) => cols().map((h) => h.id).filter((id) => s.targets!.has(id) && ownDir(id)).map((id) => ({ chip: chipOf(id), dir: ownDir(id)! }));
  const plan = (s: Sheet) => { const dirs = chosen(s).map((a) => a.dir); return s.choice!.value === "link" ? { dirs: [store], links: dirs } : { dirs, links: [] as string[] }; };
  const and = (a: string[]) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a[0] || "");
  return openSheet({
    title: "Install this skill?", sub: label, targets: new Set(into!),
    choice: { value: skillMode, options: SKILL_MODES },
    prepare: async (s) => {
      if (!path) {   // a download happens once, however often the choices change
        if (typeof from === "string") path = from;
        else { const got = await fetchSkill(from.repo, from.skill, from.path); path = got.staged; origin = { repo: from.repo, path: got.path }; }
      }
      const f = await inspectSkill(path), fm = frontMatter(f.skillMd), sel = chosen(s), link = s.choice!.value === "link";
      name = f.name; shown = fm.name || f.name;
      const exists = inv!.items.some((i) => i.key === `skill:${f.name}`);
      s.steps = [{ logo: coolIcon(shown, fm.description || "", undefined, "book-open", "round"), title: shown, detail: fm.description || "", state: "info" }];
      if (findings === null) findings = demo ? [] : await skillTexts(path).then(scanSkill, () => []);   // its files are read once
      s.steps.push(safetyStep(findings));
      s.idle = !sel.length && !link;
      s.note = [
        sel.length ? `It will be turned on for ${and(sel.map((a) => a.chip))}.` : link ? "No agent is turned on. It will be saved, and you can turn it on later." : "Turn on at least one agent.",
        exists ? "You already have a skill with this name; this replaces it." : "",
        "Skills tell your agents what to do, so only install ones you trust.",
      ].filter(Boolean).join(" ");
      s.tech = [
        plural(f.files, "file"),
        ...(link ? [`Saved in ${tilde(store)}/${f.name}`, ...sel.map((a) => `${a.chip}: ${tilde(a.dir)}/${f.name} → the saved copy (a link)`)] : sel.map((a) => `${a.chip}: its own copy in ${tilde(a.dir)}/${f.name}`)),
      ];
      const high = findings.some((x) => x.severity === "high"), mine = inv!.items.find((i) => i.key === `skill:${f.name}`);
      s.tech.push(...findings.map(findingLine));
      s.danger = high; s.confirm = high ? "Install anyway" : "Install";
      if (high) s.note = `The safety check found something serious. Read it under Details before you go on. ${s.note}`;
      if (mine && !managed(mine)) {   // a skill of the same name that Tool up! did not put there is never written over
        s.idle = true;
        s.note = `You already have your own skill called ${f.name} (${tilde(placeOf(mine))}). Tool up! did not install it, so it is not replaced. Delete yours first, or make an editable copy of it under another name.`;
      }
    },
    run: async (s) => {
      const p = plan(s), sel = chosen(s);
      await installSkill(path, p.dirs, p.links, origin ? await metaFor(origin.repo, origin.path) : "");
      s.steps = s.steps.map((st) => ({ ...st, state: "done" }));
      s.note = sel.length ? `${shown} is on for ${and(sel.map((a) => a.chip))}. They pick it up the next time they start.` : `${shown} is saved. Turn it on for an agent from the Installed list.`;
      await load(true);
      return true;
    },
  });
}

/** Every skill in a GitHub repo, or the ones named: what `npx skills add owner/repo` asks for. Each can be left out. */
function openSkillsRepo(repo: string, names: string[]) {
  const store = expand(SKILL_STORE, home), nameOf = (p: string) => p.split("/").pop()!;
  let paths: string[] | null = null, absent: string[] = [];
  const left = new Set<string>();   // the skills whose box was cleared
  const yours = (p: string) => { const m = inv!.items.find((i) => i.key === `skill:${nameOf(p)}`); return !!m && !managed(m); };   // not installed by Tool up!: never written over
  const held = new Map<string, string>();
  const wanted = () => paths!.filter((p) => !left.has(p) && !yours(p));
  const chosen = (s: Sheet) => cols().map((h) => h.id).filter((id) => s.targets!.has(id) && ownDir(id));
  return openSheet({
    title: "Install these skills?", sub: repo, targets: new Set(into!), choice: { value: skillMode, options: SKILL_MODES },
    pick: (id, all) => { if (id === null) { left.clear(); if (!all) paths!.forEach((p) => left.add(p)); } else if (left.has(id)) left.delete(id); else left.add(id); },
    prepare: async (s) => {
      if (!paths) {   // the repo is looked at once, however often the choices change
        const all = repoSkills(JSON.parse(await fetchJson(treeUrl(repo))));
        paths = names.length ? all.filter((p) => names.includes(nameOf(p))) : all;
        absent = names.filter((n) => !paths!.some((p) => nameOf(p) === n));
      }
      if (!paths.length) throw new Error(names.length ? `${repo} has no skill called ${names.join(" or ")}.` : `No skills were found in ${repo}.`);
      const sel = chosen(s), link = s.choice!.value === "link", want = wanted(), have = (p: string) => inv!.items.some((i) => i.key === `skill:${nameOf(p)}`);
      s.title = want.length ? `Install ${plural(want.length, "skill")}?` : "Install which skills?";
      s.steps = paths.map((p): Step => (yours(p)
        ? { logo: coolIcon(nameOf(p), "", undefined, "book-open", "round"), title: nameOf(p), detail: "Kept: you have your own skill with this name, and it is not replaced", state: "skip" }
        : { logo: coolIcon(nameOf(p), "", undefined, "book-open", "round"), title: nameOf(p), detail: have(p) ? "You already have one with this name; this replaces it" : "", state: left.has(p) ? "skip" : "todo", pick: p, picked: !left.has(p) }));
      s.idle = !want.length || (!sel.length && !link);
      s.note = [
        !want.length ? "Tick at least one skill." : sel.length ? `${want.length === 1 ? "It" : "They"} will be turned on for ${sel.map(chipOf).join(", ")}.` : link ? "No agent is turned on. They will be saved, and you can turn them on later." : "Turn on at least one agent.",
        absent.length ? `Not found in the repo: ${absent.join(", ")}.` : "",
        "Skills tell your agents what to do, so only install ones you trust.",
      ].filter(Boolean).join(" ");
      s.tech = want.map((p) => `${repo}/${p}`);
    },
    run: async (s) => {
      const dirs = chosen(s).map((id) => ownDir(id)!), link = s.choice!.value === "link", want = wanted();
      const got = await fetchSkills(repo, want);
      for (const g of got) {
        // each skill's files are checked before it goes in; one with a serious finding waits to be installed alone, where it can be read
        const bad = demo ? [] : await skillTexts(g.staged).then((t) => scanSkill(t).filter((x) => x.severity === "high"), () => []);
        if (bad.length) { held.set(nameOf(g.path), bad[0].why); continue; }
        // asking GitHub for each skill's version is kept for small sets; a big one is installed untracked
        const meta = got.length <= 5 ? await metaFor(repo, g.path) : JSON.stringify({ repo, path: g.path, sha: "", installedAt: new Date().toISOString() });
        if (link) await installSkill(g.staged, [store], dirs, meta); else await installSkill(g.staged, dirs, [], meta);
      }
      const done = new Set(got.map((g) => nameOf(g.path)).filter((n) => !held.has(n)));
      s.steps = want.map((p): Step => ({ logo: coolIcon(nameOf(p), "", undefined, "book-open", "round"), title: nameOf(p), detail: done.has(nameOf(p)) ? "" : held.has(nameOf(p)) ? `Held back by the safety check: ${held.get(nameOf(p))} Install it on its own to read what was found.` : "Could not be fetched", state: done.has(nameOf(p)) ? "done" : "fail" }));
      s.note = got.length < want.length ? "" : `Your agents pick ${want.length === 1 ? "it" : "them"} up the next time they start.`;
      await load(true);
      return got.length === want.length && !held.size;
    },
  });
}

/**
 * An install command pasted into the window (see core/paste.ts): the app does what it says with its own installers,
 * after showing what that is. What gets installed lands under Custom in the Installed list.
 */
const pastedInto = new WeakMap<Sheet, string>();
const tell = (sub: string, why: string) => openSheet({ title: "", sub, prepare: async () => { throw new Error(why); }, run: async () => false });
async function openPasted(p: Pasted) {
  const land = (filter: string) => { if (sheet) pastedInto.set(sheet, filter); };
  if (p.type === "skill") {
    if (p.skills.length === 1) void openSkill(`${p.skills[0]} · ${p.repo}`, { repo: p.repo, skill: p.skills[0], path: "" });
    else void openSkillsRepo(p.repo, p.skills);
    return land("custom");
  }
  if (p.type === "local-server") return void tell(p.name, "This server runs as a program on your computer. Tool up! can only add servers that have a web address for now. Run the command in your terminal instead; the server will then show up here.");
  if (p.type === "server") {
    const id = p.name.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60);
    if (p.secrets) return void tell(p.name, "This command carries a private key or a sign-in header. Tool up! never copies those. Run the command in your terminal instead; the server will then show up here.");
    if (!id || !bareUrl(p.url) || !p.url.startsWith("https://")) return void tell(p.name, "Tool up! can only add servers with a secure (https) address.");
    const known = (raw.mcp as unknown as { id: string; url?: string }[]).find((x) => x.url && bareUrl(x.url)?.url === bareUrl(p.url)?.url);
    if (known) return void openInstall([known.id], new Set(into!), true);   // it is on Tool up!'s own list: install that one
    void openInstallServer({ source: "paste", kind: "mcp", id, name: p.name, by: "", description: "", popularity: "", page: "", install: { type: "mcp", id, url: p.url }, blocked: "" } as Found, id, bareUrl(p.url)!.url);
    return land("custom");
  }
  if (p.type === "market") return void tell(p.repo, "That line adds a list of plugins, not a plugin. Copy the “/plugin install …” line as well and paste both.");
  // a plugin: read the list it is in (the one named, or the one Tool up! knows) and install it from there
  const repos = p.repo ? [p.repo] : MARKETS.map((m) => m.repo);
  for (const repo of repos) {
    try {
      const m = parseMarket(repo, JSON.parse(await fetchJson(marketUrl(repo))));
      const found = (p.repo || !p.market || m.name === p.market) && m.plugins.find((x) => x.name === p.plugin);
      if (found) { void openInstallPlugin(found); return land("plugin"); }
    } catch (e) { if (p.repo) return void tell(p.plugin, said(e)); }
  }
  void tell(p.plugin, p.repo ? `${p.repo} does not list a plugin called ${p.plugin}.` : `Tool up! does not know the plugin list “${p.market || "?"}”. Copy the “/plugin marketplace add …” line as well and paste both.`);
}

/**
 * The switches on a row act at once, with no dialog: the switch pulses while the change is made, and a dialog
 * appears only when it did not work. Changes run one after another, each on a fresh look at the machine.
 */
const flipping = new Set<string>();
let flips: Promise<void> = Promise.resolve();
function flip(key: string, agent: string, work: (item: Item) => Promise<void>) {
  const id = `${key}|${agent}`, name = inv?.items.find((i) => i.key === key)?.name || "";
  if (flipping.has(id)) return;
  flipping.add(id); paint();
  flips = flips.then(async () => {
    let err: unknown = null;
    try {
      const item = inv?.items.find((i) => i.key === key);
      // on sample data there is no machine to change: the sample itself is switched, so the switch behaves as it does in the app
      if (item && demo && cols().some((h) => h.id === agent)) {
        await new Promise((r) => setTimeout(r, 450));
        const places = Object.values(item.in);
        if (!item.in[agent]) item.in[agent] = { ...(places[0] ?? { name: item.name, source: "", linkTo: null }), linked: true };
        else if (places.length > 1) delete item.in[agent];
      } else if (item) { await work(item); await load(true); }
    } catch (e) { err = e; }
    flipping.delete(id); paint();
    if (err) { const e = err; await openSheet({ title: "", sub: name, prepare: async () => { throw e; }, run: async () => false }); }
  });
}

/** Turn a skill that is already on this computer on for one more agent: a link in that agent's folder to the copy there is. */
async function enableSkill(item: Item, agent: string) {
  if (item.in[agent]) return;
  const target = copyOf(item), dir = ownDir(agent);
  if (!target || !dir) throw new Error(`Tool up! does not know where ${chipOf(agent)} keeps its skills.`);
  await linkSkill(target, [dir]);
}

/** Add a catalog server to one more agent, through the Tool up! installer. */
async function fillServer(id: string, agent: string) {
  if (haveIt(id).includes(agent)) return;
  const r = await toolup([id], cols().length === 1 ? [] : [agent], false);
  if (demo) return;
  await load(true);
  if (r.code !== 0 || !haveIt(id).includes(agent))
    throw new Error(`${r.code === 0 ? `The installer finished, but ${listed.get(id)?.name || id} does not show up in ${chipOf(agent)}.` : `It was not added to ${chipOf(agent)}.`}${r.output.trim() ? `\n\n${r.output.trim()}` : ""}`);
}

/**
 * The page for something installed, shown over the list: what it is, which agents have it (with the same
 * switches as the list), what it tells your agents, and everything the row's menu can do.
 */
let detail: { key: string; doc: string | null; tab: string } | null = null;
let shotOpen = "";   // a picture shown large
const clean = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
let instFilter = "all";   // the Installed list: everything, or one kind
let liveHost: import("../core/types.ts").Host | null = null;
function openDetail(key: string) {
  const item = inv!.items.find((i) => i.key === key);
  if (!item) return;
  const d = { key, doc: null as string | null, tab: "about" };
  detail = d; paint();
  const dir = item.kind === "skill" ? copyOf(item) : "";
  const read = !dir ? Promise.resolve("") : liveHost ? liveHost.readText(`${dir}/SKILL.md`) : Promise.resolve("(Sample data) The skill's own instructions appear here in the app.");
  read.then((text) => { d.doc = (text || "").replace(/^---[\s\S]*?\n---\s*/, "").trim(); }, () => { d.doc = ""; }).then(() => { if (detail === d) paint(); });
}
function detailHtml() {
  const item = detail && inv?.items.find((i) => i.key === detail!.key);
  if (!detail || !item) { detail = null; return ""; }
  const cs = cols(), skill = item.kind === "skill", known = item.catalogId ? listed.get(item.catalogId) : undefined;
  const on = cs.filter((h) => item.in[h.id]), off = cs.length - on.length, o = item.origin;
  const about = (skill ? (item.catalogId && more[item.catalogId]?.about) || known?.ds || item.description : known?.ds) || (skill ? "" : "A server you added yourself.");
  let host = "";
  try { host = item.target && item.transport !== "stdio" ? new URL(item.target).host : ""; } catch { /* a command, not an address */ }
  const facts: [string, string][] = skill
    ? [["Kind", "Skill"], ["Source", o ? o.repo : "Added by you"], ["Version", o && o.path !== null && o.sha ? "Tracked" : "Not tracked"], ["Kept as", item.store ? "One shared copy" : on.some((h) => !item.in[h.id].linked) ? "Its own folder" : "A link"]]
    : [["Kind", "MCP server"], ["Runs", item.transport === "stdio" ? "On your computer" : "Online"], ...(host ? [["Connects to", host] as [string, string]] : []), ["Private keys", item.hasSecrets ? "Yes, kept here" : "None"]];
  const where = [
    ...(item.store ? [`Saved copy: ${tilde(item.store)}`] : []),
    ...on.map((h) => { const p = item.in[h.id]; return `${chipOf(h.id)}${p.name !== item.name && !skill ? ` (as “${p.name}”)` : ""}: ${tilde(p.source)}${p.linked ? ` → ${tilde(p.linkTo || "")}` : ""}`; }),
    ...(item.target && !skill ? [item.transport === "stdio" ? `Runs: ${item.target}` : `Address: ${item.target}`] : []),
  ];
  const k = esc(item.key);
  // the toolbar: the same actions as the row's menu; on a narrow window only the icons show
  const tool = (attr: string, icon: string, label: string, cls = "") => `<button class="tool ${cls}" type="button" ${attr} title="${esc(label)}" aria-label="${esc(label)}">${glyph(icon)}<span>${esc(label)}</span></button>`;
  const tools = [
    placeOf(item) ? tool(`data-reveal="${k}"`, "folder", "Show in Finder") : "",
    o ? tool(`data-url="${esc(repoUrl(o.repo, o.path || ""))}"`, "github", "GitHub") : "",
    o ? tool(`data-version="${k}"`, "refresh", "Check version") : "",
    skill && off > 1 ? tool(`data-enable-all="${k}"`, "plus", "On for all") : "",
  ].join("");
  const cat = known ? catalogParts(known) : null;   // listed in the catalog: its full details are shown here too
  const tabs: [string, string][] = skill ? [["about", "Overview"], ["doc", "Instructions"], ["where", "Location"]] : [["about", "Overview"], ["where", "Location"]];
  const want = detail.tab, tab = tabs.some(([t]) => t === want) ? want : "about";
  const pane = tab === "doc"
    ? (detail.doc === null ? `<p class="none">Reading it…</p>` : detail.doc ? `<div class="doc md">${mdDoc(detail.doc)}</div>` : `<p class="none">Its instructions could not be read.</p>`)
    : tab === "where" ? `<div class="doc where">${esc(where.join("\n"))}</div>`
    : `${cat ? `<dl class="facts">${cat.facts.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join("")}</dl>${cat.shots}
        <section class="shelf"><h2>About</h2><p class="about">${mdLine(known!.ds || about || "", true)}</p>${cat.d?.about && clean(cat.d.about) !== clean(known!.ds || "") ? `<p class="about">${mdLine(cat.d.about, true)}</p>` : ""}</section>${cat.start}<h2 class="detail-here">On this computer</h2>`
        : about ? `<p class="about">${mdLine(about, true)}</p>` : ""}
      ${skill ? "" : `<p class="how-c">${host ? `Your agents talk to <b>${esc(host)}</b>.` : "It runs as a program on this computer."} ${item.hasSecrets ? "It uses private keys or passwords. They stay on this computer and are never shown here." : ""}</p>`}
      <dl class="facts2">${facts.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join("")}</dl>`;
  return `<div class="scrim dscrim"><div class="detail" role="dialog" aria-modal="true" aria-labelledby="detail-t">
    <div class="detail-h k-${item.kind}">${itemLogo(item, "mid")}<div class="detail-ht"><h1 id="detail-t">${esc(item.name)}</h1><p>${esc(skill ? (o ? o.repo : "Added by you") : known?.by || (item.catalogId ? "" : "Added by you"))}</p></div>
      <span class="on-for"><small>On for</small><span class="swts" role="group" aria-label="Agents for ${esc(item.name)}">${cs.map((h) => agentSwitch(item, h)).join("")}</span></span>
      <button class="detail-x" type="button" data-detail-close aria-label="Close">${glyph("x")}</button></div>
    <div class="dtabs" role="tablist">${tabs.map(([t, label]) => `<button type="button" role="tab" data-dtab="${t}" aria-selected="${t === tab}">${label}</button>`).join("")}</div>
    <div class="detail-body" role="tabpanel">${pane}</div>
    <div class="detail-b">${tools}<span class="grow"></span>${skill ? tool(`data-delskill="${k}"`, "trash", "Delete…", "bad") : ""}</div>
  </div></div>`;
}

/** Check a skill for a newer version on GitHub, and update it. */
function openVersion(key: string) {
  const item = inv!.items.find((i) => i.key === key);
  if (!item) return;
  const known = item.catalogId ? listed.get(item.catalogId) : undefined;
  return openSheet({
    title: item.name, sub: "Is there a newer version?",
    prepare: async (s) => {
      s.idle = true;
      s.title = item.name;
      s.steps = [{ logo: itemLogo(item), title: item.name, detail: (item.kind === "skill" ? known?.ds || item.description : known?.ds) || "", state: "info" }];
      s.note = item.hasSecrets ? "This one uses private keys or passwords. They stay on this computer and are never shown here." : "";
      const o = item.origin;
      if (!o) return;
      s.link = { label: "View on GitHub", url: repoUrl(o.repo, o.path || "") };
      s.steps.push({ logo: tile("link"), title: "From GitHub", detail: `${o.repo}${o.path ? ` · ${o.path}` : ""}`, state: "info" });
      if (o.path === null || !o.sha) {
        s.steps.push({ logo: tile("refresh"), title: "Version not tracked", detail: "It was not installed by Tool up!, so which version you have is unknown. Updating fetches the latest.", state: "info" });
        s.idle = false; s.confirm = "Update to latest";
        return;
      }
      try {
        const latest = parseLatestCommit(JSON.parse(await fetchJson(latestCommitUrl(o.repo, o.path))));
        if (latest.sha === o.sha) s.steps.push({ logo: tile("check"), title: "Up to date", detail: "You have the latest version.", state: "done" });
        else {
          const when = latest.date ? new Date(latest.date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
          s.steps.push({ logo: tile("refresh"), title: "A newer version is available", detail: when ? `Changed on ${when}` : "", state: "todo" });
          s.idle = false; s.confirm = "Update";
        }
      } catch (e) {
        s.steps.push({ logo: tile("warn"), title: "Could not check for a newer version", detail: said(e), state: "info" });
      }
    },
    run: async (s) => {
      await updateSkill(item);
      s.steps = [{ logo: itemLogo(item), title: item.name, detail: "Updated to the latest version", state: "done" }];
      s.note = "Your agents pick it up the next time they start.";
      await load(true);
      return true;
    },
  });
}

/** Turn a skill on for every agent that does not have it yet. */
function openEnableSkillAll(key: string) {
  const item = inv!.items.find((i) => i.key === key);
  if (!item) return;
  const target = item.store || Object.values(item.in).find((p) => !p.linked)?.source || Object.values(item.in)[0]?.linkTo || "";
  const todo = cols().filter((h) => !item.in[h.id] && ownDir(h.id)).map((h) => ({ chip: chipOf(h.id), dir: ownDir(h.id)! }));
  const who = todo.map((a) => a.chip).join(", ");
  return openSheet({
    title: `Turn ${item.name} on for every agent?`, sub: "", confirm: "Turn on",
    prepare: async (s) => {
      if (!target || !todo.length) throw new Error("There is no agent left to turn it on for.");
      s.steps = [{ logo: itemLogo(item), title: item.name, detail: `Turn on for ${who}`, state: "todo" }];
      s.note = "They will use the same copy your other agents use.";
      s.tech = todo.map((a) => `${a.chip}: ${tilde(a.dir)}/${target.split("/").pop()} → ${tilde(target)} (a link)`);
    },
    run: async (s) => {
      await linkSkill(target, todo.map((a) => a.dir));
      s.steps = [{ logo: itemLogo(item), title: item.name, detail: `On for ${who}`, state: "done" }];
      s.note = "They pick it up the next time they start.";
      await load(true);
      return true;
    },
  });
}

/** Remove a skill from one agent, or (from: null) delete it from this computer. */
function openRemoveSkill(key: string, from: string | null) {
  const item = inv!.items.find((i) => i.key === key);
  if (!item) return;
  const places = Object.entries(item.in).map(([h, p]) => ({ h, ...p }));
  // a copy that goes takes the links pointing at it with it; a link on its own leaves the stored copy alone
  const paths = new Set(from ? [item.in[from].source] : [...places.map((p) => p.source), ...(item.store ? [item.store] : [])]);
  for (const p of places) if (p.linked && p.linkTo && paths.has(p.linkTo)) paths.add(p.source);
  const at = (path: string) => places.filter((p) => p.source === path);
  const steps: Step[] = [...paths].map((path) => {
    const here = at(path), link = !!here[0]?.linked, users = here.map((p) => chipOf(p.h)).join(", ");
    return link
      ? { logo: tile("link"), title: `Turn off for ${users}`, detail: paths.has(here[0].linkTo || "") ? "" : "You can turn it back on later", state: "todo" }
      : { logo: tile("trash"), title: users ? `Remove from ${users}` : "Delete the saved copy", detail: "Goes to the Trash", state: "todo" };
  });
  const also = from ? [...new Set([...paths].flatMap((p) => at(p).map((x) => x.h)))].filter((h) => h !== from).map(chipOf) : [];
  const deletes = steps.some((s) => s.logo === tile("trash"));
  return openSheet({
    title: from ? `Turn ${item.name} off for ${chipOf(from)}?` : `Delete ${item.name} from this computer?`,
    sub: from || !places.length ? "" : `It is removed from ${places.map((p) => chipOf(p.h)).join(", ")}.`,
    confirm: from && !deletes ? "Turn off" : "Delete", danger: true, closeWhenDone: true,
    prepare: async (s) => {
      s.steps = steps;
      s.tech = [...paths].map((path) => `${at(path)[0]?.linked ? "Remove the link" : "Delete the folder"} ${tilde(path)}`);
      s.note = [also.length ? `${chipOf(from!)} shares this copy with ${also.join(", ")}, so it goes for them too.` : "", deletes ? "If the Trash can't be used, it is deleted for good." : ""].filter(Boolean).join(" ");
    },
    run: async (s) => {
      const done = await removeSkill([...paths]);
      s.steps = s.steps.map((st) => ({ ...st, state: "done" }));
      s.note = done.some((d) => d.how === "trashed") ? "You can find it in the Trash." : done.some((d) => d.how === "deleted") ? "It was deleted for good." : "";
      await load(true);
      return true;
    },
  });
}

/**
 * Turn a skill off for one agent. Nothing is deleted: a link is simply removed, and an agent's own folder
 * is moved to Tool up!'s saved copies, with the other agents that were using it pointed at it there.
 */
async function turnOff(item: Item, from: string) {
  const place = item.in[from], store = expand(SKILL_STORE, home);
  if (!place) return;
  if (place.linked) return void (await removeSkill([place.source]));
  // agents that have it through the very same folder (a shared one), or through a link to it: they stay on
  const sharing = Object.entries(item.in).filter(([h, p]) => h !== from && (p.source === place.source || p.linkTo === place.source));
  const relink = [...new Set(sharing.map(([h, p]) => (p.linked ? p.source.slice(0, p.source.lastIndexOf("/")) : ownDir(h))).filter((d): d is string => !!d))];
  await parkSkill(place.source, store, relink);
}

/** The folder (a skill) or settings file (a server) to show in Finder. */
const placeOf = (item: Item) => item.store || Object.values(item.in).find((p) => !p.linked)?.source || Object.values(item.in)[0]?.linkTo || Object.values(item.in)[0]?.source || "";

/** The row menu behind the three dots. */
/** A menu's items in groups, with a line between one group and the next; a group that needs saying what it is has a small label. Empty groups are left out. */
const menuGroups = (groups: [string, string[]][]) => groups.map(([label, items]) => [label, items.filter(Boolean)] as [string, string[]]).filter(([, items]) => items.length)
  .map(([label, items]) => `<div class="menu-g" role="group"${label ? ` aria-label="${esc(label)}"` : ""}>${label ? `<p class="menu-l">${esc(label)}</p>` : ""}${items.join("")}</div>`).join("");
function menuHtml() {
  const item = menu && inv?.items.find((i) => i.key === menu!.key);
  if (!menu || !item) return "";
  const off = cols().filter((h) => !item.in[h.id]), skill = item.kind === "skill", k = esc(item.key);
  const mi = (attr: string, icon: string, label: string, title = "", cls = "") => `<button${cls ? ` class="${cls}"` : ""} type="button" role="menuitem" ${attr}${title ? ` title="${esc(title)}"` : ""}>${glyph(icon)}${label}</button>`;
  return `<div class="menu" role="menu" aria-label="More for ${esc(item.name)}" style="top:${menu.y}px;right:${menu.x}px">${menuGroups([
    ["", [
      mi(`data-about="${k}"`, "info", "Details"),
      placeOf(item) ? mi(`data-reveal="${k}"`, "folder", "Show in Finder") : "",
    ]],
    ["", [   // where it came from
      item.origin ? mi(`data-url="${esc(repoUrl(item.origin.repo, item.origin.path || ""))}"`, "github", "View on GitHub") : "",
      item.origin ? mi(`data-version="${k}"`, "refresh", "Check for a newer version") : "",
    ]],
    ["Agents", [
      skill && off.length > 1 ? mi(`data-enable-all="${k}"`, "plus", "Turn on for every agent") : "",
      adoptable(item) ? mi(`data-adopt="${k}"`, "all", "Keep one shared copy", "Moves it to Tool up!'s saved skills; every agent that has it keeps it, through a link") : "",
    ]],
    ["Make it yours", [
      skill && editableSkill(item) && copyOf(item) ? mi(`data-edit-skill="${k}"`, "info", "Edit its instructions…") : "",
      skill && copyOf(item) ? mi(`data-copy-skill="${k}"`, "plus", "Make an editable copy…", "A copy under another name that is yours to change") : "",
    ]],
    ["", [
      skill ? mi(`data-delskill="${k}"`, "trash", "Delete from this computer…", "", "bad") : "",
    ]],
  ])}</div>`;
}

/** Show or hide the row menu without redrawing the list under it. */
function paintMenu() {
  document.querySelector("#menu")!.innerHTML = menuHtml() + getMenuHtml();
  document.querySelectorAll<HTMLElement>("[data-get-menu]").forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.getMenu === getMenu?.id)));
  // a menu opens under its button; one that would run off the bottom of the window is moved up to fit
  document.querySelectorAll<HTMLElement>("#menu .menu").forEach((m) => { const r = m.getBoundingClientRect(); if (r.bottom > innerHeight - 8) m.style.top = `${Math.max(8, innerHeight - r.height - 8)}px`; });
  document.querySelectorAll<HTMLElement>("[data-menu]").forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.menu === menu?.key)));
}

/* ---------- frame ---------- */
function body() {
  if (failed) return `<p class="note bad">${glyph("warn")}<span>${esc(failed)}</span></p>`;
  if (!inv) return `<p class="boot">Looking at your agents…</p>`;
  const notes = [
    demo && !embed ? `<p class="note">${glyph("warn")}<span>Sample data. Open the desktop app to see your own machine.</span></p>` : "",
    ...inv.harnesses.flatMap((h) => h.problems.map((p) => `<p class="note bad">${glyph("warn")}<span><b>${esc(h.name)}</b> ${esc(p)}</span></p>`)),
  ].join("");
  if (!cols().length && screen === "installed") return `${notes}${emptyState("No agents found on this machine", `Tool up! looks for ${inv.harnesses.map((h) => h.name).join(", ")}. Install one, then scan again.`)}`;
  return notes + (screen === "installed" ? installed() : screen === "catalog" ? catalogView() : screen === "projects" ? projectsView() : settingsView());
}
function shell() {
  app.innerHTML = `<header data-tauri-drag-region>
    <div class="hist" role="group" aria-label="Back and forward"><button type="button" data-go="-1" title="Back (⌘[)" aria-label="Back" disabled>${glyph("back")}</button><button type="button" data-go="1" title="Forward (⌘])" aria-label="Forward" disabled>${glyph("next")}</button></div>
    <div class="views" role="group" aria-label="View"><button type="button" data-screen="installed">Installed</button><button type="button" data-screen="catalog">Catalog</button><button type="button" data-screen="projects">Projects</button></div>
    <label class="search">${glyph("search")}<input id="q" type="search" aria-label="Search" autocomplete="off"></label>
    <button class="btn icon" id="rescan" type="button" title="Look again for agents, skills and servers" aria-label="Scan again">${glyph("refresh")}</button>
    <button class="btn icon" type="button" data-screen="settings" title="Settings" aria-label="Settings">${glyph("gear")}</button></header>
    <main id="body"></main><div id="tray"></div><div id="detail"></div><div id="menu"></div><div id="sheet"></div>
    <div class="drop" id="drop" hidden><div><b>Drop to install this skill</b><span>You will see what it does before anything is installed</span></div></div>`;
}
/**
 * The starter packs' strip: arrows at its sides, a dot for each place it can stop (the current one is longer),
 * and a fade over the packs that run off an edge. Redrawing the page keeps the strip where it was.
 */
let featX = 0;
function wireCarousel() {
  const car = document.querySelector<HTMLElement>(".carousel"), track = car?.querySelector<HTMLElement>(".feats"), dots = car?.querySelector<HTMLElement>(".car-dots");
  if (!car || !track || !dots) return;
  const cards = [...track.querySelectorAll<HTMLElement>(".feat")];
  const step = () => (cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : track.clientWidth) || 1;
  const stops = () => Math.max(1, cards.length - Math.max(1, Math.floor(track.clientWidth / step())) + 1);
  const go = (i: number) => track.scrollTo({ left: i * step(), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  // the stop it is at; against the right-hand end that is the last one, however far short of a whole step that is
  const at = () => (track.scrollLeft >= track.scrollWidth - track.clientWidth - 2 ? stops() - 1 : Math.min(stops() - 1, Math.round(track.scrollLeft / step())));
  const sync = () => {
    featX = track.scrollLeft;
    const max = track.scrollWidth - track.clientWidth, n = stops(), cur = at();
    car.classList.toggle("at-start", track.scrollLeft <= 2);
    car.classList.toggle("at-end", track.scrollLeft >= max - 2);
    if (dots.children.length !== n) dots.innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<button type="button" data-car-dot="${i}" aria-label="Go to ${esc(raw.packs[i]?.name || `pack ${i + 1}`)}"></button>`).join("") : "";
    [...dots.children].forEach((d, i) => (i === cur ? d.setAttribute("aria-current", "true") : d.removeAttribute("aria-current")));
  };
  if (!car.dataset.wired) {
    car.dataset.wired = "1";
    track.scrollLeft = featX;
    track.addEventListener("scroll", sync, { passive: true });
    car.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-car], [data-car-dot]");
      if (!b) return;
      e.stopPropagation();
      go(b.dataset.carDot !== undefined ? +b.dataset.carDot : at() + +b.dataset.car!);
    });
  }
  sync();
}
/** A shelf of folders that keeps to one row: whatever wraps onto a second row is hidden (and "See all" shows the rest). */
function oneRow() {
  for (const box of document.querySelectorAll<HTMLElement>(".folders.one")) {
    const kids = [...box.children] as HTMLElement[];
    for (const k of kids) k.hidden = false;
    const top = kids[0]?.offsetTop ?? 0;
    for (const k of kids) k.hidden = k.offsetTop > top;
    const all = box.closest(".shelf")?.querySelector<HTMLElement>(".see-all");
    if (all) all.hidden = !kids.some((k) => k.hidden);
  }
}
window.addEventListener("resize", wireCarousel);
window.addEventListener("resize", oneRow);
/* ---------- back and forward: the places you have been (a screen, and in the Catalog the list, pack, collection or page) ---------- */
interface Place { screen: Screen; shop: typeof shop; q: string; top: number }
const places: Place[] = [];
let placeAt = -1;
const placeKey = (p: Place) => JSON.stringify([p.screen, p.shop.tab, p.shop.cat, p.shop.detail, p.shop.pack, p.shop.plugin, p.shop.list, p.shop.coll, p.q.trim()]);
/** After each draw: if what is on screen is a new place, it goes on the end of the trail (and what was ahead of it is dropped). */
function notePlace() {
  if (!inv) return;
  const now: Place = { screen, shop: { ...shop }, q, top: 0 }, cur = places[placeAt];
  if (cur && placeKey(cur) === placeKey(now)) cur.shop.page = shop.page;
  else if (cur && cur.q.trim() && now.q.trim() && placeKey({ ...cur, q: "" }) === placeKey({ ...now, q: "" })) places[placeAt] = now;   // typing in the search box is one place, not one for each letter
  else { places.splice(placeAt + 1); places.push(now); if (places.length > 80) places.shift(); placeAt = places.length - 1; }
  document.querySelector<HTMLButtonElement>('[data-go="-1"]')!.disabled = placeAt <= 0;
  document.querySelector<HTMLButtonElement>('[data-go="1"]')!.disabled = placeAt >= places.length - 1;
}
/** Go one place back (-1) or forward (1), to where the page was scrolled when you left it. */
function goPlace(dir: number) {
  const to = places[placeAt + dir];
  if (!to || sheet) return;
  placeAt += dir;
  screen = to.screen; Object.assign(shop, to.shop); q = to.q;
  document.querySelector<HTMLInputElement>("#q")!.value = q;
  menu = null; getMenu = null; catsOpen = false; srcOpen = false;
  queueSearch(); paint();
  document.querySelector("#body")!.scrollTop = to.top;
}
function paint() {
  document.querySelectorAll<HTMLElement>(".views [data-screen]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.screen === screen)));
  document.querySelector<HTMLInputElement>("#q")!.placeholder = screen === "installed" ? "Search what's installed…" : screen === "projects" ? "Search your projects…" : "Search skills and MCP servers…";
  document.querySelector("#body")!.innerHTML = body();
  document.querySelector("#tray")!.innerHTML = tray();
  paintOverlay();
  document.querySelector("#detail")!.innerHTML = detailHtml() + (shotOpen ? `<div class="lightbox" role="dialog" aria-modal="true" aria-label="Picture"><button class="lightbox-x" type="button" aria-label="Close picture" title="Close (Esc)">${glyph("x")}</button><img src="${esc(shotOpen)}" alt=""></div>` : "");
  paintMenu();
  wireCarousel();
  oneRow();
  mountMeadow({ hold: arranging ? chosen : "", on: !meadowStill });
  notePlace();
  app.classList.toggle("has-tray", !!document.querySelector(".tray"));
}
async function load(quiet = false) {
  failed = "";
  if (!quiet) { inv = null; paint(); }
  try {
    if (demo) inv = sample;
    else { const host = await tauriHost(); liveHost = host; home = host.home; inv = await scan(host, catalog); }
  }
  catch (e) { failed = `The scan failed: ${e instanceof Error ? e.message : String(e)}`; }
  // install into every agent found unless the user has narrowed it; forget agents that are gone
  const here = new Set(cols().map((h) => h.id));
  into = into ? new Set([...into].filter((id) => here.has(id))) : here;
  if (!into.size) into = here;
  paint();
  void checkUpdates();
}

/* ---------- a small question: one line of text, then go ---------- */
interface Ask {
  title: string; sub: string; label: string; value: string; placeholder: string; confirm: string; error: string; busy: boolean;
  /** Act on the answer. Returns what is wrong with it, or nothing when it was taken. */
  go: (value: string) => string | void | Promise<string | void>;
}
let ask: Ask | null = null;
function openAsk(spec: Pick<Ask, "title" | "sub" | "label" | "confirm" | "go"> & Partial<Ask>) {
  ask = { value: "", placeholder: "", error: "", busy: false, ...spec };
  addOpen = false;
  paint();
  const el = document.querySelector<HTMLInputElement>("#ask-in");
  el?.focus(); el?.select();
}
function askHtml() {
  const a = ask;
  if (!a || sheet) return "";
  return `<div class="scrim"><form class="sheet" data-ask role="dialog" aria-modal="true" aria-labelledby="ask-t">
    <h2 id="ask-t">${esc(a.title)}</h2>${a.sub ? `<p class="sheet-sub">${esc(a.sub)}</p>` : ""}
    <label class="ask-l"><span>${esc(a.label)}</span><input id="ask-in" type="text" value="${esc(a.value)}" placeholder="${esc(a.placeholder)}" autocomplete="off" autocapitalize="off" spellcheck="false" ${a.busy ? "disabled" : ""}></label>
    ${a.error ? `<p class="sheet-note bad">${esc(a.error)}</p>` : ""}
    <div class="sheet-b"><span class="grow"></span>${a.busy ? `<span class="spin" aria-hidden="true"></span>` : `<button class="btn" type="button" data-ask-close>Cancel</button><button class="btn pri" type="submit">${esc(a.confirm)}</button>`}</div></form></div>`;
}
async function submitAsk() {
  const a = ask;
  if (!a || a.busy) return;
  a.value = (document.querySelector<HTMLInputElement>("#ask-in")?.value || "").trim();
  if (!a.value) return;
  a.busy = true; a.error = ""; paint();
  let err: string | void;
  try { err = await a.go(a.value); } catch (e) { err = said(e); }
  a.busy = false;
  if (err) a.error = err; else if (ask === a) ask = null;
  paint();
  if (err) document.querySelector<HTMLInputElement>("#ask-in")?.focus();
}

/* ---------- Add…: the ways to add something ---------- */
let addOpen = false, initOpen = false;   // the Add menu, and a project's "Run /init" menu of agents
const addMenu = () => `<div class="catdd addmenu"><button class="btn pri" type="button" data-add-menu aria-haspopup="menu" aria-expanded="${addOpen}">${glyph("plus")}Add…</button>
  ${addOpen ? `<div class="catdd-list filt-cats" role="menu" aria-label="Add">
    <button type="button" role="menuitem" data-screen="catalog"><span>Browse the catalog</span></button>
    <button type="button" role="menuitem" data-add-github><span>From GitHub…</span></button>
    <p class="add-note">Or paste any install command (⌘V), or drop a .skill file on this window.</p></div>` : ""}</div>`;
const askGithub = () => openAsk({
  title: "Add skills from GitHub", sub: "Give a repository and choose which of its skills to install.", label: "Repository", placeholder: "https://github.com/owner/repo", confirm: "Find skills",
  go: (v) => { const p = githubSkills(v, true); if (!p) return "That does not look like a GitHub repository. Use its address, or owner/repo."; void openPasted(p); },
});

/* ---------- newer versions: a badge on what can be updated, and one button for all of them ---------- */
const UPD_KEY = "toolup.updates";
let upd: Record<string, { sha: string; latest: string; at: number }> = {};
try { upd = JSON.parse(saved(UPD_KEY) || "{}"); } catch { /* start over */ }
/** A skill Tool up! knows the source and the version of, so a newer one can be noticed. */
const tracked = (i: Item) => i.kind === "skill" && !!i.origin && i.origin.path !== null && !!i.origin.sha;
const hasUpdate = (i: Item) => { const u = upd[i.key]; return tracked(i) && !!u && u.sha === i.origin!.sha && !!u.latest && u.latest !== u.sha; };
const updatable = () => (inv ? inv.items.filter(hasUpdate) : []);
let checking = false;
/** Ask GitHub for the latest version of each tracked skill: at most 25 questions a run, each answer kept for 12 hours. */
async function checkUpdates(force = false) {
  if (demo || checking || !inv) return;
  checking = true;
  const now = Date.now();
  let asked = 0;
  for (const i of inv.items.filter(tracked)) {
    const u = upd[i.key];
    if (!force && u && u.sha === i.origin!.sha && now - u.at < 12 * 3600e3) continue;
    if (asked++ >= 25) break;
    const latest = await latestSha(i.origin!.repo, i.origin!.path!);
    if (!latest) break;   // GitHub cannot be asked right now; what is known stays as it is
    upd[i.key] = { sha: i.origin!.sha, latest, at: now };
  }
  save(UPD_KEY, JSON.stringify(upd));
  checking = false;
  paint();
}
/** Fetch a skill's latest version and put it where the installed copy is. */
async function updateSkill(item: Item) {
  const o = item.origin!, folder = item.key.slice("skill:".length), parent = (p: string) => p.slice(0, p.lastIndexOf("/"));
  const dirs = item.store ? [parent(item.store)] : [...new Set(Object.values(item.in).filter((p) => !p.linked).map((p) => parent(p.source)))];
  if (!dirs.length) throw new Error("Tool up! could not find the copy to update.");
  const got = await fetchSkill(o.repo, folder, o.path || "");
  await installSkill(got.staged, dirs, [], await metaFor(o.repo, got.path));
  delete upd[item.key];
  save(UPD_KEY, JSON.stringify(upd));
}

/* ---------- your own presets: a set of catalog items saved under a name ---------- */
interface Preset { name: string; ids: string[] }
let presets: Preset[] = [];
try { presets = JSON.parse(saved("toolup.presets") || "[]"); } catch { /* none */ }
const savePresets = () => save("toolup.presets", JSON.stringify(presets));
/**
 * Save catalog items as a preset. A name you already use adds them to that preset; a new name starts one.
 * `then` runs once it is saved (the install sheet it was asked from comes back).
 */
const askPreset = (ids: string[], then?: () => void) => openAsk({
  title: ids.length > 1 ? "Save these as a collection" : `Add ${listed.get(ids[0])?.name || "this"} to a collection`,
  sub: `A collection of your own: a set of skills and servers you can install together, into the agents you choose.${presets.length ? ` Yours: ${presets.map((p) => p.name).join(", ")}. Use one of those names to add to it.` : ""}`,
  label: "Name", placeholder: "My frontend set", confirm: "Save collection",
  go: (name) => {
    const old = presets.find((p) => p.name === name);
    presets = [...presets.filter((p) => p !== old), { name, ids: [...new Set([...(old?.ids || []), ...ids])] }].sort((x, y) => x.name.localeCompare(y.name));
    savePresets();
    then?.();
  },
});
function presetShelf() {
  if (!presets.length) return "";
  return `<section class="shelf"><div class="shelf-h"><h2>Your collections</h2></div><p>Sets you put together yourself. Install one to get everything in it.</p><div class="folders">${presets.map((p, n) => {
    const items = p.ids.map((id) => listed.get(id)).filter((x): x is Listed => !!x);
    return folderCard({
      open: `data-preset="${n}"`, label: `Install your collection ${p.name}`, title: p.name, sub: plural(items.length, "item"), items: items.map(paperOf), total: items.length,
      pill: { attr: `data-preset="${n}"`, label: "Install…" },
      corner: `<button class="fold-x" type="button" data-preset-del="${n}" title="Delete this collection" aria-label="Delete your collection ${esc(p.name)}">${glyph("x")}</button>`,
    });
  }).join("")}</div></section>`;
}

/* ---------- which agent: the Installed list for one agent only ---------- */
let instAgent = "", agentsOpen = false;
/** "Used by": a menu of the agents here, each with how many things it has; the one chosen names the button and can be cleared. */
function agentNav(count: (id: string) => number) {
  const cs = cols();
  if (cs.length < 2) return "";
  const cur = cs.find((h) => h.id === instAgent), a = cur && agents.get(cur.id);
  return `<div class="catdd"><span class="chip-pair"><button class="chip" type="button" data-agents-menu aria-haspopup="menu" aria-expanded="${agentsOpen}" aria-pressed="${!!cur}">${cur && a ? mono(cur.id, a.icon) : glyph("all")}<span>${cur ? esc(a?.chip || cur.name) : "Used by"}</span>${glyph("chev")}</button>${cur ? `<button class="chip-x" type="button" data-inst-agent="" title="Show every agent" aria-label="Show every agent">${glyph("x")}</button>` : ""}</span>
    ${agentsOpen ? `<div class="catdd-list filt-cats" role="menu" aria-label="Used by"><button type="button" role="menuitem" data-inst-agent="" aria-current="${!cur}"><span>Any agent</span></button>${cs.map((h) => { const x = agents.get(h.id); return `<button type="button" role="menuitem" data-inst-agent="${h.id}" aria-current="${instAgent === h.id}"><span class="with-mark">${x ? mono(h.id, x.icon) : ""}${esc(h.name)}</span><small>${count(h.id)}</small></button>`; }).join("")}</div>` : ""}</div>`;
}

/* ---------- one shared copy: take a skill that lives in an agent's own folder into Tool up!'s store ---------- */
/** Installed by Tool up! (it left its note), or kept in its store. Anything else is yours, and is never overwritten. */
const managed = (i: Item) => !!i.store || (!!i.origin && i.origin.path !== null);
const adoptable = (i: Item) => i.kind === "skill" && !i.store && Object.values(i.in).some((p) => !p.linked);
async function adoptSkill(item: Item) {
  const src = Object.values(item.in).find((p) => !p.linked)!.source, store = expand(SKILL_STORE, home);
  // every agent that has it through that folder, or through a link to it, keeps it: each gets a link to the stored copy
  const dirs = [...new Set(Object.values(item.in).filter((p) => p.source === src || p.linkTo === src).map((p) => p.source.slice(0, p.source.lastIndexOf("/"))))];
  await parkSkill(src, store, dirs);
}

/* ---------- servers: take one out of an agent, or give one you added yourself to another agent ---------- */
/** A server you added that Tool up! can add elsewhere: it has a secure address and carries no keys. */
const copyable = (i: Item) => i.kind === "mcp" && !i.catalogId && i.transport !== "stdio" && !i.hasSecrets && !!i.target && i.target.startsWith("https://");
const plainName = (n: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(n);
async function copyServer(item: Item, agent: string) {
  const id = item.name.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60);
  if (!id) throw new Error("That server's name cannot be used for another agent.");
  const r = await toolupServers([{ id, name: item.name.replace(/["'\\$`<>]/g, ""), url: item.target! }], [agent], false);
  if (demo) return;
  await load(true);
  if (r.code !== 0 || !inv!.items.find((i) => i.key === item.key)?.in[agent]) throw new Error(`It was not added to ${chipOf(agent)}.${r.output.trim() ? `\n\n${r.output.trim()}` : ""}`);
}
async function removeServer(item: Item, agent: string) {
  const r = await toolupRemove([item.in[agent].name], [agent]);
  if (demo) return;
  await load(true);
  if (r.code !== 0 || inv!.items.find((i) => i.key === item.key)?.in[agent]) throw new Error(`It is still in ${chipOf(agent)}.${r.output.trim() ? `\n\n${r.output.trim()}` : ""}`);
}
/** Removing a server: at once when Tool up! can put it back; after a question when it cannot (a program, or one with keys). */
function unServer(key: string, agent: string) {
  const item = inv!.items.find((i) => i.key === key);
  if (!item || !item.in[agent]) return;
  if (item.catalogId || copyable(item)) return flip(key, agent, (it) => removeServer(it, agent));
  return void openSheet({
    title: `Remove ${item.name} from ${chipOf(agent)}?`, sub: "", confirm: "Remove", danger: true, closeWhenDone: true,
    prepare: async (s) => {
      s.steps = [{ logo: itemLogo(item), title: item.name, detail: `Removed from ${chipOf(agent)}`, state: "todo" }];
      s.note = `You added this one yourself${item.hasSecrets ? ", and it carries keys or passwords" : ""}. Its settings in ${chipOf(agent)} are deleted, and Tool up! cannot put them back.`;
      s.tech = [`${item.transport === "stdio" ? "Runs" : "Address"}: ${item.target || ""}`, `In: ${tilde(item.in[agent].source)}`];
    },
    run: async () => { await removeServer(item, agent); return true; },
  });
}

/* ---------- the few text files the app edits: read, and saved through the shell ---------- */
// in a plain browser there is no machine: a small made-up project stands in, kept in memory
const demoFiles = new Map<string, string>([
  ["~/code/shop/AGENTS.md", "# Shop\n\nUse pnpm. Run the tests before you say a task is done.\n"],
  ["~/code/shop/.mcp.json", '{"mcpServers":{"sentry":{"type":"http","url":"https://mcp.sentry.dev/mcp"}}}'],
  ["~/code/shop/.claude/skills/release-notes/SKILL.md", "---\nname: release-notes\ndescription: House style for our release notes.\n---\n"],
]);
const readFile = (path: string) => (liveHost ? liveHost.readText(path) : Promise.resolve(demoFiles.get(path) ?? null));
async function saveFile(path: string, text: string) { if (liveHost) await writeText(path, text); else demoFiles.set(path, text); }
async function listDir(path: string): Promise<{ name: string; dir: boolean }[]> {
  if (liveHost) return (await liveHost.list(path)) || [];
  const names = new Set([...demoFiles.keys()].filter((k) => k.startsWith(`${path}/`)).map((k) => k.slice(path.length + 1).split("/")[0]));
  return [...names].map((name) => ({ name, dir: true }));
}

/* ---------- an editor for one instructions file ---------- */
interface Editor { path: string; title: string; note: string; text: string; busy: boolean; error: string; done: () => void | Promise<void> }
let editor: Editor | null = null;
async function openEditor(path: string, title: string, note: string, starter = "", done: Editor["done"] = () => {}) {
  const text = (await readFile(path)) ?? starter;
  editor = { path, title, note, text, busy: false, error: "", done };
  menu = null;
  paint();
  document.querySelector<HTMLTextAreaElement>("#editor-ta")?.focus();
}
function editorHtml() {
  const e = editor;
  if (!e || sheet || ask) return "";
  return `<div class="scrim"><form class="sheet wide" data-editor role="dialog" aria-modal="true" aria-labelledby="ed-t">
    <h2 id="ed-t">${esc(e.title)}</h2><p class="sheet-sub">${esc(tilde(e.path))}</p>
    <textarea id="editor-ta" spellcheck="false" aria-label="${esc(e.title)}" ${e.busy ? "disabled" : ""}></textarea>
    ${e.note ? `<p class="sheet-note">${esc(e.note)}</p>` : ""}${e.error ? `<p class="sheet-note bad">${esc(e.error)}</p>` : ""}
    <div class="sheet-b"><span class="grow"></span>${e.busy ? `<span class="spin" aria-hidden="true"></span>` : `<button class="btn" type="button" data-editor-close>Cancel</button><button class="btn pri" type="submit">Save</button>`}</div></form></div>`;
}
async function saveEditor() {
  const e = editor;
  if (!e || e.busy) return;
  e.busy = true; e.error = ""; paint();
  try { await saveFile(e.path, e.text); if (editor === e) editor = null; await e.done(); }
  catch (x) { e.error = said(x); }
  e.busy = false;
  paint();
}
/** The sheet's place holds one thing at a time. What is typed is put back by hand, so a redraw never loses it. */
let overlayHtml = "";
function paintOverlay() {
  const html = sheetHtml() || askHtml() || editorHtml();
  if (html === overlayHtml) return;
  overlayHtml = html;
  document.querySelector("#sheet")!.innerHTML = html;
  const ta = document.querySelector<HTMLTextAreaElement>("#editor-ta"), inp = document.querySelector<HTMLInputElement>("#ask-in");
  if (ta && editor) ta.value = editor.text;
  if (inp && ask) inp.value = ask.value;
}

/* ---------- a skill of your own: edit its instructions, or copy one you got elsewhere to make it yours ---------- */
/** Yours to edit: not from the catalog and not tracked to a source, so no update will write over your changes. */
const editableSkill = (i: Item) => i.kind === "skill" && !i.catalogId && !tracked(i);
/** A skill's instructions under a new name: the `name:` in its front matter, replaced or added. */
function renameSkill(md: string, name: string) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!fm) return `---\nname: ${name}\n---\n\n${md}`;
  const inner = /^name:.*$/m.test(fm[1]) ? fm[1].replace(/^name:.*$/m, `name: ${name}`) : `name: ${name}\n${fm[1]}`;
  return `---\n${inner}\n---\n${md.slice(fm[0].length)}`;
}
const editSkill = (item: Item) => openEditor(`${copyOf(item)}/SKILL.md`, item.name, "Your agents pick up the change the next time they start.", "", () => load(true));
function askCopy(key: string) {
  const item = inv!.items.find((i) => i.key === key);
  if (!item || !copyOf(item)) return;
  openAsk({
    title: `Make an editable copy of ${item.name}`, sub: "The copy is yours: you can change its instructions, and no update writes over it. The original stays as it is.",
    label: "Name of the copy", value: `${key.slice("skill:".length)}-mine`, confirm: "Make the copy",
    go: async (name) => {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)) return "Use letters, digits and - _ . only.";
      if (inv!.items.some((i) => i.key === `skill:${name}`)) return `You already have a skill called ${name}.`;
      if (demo) return "Copies are made in the desktop app.";
      const dest = await copySkill(copyOf(item), expand(SKILL_STORE, home), name);
      await saveFile(`${dest}/SKILL.md`, renameSkill((await readFile(`${dest}/SKILL.md`)) || "", name));
      await load(true);
      void openEditor(`${dest}/SKILL.md`, name, "The copy is saved and is on for no agent yet. Turn it on from the Installed list.", "", () => load(true));
    },
  });
}

/* ---------- the safety check, as a step in the install sheet ---------- */
const findingLine = (f: Finding) => `[${f.severity}] ${f.file}:${f.line}  ${f.why}  ${f.text}`;
function safetyStep(findings: Finding[]): Step {
  if (!findings.length) return { logo: tile("check"), title: "Safety check", detail: "Nothing risky found in its files. This reads the files; it cannot see what a script does when it runs.", state: "done" };
  const top = findings.slice(0, 3).map((f) => `${f.why.replace(/\.$/, "")} (${f.file}, line ${f.line})`).join(" · ");
  return { logo: tile("warn"), title: `Safety check: ${plural(findings.length, "thing")} to look at`, detail: `${top}${findings.length > 3 ? " · more under Details" : ""}`, state: worst(findings) === "high" ? "fail" : "info" };
}

/* ---------- Projects: each one's instructions for agents, and the servers and skills it carries ---------- */
interface Project { path: string; added: boolean }
interface ProjectInfo {
  files: Record<string, boolean>;
  /** CLAUDE.md is there and does not pull AGENTS.md in, so Claude Code reads it alone. */
  claudeAlone: boolean;
  /** A server, with the agents whose project file names it; `url` is set when it can be given to another agent. */
  servers: { name: string; target: string; url: string | null; in: Record<string, boolean> }[];
  /** A skill, with the places in the project that hold it (see PROJECT_SKILLS). */
  skills: { name: string; in: Record<string, boolean> }[];
  /** Project files that are there but could not be read as JSON. */
  broken: string[];
}
// A project's own servers: one file per agent, each in that agent's shape. Only servers with a web address are written.
const PROJECT_MCP: { agent: string; file: string; key: string; entry: (url: string) => Record<string, unknown> }[] = [
  { agent: "claude-code", file: ".mcp.json", key: "mcpServers", entry: (url) => ({ type: "http", url }) },
  { agent: "cursor", file: ".cursor/mcp.json", key: "mcpServers", entry: (url) => ({ url }) },
  { agent: "vscode", file: ".vscode/mcp.json", key: "servers", entry: (url) => ({ type: "http", url }) },
];
// A project's own skills: Claude Code reads one folder, the agents that follow the shared convention another.
const PROJECT_SKILLS: { id: string; dir: string; label: string }[] = [
  { id: "claude-code", dir: ".claude/skills", label: "Claude Code" },
  { id: "agents", dir: ".agents/skills", label: "Codex, Cursor, Gemini CLI and the other agents" },
];
// AGENTS.md is the shared one: most agents read it, Claude Code included when the project has no CLAUDE.md.
// CLAUDE.md and GEMINI.md are only listed for a project that already has one. Gemini CLI still wants a file of
// its own by default, so it can be given a one-line pointer at AGENTS.md.
const CONTEXT: [string, string][] = [
  ["AGENTS.md", "The shared file. Read by Claude Code, Codex, Cursor, Copilot and VS Code, Amp, Devin, Windsurf and most other agents."],
  ["CLAUDE.md", "For Claude Code only. While this file is here, Claude Code reads it instead of AGENTS.md."],
  ["GEMINI.md", "Gemini CLI reads this one unless its settings name AGENTS.md."],
];
const POINTERS = ["GEMINI.md"];
let projects: Project[] | null = null, projectOpen = "", projectInfo: ProjectInfo | null = null;
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const addedProjects = (): string[] => { try { const a = JSON.parse(saved("toolup.projects") || "[]"); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; } catch { return []; } };
const projName = (path: string) => path.split("/").filter(Boolean).pop() || path;
/**
 * The projects found by themselves: the folders Claude Code and Codex each keep a list of (the ones they were used
 * or trusted in), plus the ones added here by hand. Only folders under home, and only ones that are still there.
 * `projectsNote` says what was looked at, so an empty list explains itself.
 */
let projectsNote = "";
async function loadProjects() {
  const found = new Set<string>(), looked: string[] = [];
  const take = (label: string, keys: string[]) => { const mine = keys.filter((k) => k.startsWith(`${home}/`)); mine.forEach((k) => found.add(k.replace(/\/+$/, ""))); looked.push(`${label}: ${plural(mine.length, "project")}`); };
  if (demo) { found.add("~/code/shop"); found.add("~/code/blog"); }   // the second has no instructions yet
  else {
    try {
      const text = await readFile(`${home}/.claude.json`);
      if (text === null) looked.push("Claude Code: no ~/.claude.json");
      else { const j = parseJsonc(text); take("Claude Code", Object.keys(isRec(j) && isRec(j.projects) ? j.projects : {})); }
    } catch (e) { looked.push(`Claude Code: ~/.claude.json could not be read (${said(e)})`); }
    try {
      const text = await readFile(`${home}/.codex/config.toml`);
      if (text !== null) { const j = parseToml(text); take("Codex", Object.keys(isRec(j) && isRec(j.projects) ? j.projects : {})); }
    } catch (e) { looked.push(`Codex: ~/.codex/config.toml could not be read (${said(e)})`); }
  }
  const added = addedProjects();
  // a folder that was deleted or moved since is left out (ones you added stay, so you can take them off yourself)
  const there = demo ? [...found] : (await Promise.all([...found].map(async (path) => ((await liveHost!.list(path).catch(() => null)) !== null ? path : "")))).filter(Boolean);
  projects = [...new Set([...added, ...there])].map((path) => ({ path, added: added.includes(path) })).sort((x, y) => projName(x.path).localeCompare(projName(y.path)) || x.path.localeCompare(y.path));
  projectsNote = looked.join(" · ");
  paint();
}
async function openProject(path: string) {
  projectOpen = path; projectInfo = null;
  paint();
  if (!path) return;
  projectInfo = await readProject(path);
  if (projectOpen === path) paint();
}
async function readProject(path: string): Promise<ProjectInfo> {
  const info: ProjectInfo = { files: {}, claudeAlone: false, servers: [], skills: [], broken: [] };
  try {
    for (const [f] of CONTEXT) info.files[f] = (await readFile(`${path}/${f}`)) !== null;
    info.claudeAlone = info.files["AGENTS.md"] && info.files["CLAUDE.md"] && !/@AGENTS\.md\b/.test((await readFile(`${path}/CLAUDE.md`)) || "");
    for (const spec of PROJECT_MCP) {
      const text = await readFile(`${path}/${spec.file}`);
      if (text === null) continue;
      let table: Record<string, unknown> = {};
      try { const j = parseJsonc(text); table = isRec(j) && isRec(j[spec.key]) ? (j[spec.key] as Record<string, unknown>) : {}; } catch { info.broken.push(spec.file); }
      for (const [name, v] of Object.entries(table)) {
        const n = normalize(name, v), raw = isRec(v) && typeof v.url === "string" ? v.url : "", plain = raw.startsWith("https://") && bareUrl(raw) && !bareUrl(raw)!.stripped && !n.hasSecrets ? raw : null;
        let row = info.servers.find((x) => x.name === name);
        if (!row) info.servers.push((row = { name, target: n.target || "", url: plain, in: {} }));   // keys and tokens come back masked
        row.in[spec.agent] = true;
        row.url ||= plain;
      }
    }
    for (const loc of PROJECT_SKILLS) for (const e of await listDir(`${path}/${loc.dir}`)) if (e.dir && (await readFile(`${path}/${loc.dir}/${e.name}/SKILL.md`)) !== null) {
      let row = info.skills.find((x) => x.name === e.name);
      if (!row) info.skills.push((row = { name: e.name, in: {} }));
      row.in[loc.id] = true;
    }
    info.servers.sort((x, y) => x.name.localeCompare(y.name)); info.skills.sort((x, y) => x.name.localeCompare(y.name));
  } catch (e) {
    if (projectOpen === path) void tell(projName(path), `This project could not be read. ${said(e)}`);
  }
  return info;
}
/** Put a server into one agent's file in the project (`url`), or take it out (null). Everything else in the file stays. */
async function setProjectServer(path: string, agent: string, name: string, url: string | null) {
  const spec = PROJECT_MCP.find((x) => x.agent === agent)!, file = `${path}/${spec.file}`, text = await readFile(file);
  let doc: Record<string, unknown> = {};
  if (text !== null && text.trim()) {
    try { const j = JSON.parse(text); if (!isRec(j)) throw new Error("not an object"); doc = j; }
    catch { throw new Error(`${spec.file} has comments in it or is not valid JSON, so Tool up! leaves it alone. Change it by hand.`); }
  }
  const table = isRec(doc[spec.key]) ? { ...(doc[spec.key] as Record<string, unknown>) } : {};
  if (url) table[name] = spec.entry(url); else delete table[name];
  doc[spec.key] = table;
  await saveFile(file, `${JSON.stringify(doc, null, 2)}\n`);
}
/** A change on the project page: do it, then read the project again; what goes wrong is shown. */
const projectBusy = new Set<string>();
async function projectDo(id: string, work: () => Promise<void>) {
  const path = projectOpen;
  if (projectBusy.has(id)) return;
  projectBusy.add(id); paint();
  let err: unknown = null;
  try { await work(); } catch (e) { err = e; }
  const info = await readProject(path);
  projectBusy.delete(id);
  if (projectOpen === path) { projectInfo = info; paint(); }
  if (err) void tell(projName(path), said(err));
}
function toggleProjectServer(name: string, agent: string) {
  const row = projectInfo?.servers.find((x) => x.name === name), path = projectOpen;
  if (!row) return;
  return projectDo(`srv:${name}:${agent}`, () => setProjectServer(path, agent, name, row.in[agent] ? null : row.url));
}
function toggleProjectSkill(name: string, id: string) {
  const row = projectInfo?.skills.find((x) => x.name === name), loc = PROJECT_SKILLS.find((x) => x.id === id)!, path = projectOpen;
  if (!row) return;
  return projectDo(`skill:${name}:${id}`, async () => {
    if (demo) throw new Error("Skills are copied in the desktop app.");
    if (row.in[id]) return void (await removeSkill([`${path}/${loc.dir}/${name}`]));
    const other = PROJECT_SKILLS.find((x) => x.id !== id && row.in[x.id]);   // the copy the project already has
    await copySkill(`${path}/${other!.dir}/${name}`, `${path}/${loc.dir}`, name);
  });
}
/** Where a project's skills go by default: Claude Code's folder when Claude Code is here, else the shared one. */
const defaultSkillLoc = () => (cols().some((h) => h.id === "claude-code") || !cols().length ? PROJECT_SKILLS[0] : PROJECT_SKILLS[1]);
/** Choose servers for this project: Tool up!'s list, and the ones of your own that have a plain web address. */
function openAddProjectServers() {
  const path = projectOpen, have = new Set(projectInfo?.servers.map((x) => x.name));
  const mine = inv!.items.filter(copyable).map((i) => ({ id: i.name, name: i.name, url: i.target!, logo: itemLogo(i), about: "Added by you" }));
  const cat = cards.filter((x) => x.sec === "mcp").sort(byName).map((x) => ({ id: x.id, name: x.name, url: (raw.mcp.find((m) => m.id === x.id) as unknown as { url?: string }).url || "", logo: cardLogo(x), about: x.ds || "" }));
  const all = [...mine, ...cat].filter((x) => x.url.startsWith("https://") && !have.has(x.id)), ticked = new Set<string>();
  const to = PROJECT_MCP.filter((x) => cols().some((h) => h.id === x.agent));
  const files = (to.length ? to : [PROJECT_MCP[0]]);
  return openSheet({
    title: "Add servers to this project", sub: projName(path), confirm: "Add",
    pick: (id, on) => { if (id === null) { ticked.clear(); if (on) all.forEach((x) => ticked.add(x.id)); } else if (ticked.has(id)) ticked.delete(id); else ticked.add(id); },
    prepare: async (s) => {
      s.steps = all.map((x): Step => ({ logo: x.logo, title: x.name, detail: x.about, state: ticked.has(x.id) ? "todo" : "skip", pick: x.id, picked: ticked.has(x.id) }));
      s.idle = !ticked.size;
      s.confirm = ticked.size ? `Add ${plural(ticked.size, "server")}` : "Add";
      s.note = `They are written into the project for ${files.map((x) => chipOf(x.agent)).join(", ")}, the agents you have that keep servers in a project. You can change that for each server afterwards. Anyone who opens the project with those agents gets them.`;
      s.tech = files.map((x) => `${tilde(path)}/${x.file}`);
    },
    run: async (s) => {
      for (const x of all.filter((y) => ticked.has(y.id))) for (const f of files) await setProjectServer(path, f.agent, x.id, x.url);
      s.steps = s.steps.filter((st) => st.picked).map((st) => ({ ...st, state: "done", pick: undefined }));
      s.note = "Agents ask you to approve a project's servers the first time they see them.";
      if (projectOpen === path) projectInfo = await readProject(path);
      return true;
    },
    closeWhenDone: true,
  });
}
/** Choose skills for this project from the ones on this computer: each is copied in, so it can be committed with the project. */
function openAddProjectSkills() {
  const path = projectOpen, have = new Set(projectInfo?.skills.map((x) => x.name)), loc = defaultSkillLoc();
  const all = inv!.items.filter((i) => i.kind === "skill" && copyOf(i) && !have.has(i.key.slice("skill:".length))).sort((x, y) => x.name.localeCompare(y.name)), ticked = new Set<string>();
  return openSheet({
    title: "Add skills to this project", sub: projName(path), confirm: "Add",
    pick: (id, on) => { if (id === null) { ticked.clear(); if (on) all.forEach((x) => ticked.add(x.key)); } else if (ticked.has(id)) ticked.delete(id); else ticked.add(id); },
    prepare: async (s) => {
      if (!all.length) throw new Error("Every skill on this computer is already in this project, or there are none. Install a skill first, then add it here.");
      s.steps = all.map((i): Step => ({ logo: itemLogo(i), title: i.name, detail: i.description || "", state: ticked.has(i.key) ? "todo" : "skip", pick: i.key, picked: ticked.has(i.key) }));
      s.idle = !ticked.size;
      s.confirm = ticked.size ? `Add ${plural(ticked.size, "skill")}` : "Add";
      s.note = `Each one is copied into the project for ${loc.label}, so it can be committed and shared. You can turn it on for the others afterwards. The copy is the project's own: updates to yours do not reach it.`;
      s.tech = [`${tilde(path)}/${loc.dir}`];
    },
    run: async (s) => {
      if (demo) throw new Error("Skills are copied in the desktop app.");
      for (const i of all.filter((x) => ticked.has(x.key))) await copySkill(copyOf(i), `${path}/${loc.dir}`, i.key.slice("skill:".length));
      if (projectOpen === path) projectInfo = await readProject(path);
      return true;
    },
    closeWhenDone: true,
  });
}
/** Put a folder on the Projects list and open it. Says what is wrong with it instead, when something is. */
async function addProject(folder: string): Promise<string | void> {
  const path = (folder.startsWith("~/") ? `${home}${folder.slice(1)}` : folder).replace(/\/+$/, "");
  if (!path.startsWith(`${home}/`) || path.includes("/../")) return "Choose a folder inside your home directory. Tool up! does not read anything outside it.";
  if ((await liveHost!.list(path)) === null) return "There is no folder there.";
  save("toolup.projects", JSON.stringify([...new Set([...addedProjects(), path])]));
  await loadProjects();
  void openProject(path);
}
/** Add a project: the system's folder chooser in the app; a typed path where there is none (the sample in a browser). */
async function chooseProject() {
  if (demo) return askProject();
  try {
    const folder = await pickFolder();
    if (!folder) return;
    const err = await addProject(folder);
    if (err) void tell(projName(folder), err);
  } catch { askProject(); }   // no chooser to be had: ask for the path instead
}
const askProject = () => openAsk({
  title: "Add a project", sub: "A folder in your home directory that holds a project your agents work in.", label: "Folder", placeholder: "~/code/my-app", confirm: "Add project",
  go: async (v) => {
    if (demo) return "Projects are added in the desktop app.";
    return addProject(v);
  },
});
function projectsView() {
  if (projects === null) return `<p class="boot">Looking for your projects…</p>`;
  if (!projectOpen) {
    const ql = q.trim().toLowerCase(), list = projects.filter((p) => !ql || p.path.toLowerCase().includes(ql));
    return `<div class="head"><div><h1>Projects</h1><p>Each project's instructions for your agents (AGENTS.md), and the servers and skills it carries.</p></div>
        <button class="btn pri" type="button" data-add-project>${glyph("plus")}Add a project…</button></div>
      ${list.length ? `<ul class="rows">${list.map((p) => `<li class="row"><button class="row-main" type="button" data-project="${esc(p.path)}">${tile("folder")}<span class="row-t"><b>${esc(projName(p.path))}</b><small>${esc(tilde(p.path))}</small></span></button>
        ${p.added ? `<button class="dots" type="button" data-project-del="${esc(p.path)}" title="Take it off this list (the folder is not touched)" aria-label="Take ${esc(projName(p.path))} off the list">${glyph("x")}</button>` : `<span class="dots-gap"></span>`}</li>`).join("")}</ul>`
        : emptyState(projects.length ? "Nothing matches" : "No projects yet", projects.length ? "No project has that in its name or path." : `Projects you have used Claude Code or Codex in show up here by themselves. Add any other folder yourself.${projectsNote ? ` (${projectsNote})` : ""}`)}
      ${list.length && projectsNote ? `<p class="hint found-note">Found by themselves from ${esc(projectsNote)}. Add any other folder with the button above.</p>` : ""}`;
  }
  const name = projName(projectOpen), info = projectInfo;
  const crumb = `<nav class="crumbs" aria-label="You are here"><button type="button" data-project="">Projects</button>${glyph("next")}<span aria-current="page">${esc(name)}</span></nav>`;
  if (!info) return `${crumb}<p class="boot">Reading ${esc(name)}…</p>`;
  const none = !CONTEXT.some(([f]) => info.files[f]), writers = INIT.filter(([a]) => cols().some((h) => h.id === a));
  const start = none ? `<li class="start"><span class="set-t"><b>No instructions yet</b><small>That is a fine way to start: work without them and notice what you keep correcting. When you are ready, let an agent read the project and write them. It opens a terminal here, where you see and approve what it does.</small></span>
      <span class="start-b">${writers.length === 1 ? writers.map(([a, f]) => `<button class="btn" type="button" data-init="${a}" title="Opens a terminal in this project and runs ${esc(chipOf(a))}'s /init, which writes ${f}">Run /init in ${esc(chipOf(a))}</button>`).join("")
        : writers.length ? `<div class="catdd initmenu"><button class="btn" type="button" data-init-menu aria-haspopup="menu" aria-expanded="${initOpen}" title="Opens a terminal in this project and runs the agent's /init, which writes its instructions file">Run /init${glyph("chev")}</button>
          ${initOpen ? `<div class="catdd-list filt-cats" role="menu" aria-label="Run /init in">${writers.map(([a, f]) => `<button type="button" role="menuitem" data-init="${a}"><span class="with-mark">${agents.get(a) ? logo(agents.get(a)!.icon) : ""}${esc(chipOf(a))}</span><small>${esc(f)}</small></button>`).join("")}</div>` : ""}</div>` : ""}<button class="link" type="button" data-ctx="AGENTS.md">Write AGENTS.md myself</button></span></li>` : "";
  const ctx = start || CONTEXT.filter(([f]) => f === "AGENTS.md" || info.files[f]).map(([f, about]) => `<li class="look"><span class="set-t"><b>${f}</b><small>${about}${info.files[f] ? "" : " Not in this project yet."}</small></span><button class="btn" type="button" data-ctx="${f}">${info.files[f] ? "Edit" : "Create"}</button></li>`).join("");
  const missing = POINTERS.filter((f) => !info.files[f]);
  const link = info.files["AGENTS.md"] && missing.length && cols().some((h) => h.id === "gemini") ? `<li class="look"><span class="set-t"><b>Gemini CLI</b><small>It looks for a GEMINI.md by default. This creates one with a single line that points at AGENTS.md, so it reads the same instructions as the rest.</small></span><button class="btn" type="button" data-ctx-link>Create it</button></li>` : "";
  const alone = info.claudeAlone ? `<p class="note">${glyph("warn")}<span>This project has both files, and CLAUDE.md does not pull AGENTS.md in, so Claude Code reads CLAUDE.md alone. Add a line saying <b>@AGENTS.md</b> to CLAUDE.md to share one set of instructions.</span></p>` : "";
  // a switch for each agent (servers) or place (skills) the thing can be in, the same marks the Installed list uses
  const sw = (on: boolean, act: string, title: string, mark: string, busy: boolean) => `<button class="swt${busy ? " busy" : ""}" type="button" role="switch" aria-checked="${on}" ${act || 'aria-disabled="true"'} title="${esc(title)}">${mark}</button>`;
  const agentMark = (id: string) => { const a = agents.get(id); return a ? mono(id, a.icon) : glyph("all"); };
  const servers = info.servers.length ? `<ul class="rows">${info.servers.map((x) => `<li class="row k-mcp"><span class="row-main">${coolIcon(x.name, "", undefined, "cat-mcp", "")}<span class="row-t"><b>${esc(x.name)}</b><small>${esc(x.target)}</small></span></span>
      <span class="swts" role="group" aria-label="Agents for ${esc(x.name)}">${PROJECT_MCP.map((f) => { const on = !!x.in[f.agent], can = on || !!x.url; return sw(on, can ? `data-psrv="${esc(x.name)}" data-agent="${f.agent}"` : "", `${chipOf(f.agent)}: ${on ? `on, in ${f.file}. Click to take it out.` : can ? `off. Click to add it to ${f.file}.` : "off. It runs as a program or carries keys, so Tool up! does not copy it."}`, agentMark(f.agent), projectBusy.has(`srv:${x.name}:${f.agent}`)); }).join("")}</span></li>`).join("")}</ul>`
    : `<p class="none">None yet. A project's servers are kept in the project itself, so everyone who opens it gets them.</p>`;
  const skills = info.skills.length ? `<ul class="rows">${info.skills.map((x) => `<li class="row k-skill"><span class="row-main">${coolIcon(x.name, "", undefined, "book-open", "round")}<span class="row-t"><b>${esc(x.name)}</b><small>${PROJECT_SKILLS.filter((l) => x.in[l.id]).map((l) => l.dir).join(" · ")}</small></span></span>
      <span class="swts" role="group" aria-label="Agents for ${esc(x.name)}">${PROJECT_SKILLS.map((l) => sw(!!x.in[l.id], `data-pskill="${esc(x.name)}" data-loc="${l.id}"`, `${l.label}: ${x.in[l.id] ? `on, in ${l.dir}. Click to take it out (it goes to the Trash).` : `off. Click to copy it into ${l.dir}.`}`, l.id === "claude-code" ? agentMark("claude-code") : glyph("all"), projectBusy.has(`skill:${x.name}:${l.id}`))).join("")}</span></li>`).join("")}</ul>`
    : `<p class="none">None yet. A project's skills are copies kept in the project, so they can be committed with it.</p>`;
  const broken = info.broken.length ? `<p class="note bad">${glyph("warn")}<span>${esc(info.broken.join(", "))} could not be read: not valid JSON.</span></p>` : "";
  const sect = (title: string, hint: string, add: string, body: string) => `<div class="sect-h"><div><h3>${title}</h3><p class="hint">${hint}</p></div>${add}</div>${body}`;
  return `${crumb}<div class="head proj-head"><span class="proj-ico" aria-hidden="true">${glyph("folder")}</span><div class="proj-name"><h1>${esc(name)}</h1><p>${esc(tilde(projectOpen))}</p></div>${liveHost ? `<button class="btn" type="button" data-reveal-path="${esc(projectOpen)}">${glyph("folder")}Show in Finder</button>` : ""}</div>
    <div class="proj">
    ${sect("Instructions for agents", "What your agents are told every time they work in this project.", "", `${alone}<ul class="sets">${ctx}${link}</ul>`)}
    ${sect("MCP servers in this project", "Only for agents working in this folder. One switch for each agent that keeps servers in a project: Claude Code, Cursor, VS Code.", `<button class="btn" type="button" data-padd="servers">${glyph("plus")}Add servers…</button>`, broken + servers)}
    ${sect("Skills in this project", "Only for agents working in this folder. One switch for Claude Code, one for the agents that share .agents/skills.", `<button class="btn" type="button" data-padd="skills">${glyph("plus")}Add skills…</button>`, skills)}
    </div>`;
}
const editContext = (file: string) => {
  const about = CONTEXT.find(([f]) => f === file)?.[1] || "", path = projectOpen;
  return openEditor(`${path}/${file}`, `${file} · ${projName(path)}`, `${about} Agents read it the next time they start in this project.`, `# ${projName(path)}\n\n`, () => openProject(path));
};

/* ---------- backup: Tool up!'s saved skills, kept in a GitHub repository of yours ---------- */
let backupRepo = saved("toolup.backup-repo");
function openBackup(restore: boolean) {
  const store = expand(SKILL_STORE, home);
  return openSheet({
    title: restore ? "Restore your saved skills from GitHub?" : "Back up your saved skills to GitHub?", sub: backupRepo, confirm: restore ? "Restore" : "Back up",
    prepare: async (s) => {
      if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(?:\.git)?\/?$/.test(backupRepo)) throw new Error("Give the backup a GitHub repository first, as https://github.com/you/your-backup.");
      const n = inv!.items.filter((i) => i.store).length;
      s.steps = [{ logo: tile("all"), title: restore ? "Bring back what the repository holds" : plural(n, "saved skill"), detail: restore ? "Pulled into Tool up!'s saved skills. If the two have gone different ways it stops and says so; nothing here is overwritten." : "Committed and pushed with your own git sign-in. Use a private repository.", state: "todo" }];
      s.note = "Only the shared copies Tool up! keeps are included. A skill that lives in one agent's own folder is not: use “Keep one shared copy” on it first.";
      s.tech = [`Folder: ${tilde(store)}`, `Repository: ${backupRepo}`];
    },
    run: async (s) => {
      const r = await backupStore(store, backupRepo, restore);
      s.log = r.output; s.tech = r.output.trim().split("\n");
      if (r.code !== 0) return false;
      s.steps = s.steps.map((st) => ({ ...st, state: "done" }));
      s.note = restore ? "Your saved skills match the repository." : "Your saved skills are in the repository.";
      await load(true);
      return true;
    },
  });
}

/* ---------- toolup:// links: the site (or anyone) can ask the app to install something; the app always asks first ---------- */
const pendingLinks: string[] = [];
function openLink(url: string) {
  if (!inv) return void pendingLinks.push(url);
  let u: URL;
  try { u = new URL(url); } catch { return; }
  if (u.protocol !== "toolup:") return;
  const what = u.hostname || u.pathname.replace(/^\/+/, ""), arg = (k: string) => u.searchParams.get(k) || "";
  if (what === "install") {
    const ids = arg("ids").split(",").filter((id) => listed.has(id));
    if (ids.length) { screen = "catalog"; void openInstall(ids, new Set(into!), true); }
  } else if (what === "add") {
    const p = githubSkills(arg("repo"), true);
    if (p && p.type === "skill") { if (/^[\w.-]+$/.test(arg("skill"))) p.skills = [arg("skill")]; void openPasted(p); }
  } else if (what === "server" && /^https:\/\/\S+$/.test(arg("url"))) {
    void openPasted({ type: "server", name: arg("name").replace(/[^\w .-]/g, "").slice(0, 60) || new URL(arg("url")).hostname, url: arg("url"), secrets: false });
  }
}

/* ---------- a group of things, drawn as a folder (the card from Get'Em, sized for a list) ---------- */
/**
 * A frosted folder with a page sticking out for each of the first three things in it (the rest are blank sheets
 * behind), a pill on its front for the main thing to do, and a two-line caption. `open` is what a click on the
 * card does; `pill` what its button does; `corner` an extra small button at the top right (to delete it, say).
 */
/** The folder on its own: pages for the first three things, blank sheets for the rest, and whatever goes on its front. */
function folderArt(items: { logo: string; name: string }[], total: number, front = "") {
  const show = items.slice(0, 3), gaps = Math.max(1, show.length - 1), tilt = Math.min(7, 20 / gaps), step = show.length === 2 ? 46 : 38;
  const papers = show.map((x, i) => { const off = i - (show.length - 1) / 2; return `<span class="paper" style="--x:${(off * step).toFixed(1)}px;--rot:${(off * tilt).toFixed(1)}deg;--sag:${(Math.abs(off) * 1.5).toFixed(1)}px;z-index:${i + 1}">${x.logo}<span class="paper-name">${esc(x.name)}</span><span class="paper-line"></span><span class="paper-line short"></span></span>`; }).join("");
  const ghosts = Array.from({ length: Math.min(4, Math.max(0, total - show.length)) }, (_, i) => { const side = i % 2 ? 1 : -1; return `<span class="ghost" style="--gx:${side * (4 + i * 3.4)}px;--gy:${(-i * 1.6).toFixed(1)}px;--gr:${side * (2.5 + i * 1.2)}deg"></span>`; }).join("");
  return `<span class="folder"><span class="folder-back" aria-hidden="true"></span><span class="folder-pages" aria-hidden="true">${ghosts}${papers}</span><span class="folder-front">${front}</span></span>`;
}
function folderCard(o: { open: string; label: string; title: string; sub: string; items: { logo: string; name: string }[]; total: number; pill: { attr: string; label: string; title?: string }; corner?: string }) {
  return `<div class="fold" role="button" tabindex="0" ${o.open} aria-label="${esc(o.label)}">
    ${folderArt(o.items, o.total, `<button class="folder-pill" type="button" ${o.pill.attr}${o.pill.title ? ` title="${esc(o.pill.title)}"` : ""}>${esc(o.pill.label)}</button>`)}
    <span class="folder-caption"><b class="folder-n">${esc(o.title)}</b><span class="folder-sub">${esc(o.sub)}</span></span>${o.corner || ""}</div>`;
}
const paperOf = (x: Listed) => ({ logo: cardLogo(x, "mini"), name: x.name });

/* ---------- collections: a publisher's own set of skills (one repository), to install whole or in part ---------- */
interface Collection { repo: string; title: string; about: string; items: Listed[] }
const OWNER_NAMES: Record<string, string> = { anthropics: "Anthropic", "vercel-labs": "Vercel", docker: "Docker", obra: "Superpowers", mattpocock: "Matt Pocock", addyosmani: "Addy Osmani", getsentry: "Sentry", cloudflare: "Cloudflare", figma: "Figma", makenotion: "Notion", trailofbits: "Trail of Bits", helmcode: "Helmcode", coreyhaines31: "Marketing", bergside: "Design styles", mengto: "Meng To", arla6ka: "design.how" };
/** Every catalog repository with three skills or more, the largest first. */
const collections: Collection[] = (() => {
  const by = new Map<string, Listed[]>();
  for (const x of cards) if (x.sec === "skill" && x.repo) by.set(x.repo, [...(by.get(x.repo) || []), x]);
  const about = new Map(((raw as unknown as { repos?: { repo: string; ds?: string }[] }).repos || []).map((r) => [r.repo, r.ds || ""]));
  return [...by].filter(([, items]) => items.length >= 3).map(([repo, items]) => {
    const owner = repo.split("/")[0];
    return { repo, title: `${OWNER_NAMES[owner] || owner} skills`, about: about.get(repo) || "", items: [...items].sort(byName) };
  }).sort((a, b) => b.items.length - a.items.length || a.title.localeCompare(b.title));
})();
const collOf = (repo: string) => collections.find((c) => c.repo === repo);
/** The folder a catalog skill sits in inside its repository (its id, unless the details say another). */
const folderOf = (x: Listed) => (more[x.id]?.path || x.id).split("/").filter(Boolean).pop() || x.id;
const collHave = (c: Collection) => c.items.filter((x) => haveIt(x.id).length > 0).length;
const collCard = (c: Collection) => { const have = collHave(c); return folderCard({
  open: `data-coll="${esc(c.repo)}"`, label: `Open ${c.title}`, title: c.title, sub: `${plural(c.items.length, "skill")}${have ? ` · ${have} installed` : ""}`,
  items: c.items.map(paperOf), total: c.items.length, pill: { attr: `data-getcoll="${esc(c.repo)}"`, label: have ? "Install more…" : "Install…", title: "Choose all of them, or only some" },
}); };
function collShelf() {
  if (!enabled.has("toolup") || !collections.length) return "";
  return `<section class="shelf"><div class="shelf-h"><h2><button class="shelf-link" type="button" data-list="collections" title="See all ${collections.length}">Collections${glyph("next")}</button></h2></div><p>Each publisher's own set of skills. Install all of one, or only the ones you want. Make your own from any Install button's menu.</p><div class="folders one">${collections.map(collCard).join("")}</div><button class="shelf-more" type="button" data-list="collections">See all ${collections.length} collections${glyph("next")}</button></section>`;
}
function collView(c: Collection) {
  const have = collHave(c);
  return `<div class="crumb-row">${crumbs(c.title)}</div>
    <div class="coll-h"><span class="fold art" aria-hidden="true">${folderArt(c.items.map(paperOf), c.items.length)}</span><div><h1 class="page-t">${esc(c.title)}</h1><p><button class="link gh" type="button" data-url="${esc(repoUrl(c.repo))}" title="Open the repository on GitHub">${glyph("github")}${esc(c.repo)}</button>${c.about ? ` · ${esc(c.about)}` : ""}</p>
      <p class="coll-n">${plural(c.items.length, "skill")}${have ? ` · ${have} installed` : ""}</p>
      <div class="coll-b"><button class="btn pri" type="button" data-getcoll="${esc(c.repo)}">${have ? "Install the rest…" : `Install all ${c.items.length}…`}</button><button class="btn" type="button" data-url="${esc(repoUrl(c.repo))}">${glyph("github")}View on GitHub</button></div></div></div>
    <section class="shelf"><div class="bar"><span class="count">Each can also be installed on its own.</span>${layToggle()}</div><div class="${appsCls()}">${c.items.map(appRow).join("")}</div>
      <p class="coll-more">These are the ones Tool up! lists. The repository may hold others: <button class="link" type="button" data-allcoll="${esc(c.repo)}">see every skill in ${esc(c.repo)}…</button></p></section>`;
}
/** Get a collection: the tick-box sheet, with what is not installed yet ticked, so it is all of it or any part. */
function getCollection(repo: string, everything = false) {
  const c = collOf(repo);
  if (!c) return;
  if (everything) return void openSkillsRepo(repo, []);
  const todo = c.items.filter((x) => !haveIt(x.id).length);
  return void openSkillsRepo(repo, (todo.length ? todo : c.items).map(folderOf));
}

/* ---------- let an agent write a project's instructions: a terminal in the project, with its own /init ---------- */
// what each agent's command writes, so the button can say it
const INIT: [string, string][] = [["claude-code", "CLAUDE.md"], ["codex", "AGENTS.md"], ["gemini", "GEMINI.md"]];
async function runInit(agent: string) {
  if (demo) return void tell(chipOf(agent), "This opens a terminal from the desktop app.");
  try { await openTerminal(projectOpen, agent); }
  catch (e) { void tell(chipOf(agent), said(e)); }
}

if (navigator.userAgent.includes("Mac") && inTauri()) document.documentElement.classList.add("mac-app");
shell();
applyLook();
app.addEventListener("click", (e) => {
  const t = e.target as HTMLElement, hit = (s: string) => t.closest<HTMLElement>(s);
  let el: HTMLElement | null;
  if (shotOpen) { shotOpen = ""; return paint(); }
  if ((el = hit("[data-menu]"))) {
    const r = el.getBoundingClientRect(), key = el.dataset.menu!;
    menu = menu?.key === key ? null : { key, x: Math.max(8, innerWidth - r.right), y: Math.min(r.bottom + 4, innerHeight - 250) };
    menuAt = performance.now();
    return paintMenu();
  }
  if ((el = hit("[data-get-menu]"))) {
    const r = el.getBoundingClientRect(), id = el.dataset.getMenu!;
    getMenu = getMenu?.id === id ? null : { id, x: Math.max(8, innerWidth - r.right), y: Math.min(r.bottom + 4, innerHeight - 300) };
    menu = null; menuAt = performance.now();
    return paintMenu();
  }
  if (menu || getMenu) { menu = null; getMenu = null; paintMenu(); }   // any other click closes it (and may go on to pick an item from it)
  if ((el = hit("[data-enable-all]"))) return void openEnableSkillAll(el.dataset.enableAll!);
  if ((el = hit("[data-about]"))) return void openDetail(el.dataset.about!);
  if ((el = hit("[data-dtab]")) && detail) { detail.tab = el.dataset.dtab!; return paint(); }
  if ((el = hit("[data-lay]"))) {
    if (el.dataset.layFor === "installed") { instLayout = el.dataset.lay!; save("toolup.layout.installed", instLayout); }
    else { layout = el.dataset.lay!; save("toolup.layout", layout); }
    return paint();
  }
  if ((el = hit("[data-theme-set]"))) { theme = el.dataset.themeSet!; save("toolup.theme", theme); applyLook(); return paint(); }
  if ((el = hit("[data-accent-set]"))) { accent = el.dataset.accentSet!; save("toolup.accent", accent); applyLook(); return paint(); }
  if (hit("[data-more-agents]")) { moreAgents = !moreAgents; return paint(); }
  if ((el = hit("[data-go]"))) return goPlace(+el.dataset.go!);
  if (hit("[data-meadow-arrange]")) { arranging = !arranging; if (!arranging) chosen = ""; return paint(); }
  if (hit("[data-meadow-hide]")) { setMeadowOff(true); return paint(); }
  if ((el = hit("[data-meadow-show]"))) { setMeadowOff(el.dataset.meadowShow === "0"); return paint(); }
  if ((el = hit("[data-meadow-move]"))) { meadowStill = el.dataset.meadowMove === "0"; save("toolup.meadow-still", meadowStill ? "1" : ""); return paint(); }
  if (hit("[data-meadow-reset]")) { spots = {}; keepSpots(); return paint(); }
  if ((el = hit("[data-meadow]"))) {   // arranging: pick it (the drag itself is handled above). Otherwise: show only what that agent has
    if (arranging) { if (chosen !== el.dataset.meadow) { chosen = el.dataset.meadow!; paint(); document.querySelector<HTMLElement>(`[data-meadow="${chosen}"]`)?.focus(); } return; }
    instAgent = instAgent === el.dataset.meadow ? "" : el.dataset.meadow!; return paint();
  }
  if (hit("[data-clear-inst]")) { instFilter = "all"; instAgent = ""; q = ""; document.querySelector<HTMLInputElement>("#q")!.value = ""; return paint(); }
  if (hit("[data-init-menu]")) { initOpen = !initOpen; return paint(); }
  if (initOpen) { initOpen = false; if (!hit("[data-init]")) paint(); }
  if (hit("[data-add-menu]")) { addOpen = !addOpen; return paint(); }
  if (addOpen) { addOpen = false; if (!hit("[data-screen], [data-add-github]")) paint(); }
  if (hit("[data-add-github]")) return askGithub();
  if (hit("[data-ask-close]") || (t.classList.contains("scrim") && ask && !ask.busy && !sheet)) { ask = null; return paint(); }
  if (hit("[data-editor-close]")) { editor = null; return paint(); }
  if ((el = hit("[data-edit-skill]"))) { const item = inv!.items.find((i) => i.key === el!.dataset.editSkill); return item ? void editSkill(item) : undefined; }
  if ((el = hit("[data-copy-skill]"))) return askCopy(el.dataset.copySkill!);
  if ((el = hit("[data-project]"))) { document.querySelector("#body")!.scrollTop = 0; return void openProject(el.dataset.project!); }
  if (hit("[data-add-project]")) return void chooseProject();
  if ((el = hit("[data-project-del]"))) { save("toolup.projects", JSON.stringify(addedProjects().filter((p) => p !== el!.dataset.projectDel))); return void loadProjects(); }
  if ((el = hit("[data-ctx]"))) return void editContext(el.dataset.ctx!);
  if ((el = hit("[data-padd]"))) return void (el.dataset.padd === "servers" ? openAddProjectServers() : openAddProjectSkills());
  if ((el = hit("[data-psrv]"))) return void toggleProjectServer(el.dataset.psrv!, el.dataset.agent!);
  if ((el = hit("[data-pskill]"))) return void toggleProjectSkill(el.dataset.pskill!, el.dataset.loc!);
  if (hit("[data-ctx-link]")) {   // only the pointer files that are not there yet: one that exists is never written over
    const path = projectOpen, todo = POINTERS.filter((f) => !projectInfo?.files[f]);
    return void Promise.all(todo.map((f) => saveFile(`${path}/${f}`, "@AGENTS.md\n"))).then(() => openProject(path), (e) => tell(projName(path), said(e)));
  }
  if ((el = hit("[data-reveal-path]"))) { reveal(el.dataset.revealPath!).catch(() => {}); return; }
  if ((el = hit("[data-backup]"))) return void openBackup(el.dataset.backup === "restore");
  if ((el = hit("[data-getcoll]"))) return getCollection(el.dataset.getcoll!);
  if ((el = hit("[data-allcoll]"))) return getCollection(el.dataset.allcoll!, true);
  if ((el = hit("[data-coll]"))) { shop.coll = el.dataset.coll!; shop.detail = ""; shop.cat = ""; shop.list = ""; shop.pack = -1; shop.plugin = ""; q = ""; document.querySelector<HTMLInputElement>("#q")!.value = ""; document.querySelector("#body")!.scrollTop = 0; return paint(); }
  if ((el = hit("[data-init]"))) return void runInit(el.dataset.init!);
  if (hit("[data-save-preset]")) return askPreset([...picked]);
  if ((el = hit("[data-preset-new]"))) return askPreset([el.dataset.presetNew!]);
  if ((el = hit("[data-preset-add], [data-preset-drop]"))) {   // straight in or out of a preset you have
    const pr = presets[+(el.dataset.presetAdd ?? el.dataset.presetDrop!)], id = el.dataset.id!;
    if (pr) { pr.ids = el.dataset.presetAdd !== undefined ? [...new Set([...pr.ids, id])] : pr.ids.filter((x) => x !== id); savePresets(); }
    return paint();
  }
  if (hit("[data-sheet-preset]") && sheet?.presetIds && sheet.phase === "ready") {   // from an install sheet: save, then come back to it
    const ids = sheet.presetIds, fromTray = sheet.fromTray, targets = sheet.targets ? new Set(sheet.targets) : new Set(into!);
    sheet = null;
    return askPreset(ids, () => void openInstall(ids, targets, fromTray));
  }
  if ((el = hit("[data-preset-del]"))) { presets.splice(+el.dataset.presetDel!, 1); savePresets(); return paint(); }
  if ((el = hit("[data-preset]"))) { const p = presets[+el.dataset.preset!]; const ids = (p?.ids || []).filter((id) => listed.has(id)); return ids.length ? void openInstall(ids, new Set(into!), true) : undefined; }
  if (hit("[data-agents-menu]")) { agentsOpen = !agentsOpen; return paint(); }
  if (agentsOpen) { agentsOpen = false; if (!hit("[data-inst-agent]")) paint(); }
  if ((el = hit("[data-inst-agent]"))) { instAgent = el.dataset.instAgent!; return paint(); }
  if ((el = hit("[data-update]"))) return flip(el.dataset.update!, "update", updateSkill);
  if (hit("[data-update-all]")) { for (const i of updatable()) flip(i.key, "update", updateSkill); return; }
  if ((el = hit("[data-adopt]"))) return flip(el.dataset.adopt!, "adopt", adoptSkill);
  if ((el = hit("[data-unsrv]"))) return unServer(el.dataset.unsrv!, el.dataset.from!);
  if ((el = hit("[data-copysrv]"))) { const agent = el.dataset.into!; return flip(el.dataset.copysrv!, agent, (item) => copyServer(item, agent)); }
  if ((el = hit("[data-inst]"))) { instFilter = instFilter === el.dataset.inst ? "all" : el.dataset.inst!; return paint(); }
  if ((el = hit("[data-version]"))) return void openVersion(el.dataset.version!);
  if (hit("[data-detail-close]") || (t.classList.contains("dscrim") && !sheet)) { detail = null; return paint(); }
  if ((el = hit("[data-copy]"))) { const b = el; navigator.clipboard?.writeText(b.dataset.copy!).then(() => { b.classList.add("done"); setTimeout(() => b.classList.remove("done"), 1200); }, () => {}); return; }
  if ((el = hit("[data-shot]"))) { shotOpen = el.dataset.shot!; return paint(); }
  if ((el = hit("[data-url]"))) { openUrl(el.dataset.url!).catch(() => {}); return; }
  if ((el = hit("[data-getagent]"))) { const url = getAgentUrl(el.dataset.getagent!); if (url) openUrl(url).catch(() => {}); return; }
  if ((el = hit("[data-reveal]"))) {
    const item = inv!.items.find((i) => i.key === el!.dataset.reveal);
    if (item) reveal(placeOf(item)).catch((e) => openSheet({ title: "", sub: item.name, prepare: async () => { throw new Error(said(e)); }, run: async () => false }));
    return;
  }
  if ((el = hit("[data-screen]"))) { shop.coll = ""; screen = el.dataset.screen as Screen; if (screen === "projects") { projectOpen = ""; void loadProjects(); } shop.detail = ""; shop.pack = -1; shop.plugin = ""; shop.list = ""; document.querySelector("#body")!.scrollTop = 0; paint(); return queueSearch(); }
  if (hit("[data-cats]")) { catsOpen = !catsOpen; srcOpen = false; return paint(); }
  if (hit("[data-srcs]")) { srcOpen = !srcOpen; catsOpen = false; return paint(); }
  // each menu closes on a click anywhere else; Categories also when one is picked, Sources stays open while boxes are ticked
  if (catsOpen) { catsOpen = false; if (!hit("[data-cat]")) paint(); }
  if (srcOpen && !hit(".catdd-list")) { srcOpen = false; paint(); }
  if ((el = hit("[data-detail]"))) { shop.detail = el.dataset.detail!; document.querySelector("#body")!.scrollTop = 0; return paint(); }
  if ((el = hit("[data-crumb]"))) {
    shop.detail = ""; shop.plugin = "";
    if (el.dataset.crumb === "home") { shop.pack = -1; shop.cat = ""; shop.list = ""; shop.coll = ""; q = ""; document.querySelector<HTMLInputElement>("#q")!.value = ""; ext = {}; }
    document.querySelector("#body")!.scrollTop = 0;
    return paint();
  }
  if ((el = hit("[data-plugin]"))) { shop.plugin = el.dataset.plugin!; document.querySelector("#body")!.scrollTop = 0; return paint(); }
  if ((el = hit("[data-list]"))) { const k = el.dataset.list!, on = !q.trim() && shop.list === k && el.classList.contains("chip"); shop.coll = "";
    shop.list = on ? "" : k;   // a kind's button switches it on, and off again; skills and servers keep the category, the others have none
    if (shop.list === "plugins" || shop.list === "custom") shop.cat = ""; shop.page = PAGE; shop.detail = ""; shop.plugin = ""; shop.pack = -1; q = ""; document.querySelector<HTMLInputElement>("#q")!.value = ""; document.querySelector("#body")!.scrollTop = 0; return paint(); }
  if ((el = hit("[data-getplugin]"))) { const p = market.plugins.find((x) => x.name === el!.dataset.getplugin); if (p) openInstallPlugin(p); return; }
  if ((el = hit("[data-get]"))) return void openInstall([el.dataset.get!], new Set(into!), true);
  if ((el = hit("[data-getpack]"))) return void openInstall(raw.packs[+el.dataset.getpack!].ids, new Set(into!), true);
  if ((el = hit("[data-readmore]"))) {
    const x = listed.get(el.dataset.readmore!)!, doc = { id: x.id, state: "loading" as "loading" | "ok" | "error", text: "" };
    detailDoc = doc; paint();
    fetchSkill(x.repo!, x.id, "").then((got) => inspectSkill(got.staged)).then((f) => { doc.state = "ok"; doc.text = f.skillMd.replace(/^---[\s\S]*?---\s*/, "").trim(); }, (e) => { doc.state = "error"; doc.text = said(e); }).then(() => { if (detailDoc === doc) paint(); });
    return;
  }
  if ((el = hit("[data-found]"))) {
    const [src, n] = el.dataset.found!.split(":"), f = ext[src]?.items[+n], how = f?.install;
    if (how?.type === "skill") return void openSkill(`${f.name} · ${f.by}`, { repo: how.repo, skill: how.skill, path: how.path });
    if (how?.type === "mcp") return void openInstallServer(f, how.id, how.url);
    return;
  }
  if ((el = hit("[data-tab]"))) { if (screen === "installed") view.tab = el.dataset.tab as Tab; else { shop.tab = el.dataset.tab as Tab; shop.page = PAGE; } return paint(); }
  if ((el = hit("[data-cat]"))) { shop.coll = ""; shop.cat = el.dataset.cat!; if (shop.cat && (shop.list === "plugins" || shop.list === "custom")) shop.list = ""; q = ""; document.querySelector<HTMLInputElement>("#q")!.value = ""; shop.pack = -1; shop.page = PAGE; document.querySelector("#body")!.scrollTop = 0; return paint(); }
  if (hit("[data-more]")) { shop.page += PAGE; return paint(); }
  if ((el = hit("[data-pick]"))) { const id = el.dataset.pick!; picked.has(id) ? picked.delete(id) : picked.add(id); return paint(); }
  if ((el = hit("[data-unpick]"))) { picked.delete(el.dataset.unpick!); return paint(); }
  if ((el = hit("[data-pack]"))) { shop.pack = +el.dataset.pack!; shop.detail = ""; document.querySelector("#body")!.scrollTop = 0; return paint(); }
  if (hit("[data-clear]")) { picked.clear(); return paint(); }
  if ((el = hit("[data-agent]"))) { const id = el.dataset.agent!; into!.has(id) ? into!.delete(id) : into!.add(id); return paint(); }
  if (hit("[data-install]")) return void openInstall([...picked], new Set(into!), true);
  if ((el = hit("[data-fill]"))) { const id = el.dataset.fill!, agent = el.dataset.into!, item = inv!.items.find((i) => i.catalogId === id); return item ? flip(item.key, agent, () => fillServer(id, agent)) : void openInstall([id], new Set([agent]), false); }
  if ((el = hit("[data-enable]"))) { const agent = el.dataset.into!; return flip(el.dataset.enable!, agent, (item) => enableSkill(item, agent)); }
  if ((el = hit("[data-sheet-agent]")) && sheet?.targets && sheet.phase === "ready") {
    const s = sheet, id = el.dataset.sheetAgent!;
    s.targets!.has(id) ? s.targets!.delete(id) : s.targets!.add(id);
    return void s.prepare(s).catch((e) => { s.steps = []; s.note = said(e); s.idle = true; }).then(() => { if (sheet === s) paint(); });
  }
  if ((el = hit("[data-step-pick], [data-step-all]")) && sheet?.pick && sheet.phase === "ready") return void pickStep(el);
  if (hit("[data-run]")) return void runSheet();
  if ((el = hit("[data-unskill]"))) { const agent = el.dataset.from!; return flip(el.dataset.unskill!, agent, (item) => turnOff(item, agent)); }
  if ((el = hit("[data-delskill]"))) return void openRemoveSkill(el.dataset.delskill!, null);
  if (hit("[data-close]") || (t.classList.contains("scrim") && sheet && sheet.phase !== "preview" && sheet.phase !== "running")) { sheet = null; return paint(); }
  if (hit("#rescan")) load();
});
app.addEventListener("submit", (e) => {
  const f = e.target as HTMLElement;
  if (f.matches("[data-ask]")) { e.preventDefault(); void submitAsk(); }
  if (f.matches("[data-editor]")) { e.preventDefault(); void saveEditor(); }
});
app.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "q") { q = t.value; shop.page = PAGE; shop.detail = ""; shop.pack = -1; shop.plugin = ""; queueSearch(); paint(); }
  if (t.dataset.catalog) {
    t.checked ? enabled.add(t.dataset.catalog) : enabled.delete(t.dataset.catalog);
    save("toolup.sources.v2", [...enabled].join(",") || "none"); paint(); queueSearch();
  }
  if ("meadowSize" in t.dataset && chosen) { spots[chosen] = { ...spotOf(chosen), w: +t.value }; placeSprite(chosen); keepSpots(); }
  if (t.dataset.agentUse) {
    t.checked ? agentsOff.delete(t.dataset.agentUse) : agentsOff.add(t.dataset.agentUse);
    save("toolup.agents-off", [...agentsOff].join(","));
    const here = new Set(cols().map((h) => h.id));   // what gets installed into follows what is in use
    into = new Set([...(into || here)].filter((id) => here.has(id)));
    if (!into.size || t.checked) into = here;   // an agent taken back into use is installed into again
    if (instAgent && !here.has(instAgent)) instAgent = "";
    paint();
  }
  if (t.id === "ask-in" && ask) ask.value = t.value;
  if (t.id === "editor-ta" && editor) editor.text = t.value;
  if (t.id === "backup-repo") { backupRepo = t.value.trim(); save("toolup.backup-repo", backupRepo); }
  if (t.name === "skill-mode") { skillMode = t.value; save("toolup.skill-mode", skillMode); }
  if (t.name === "choice" && sheet?.choice && sheet.phase === "ready") { sheet.choice.value = t.value; const s = sheet; s.prepare(s).then(() => { if (sheet === s) paint(); }); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (menu || getMenu)) { menu = null; getMenu = null; paintMenu(); } });
// a folder card is a button: Enter and Space open it
document.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (t.classList?.contains("fold") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); t.click(); }
});
// a step's tick box answers to Space and Enter, like any checkbox
document.addEventListener("keydown", (e) => {
  const el = (e.target as HTMLElement).closest?.<HTMLElement>("[data-step-pick]");
  if (el && (e.key === " " || e.key === "Enter") && sheet?.pick && sheet.phase === "ready") { e.preventDefault(); void pickStep(el); }
});
// scrolling the list closes the menu, except for a scroll still settling when it was opened (trackpad momentum)
document.querySelector("#body")!.addEventListener("scroll", () => { if ((menu || getMenu) && performance.now() - menuAt > 400) { menu = null; getMenu = null; paintMenu(); } });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (shotOpen) { shotOpen = ""; return paint(); }
  if (sheet) { if (sheet.phase !== "preview" && sheet.phase !== "running") { sheet = null; paint(); } }
  else if (ask) { if (!ask.busy) { ask = null; paint(); } }
  else if (editor) { if (!editor.busy) { editor = null; paint(); } }
  else if (addOpen) { addOpen = false; paint(); }
  else if (initOpen) { initOpen = false; paint(); }
  else if (detail && !menu) { detail = null; paint(); }
});
// pasting an install command anywhere in the window installs what it names; any other paste goes where it was going
document.addEventListener("paste", (e) => {
  const got = parsePaste(e.clipboardData?.getData("text/plain") || "");
  if (!got || !inv || sheet) return;
  e.preventDefault();
  void openPasted(got);
});
// dropping a .skill file anywhere on the window installs it
if (inTauri()) {
  const drop = document.querySelector<HTMLElement>("#drop")!;
  const busy = () => !!sheet && (sheet.phase === "preview" || sheet.phase === "running");
  getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    drop.hidden = !(p.type === "enter" || p.type === "over") || busy();
    if (p.type !== "drop" || !inv || busy()) return;
    const file = p.paths.find((f) => /\.(skill|zip)$/i.test(f));
    if (file) openSkillFile(file);
    else openSheet({ title: "", sub: p.paths[0]?.split(/[\\/]/).pop() || "", prepare: async () => { throw new Error("That is not a .skill file. Drop a file ending in .skill to install a skill."); }, run: async () => false });
  });
}
if (inTauri()) void listen<string[]>("deep-link", (e) => e.payload.forEach(openLink));
load().then(async () => { for (const u of [...pendingLinks.splice(0), ...(await startLinks().catch(() => []))]) openLink(u); });

// back and forward from the keyboard (⌘[ and ⌘], as in Finder and the App Store) and from a mouse's side buttons;
// the page remembers how far down it was scrolled
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || (e.key !== "[" && e.key !== "]")) return;
  e.preventDefault(); goPlace(e.key === "[" ? -1 : 1);
});
document.addEventListener("mouseup", (e) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); goPlace(e.button === 3 ? -1 : 1); } });
document.addEventListener("scroll", (e) => { const b = e.target as HTMLElement; if (b.id === "body" && places[placeAt]) places[placeAt].top = b.scrollTop; }, true);

/* ---------- a card's full text: when its name or description is cut short, pointing at the card shows all of it ---------- */
const tip = document.createElement("div");
tip.className = "tip"; tip.hidden = true; tip.setAttribute("role", "tooltip");
document.body.appendChild(tip);
let tipTimer = 0, tipFor: Element | null = null;
const cutShort = (el: Element | null) => !!el && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
const hideTip = () => { clearTimeout(tipTimer); tipFor = null; tip.hidden = true; };
document.addEventListener("mouseover", (e) => {
  const main = (e.target as HTMLElement).closest?.(".app-main, .row-main") || null;
  if (main === tipFor) return;
  hideTip();
  if (!main) return;
  tipFor = main;
  const name = main.querySelector("b"), about = main.querySelector(".app-t > small, .row-t > small");
  if (!cutShort(name) && !cutShort(about)) return;
  tipTimer = window.setTimeout(() => {
    if (!main.isConnected || tipFor !== main) return;
    tip.innerHTML = `<b>${esc(name?.textContent || "")}</b>${about?.textContent ? `<span>${esc(about.textContent)}</span>` : ""}`;
    tip.hidden = false;
    // under the card, in line with its text; above it when there is no room below
    const box = main.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(box.left, innerWidth - w - 8))}px`;
    tip.style.top = `${box.bottom + 10 + h > innerHeight - 8 ? Math.max(8, box.top - h - 10) : box.bottom + 10}px`;
  }, 450);
});
document.addEventListener("scroll", hideTip, true);
document.addEventListener("mousedown", hideTip);
document.addEventListener("keydown", hideTip);
document.addEventListener("mouseleave", hideTip);
