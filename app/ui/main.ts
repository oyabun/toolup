// The window. Two views over the same machine:
//   Installed  one row per MCP server or skill, one column per agent; an empty cell is a gap you can fill
//   Catalog    the Tool up! catalog as cards, to pick from and install
// Installing always goes through the Tool up! installer, and always shows what it will do first.
import catalogJson from "../../public/catalog.json";
import detailsJson from "../../catalog/details.json";
import { NOT_YET, SOURCES, type Found } from "../core/catalogs.ts";
import { expand, ownSkillsDir, SKILL_STORE } from "../core/harnesses.ts";
import { latestCommitUrl, parseLatestCommit, repoUrl } from "../core/github.ts";
import { connectorsUrl, MARKETS, marketUrl, parseConnectors, parseMarket, PLUGIN_AGENTS, pluginSkills, repoSkills, treeUrl, type Plugin } from "../core/plugins.ts";
import { parsePaste, type Pasted } from "../core/paste.ts";
import { bareUrl } from "../core/server.ts";
import { frontMatter, scan } from "../core/scan.ts";
import type { Catalog, HarnessReport, Inventory, Item } from "../core/types.ts";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { claudePlugin, codexMarketplace, parkSkill, fetchSkills, openUrl, reveal, fetchJson, fetchSkill, inspectSkill, installSkill, linkSkill, removeSkill, toolup, toolupServers } from "./actions.ts";
import { inTauri, tauriHost } from "./host-tauri.ts";
import { columns, rows, type Tab, type View } from "./model.ts";
import { AGENT_MARKS } from "./agent-marks.ts";
import { getAgentUrl } from "./agent-links.ts";
import { COVERS } from "./covers.ts";
import { coolIcon } from "./icons.ts";
import { sample } from "./sample.ts";

interface Icon { svg?: string; path?: string; stroke?: string; color?: string; generic?: boolean }
interface Listed { id: string; name: string; chip?: string; by?: string; repo?: string; ds?: string; cats?: string[]; transport?: string; auth?: string; installs?: number; icon: Icon; sec: "mcp" | "skill" }
interface Pack { name: string; ds: string; ids: string[] }
const catalog = catalogJson as unknown as Catalog;
const raw = catalogJson as unknown as { agents: Listed[]; mcp: Listed[]; skills: Listed[]; categories: Record<string, string>; packs: Pack[] };
const cards: Listed[] = [...raw.mcp.map((x) => ({ ...x, sec: "mcp" as const })), ...raw.skills.map((x) => ({ ...x, sec: "skill" as const }))];
const listed = new Map(cards.map((x) => [x.id, x]));
const agents = new Map(raw.agents.map((a) => [a.id, a]));
const PAGE = 24;
// the same facts for every catalog item, read from its GitHub repo by scripts/details.mjs
interface More { kind: string; repo: string | null; path: string | null; stars: number; license: string; updated: string; homepage: string; about: string; examples: string[]; images: { src: string; alt: string }[] }
const more = detailsJson as unknown as Record<string, More>;

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
const fmt = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

const GLYPH: Record<string, string> = {
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
type Screen = "installed" | "catalog" | "settings";
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
const shop = { tab: "all" as Tab, cat: "", page: PAGE, detail: "", pack: -1, plugin: "", list: "" };   // the Catalog: the category and kind being browsed, the pack and the item whose page is open
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
let smpKey = saved("toolup.skillsmp-key");
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

const cols = () => (inv ? columns(inv) : []);
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
  if (on) return make("", `${h.name}: on. Removing a server from here is not built yet.`);
  if (i.catalogId) return make(`data-fill="${esc(i.catalogId)}" data-into="${h.id}"`, `${h.name}: off. Click to add it.`);
  return make("", `${h.name}: off. Servers you added yourself can't be copied to another agent yet.`);
}
function row(i: Item, cs: HarnessReport[]) {
  const known = i.catalogId ? listed.get(i.catalogId) : undefined;
  const sub = i.kind === "skill" ? known?.ds || i.description || "" : known?.ds || "Added by you";
  return `<li class="row k-${i.kind}"><button class="row-main" type="button" data-about="${esc(i.key)}" title="Details">${itemLogo(i)}<span class="row-t"><b>${esc(i.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span></button>
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
  const cs = cols(), r = rows(inv!, { ...view, q }), shown = r.all;
  const group = (title: string, items: Item[]) => (items.length ? `<section class="grp"><h2>${title}</h2><ul class="${rowsCls()}">${items.map((i) => row(i, cs)).join("")}</ul></section>` : "");
  const ql = q.trim().toLowerCase();
  const plugged = inv!.plugins.filter((p) => !ql || `${p.name} ${p.market}`.toLowerCase().includes(ql));
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
  const filter = `<nav class="catnav" aria-label="Show">${counts.filter(([k]) => k !== "all").map(([k, label, n]) => `<button class="chip" type="button" data-inst="${k}" aria-pressed="${instFilter === k}"${instFilter === k ? ` title="Clear ${label}"` : ""}>${k === "plugin" ? glyph("box") : k === "custom" ? glyph("plus") : glyph(k)}<span>${label}</span><small>${n}</small>${instFilter === k ? `<span class="chip-clear" aria-hidden="true">${glyph("x")}</span>` : ""}</button>`).join("")}<span class="catnav-end">${layToggle("installed")}</span></nav>`;
  const some = counts.find(([k]) => k === instFilter)![2] > 0;
  const filtered = !!q.trim() || instFilter !== "all";
  const empty = !inv!.items.length && !inv!.plugins.length
    ? emptyState("Nothing here yet", "Your agents have no skills or MCP servers. Add some from the catalog, paste an install command, or drop a .skill file on this window.", { add: true })
    : emptyState(q.trim() ? "Nothing matches" : "None of these yet", q.trim() ? "Nothing on this computer matches your search." : "You have nothing of this kind on this computer.", { clear: filtered ? "installed" : undefined, add: true });
  return `<div class="head"><div><h1>On this computer</h1><p>What your agents can do. Each switch turns it on or off for that agent. Paste any install command here to add it.</p></div>
      <button class="btn pri" type="button" data-screen="catalog">${glyph("plus")}Add…</button></div>
    ${inv!.items.length || inv!.plugins.length ? filter : ""}
    ${some ? lists : empty}`;
}

/* ---------- Catalog ---------- */
// Laid out like an app store: featured packs with a cover, shelves, categories, and a page for each item.
// A search looks in every source that is switched on (the Sources menu), Tool up!'s own list first.
const sourceOf = (id: string) => SOURCES.find((s) => s.id === id);
const CAT_HUE: Record<string, number> = { code: 262, test: 150, design: 330, docs: 32, media: 12, cloud: 205, work: 245, pay: 165, web: 190, ai: 285, biz: 20, util: 220 };
const cardBy = (x: Listed) => (x.sec === "skill" ? x.repo || "" : x.by || "");

function getButton(id: string) {
  const n = cols().length, have = haveIt(id).length;
  return have && have === n ? `<span class="get done" title="On for every agent">Installed</span>` : `<button class="get" type="button" data-get="${id}" title="${have ? `In ${have} of your ${plural(n, "agent")}` : "Install"}">Get</button>`;
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
const appMeta = (parts: string[]) => (parts.length ? `<span class="app-m">${parts.map((t) => `<span>${esc(t)}</span>`).join("")}</span>` : "");
function appRow(x: Listed) {
  // name, then who makes it and how many installed it, then what it does
  const who = x.sec === "skill" ? (x.repo || "").split("/")[0] : x.by || "";
  const meta = [who, x.sec === "skill" && x.installs ? `${fmt(x.installs)} installs` : ""].filter(Boolean);
  return `<div class="app k-${x.sec}"><button class="app-main" type="button" data-detail="${x.id}">${cardLogo(x)}<span class="app-t"><b>${esc(x.name)}</b>${appMeta(meta)}<small>${esc(x.ds || cardBy(x))}</small></span></button>${getButton(x.id)}</div>`;
}
/** A shelf's heading; when there is a full list of that kind (see LISTS), the heading itself is the link to it. */
const shelfHead = (title: string, list = "", n = 0) => `<div class="shelf-h"><h2>${list ? `<button class="shelf-link" type="button" data-list="${list}" title="See all ${n}">${esc(title)}${glyph("next")}</button>` : esc(title)}</h2></div>`;
const shelf = (title: string, sub: string, items: Listed[], list = "", n = 0) => (items.length ? `<section class="shelf">${shelfHead(title, list, n)}${sub ? `<p>${esc(sub)}</p>` : ""}<div class="${appsCls()}">${items.map(appRow).join("")}</div></section>` : "");
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
  const cats = Object.entries(raw.categories).map(([c, label]) => `<button type="button" role="menuitem" data-cat="${c}" aria-current="${cat === c}"><span>${esc(label)}</span><small>${cards.filter((x) => (x.cats || []).includes(c)).length}</small></button>`).join("");
  return `<nav class="catnav" aria-label="Browse the catalog">
    ${chip("skills", "skill", "Skills", raw.skills.length)}
    ${chip("mcp", "mcp", "MCP servers", raw.mcp.length)}
    ${enabled.has("plugins") ? chip("plugins", "box", "Plugins", market.state === "ok" ? market.plugins.length : "") : ""}
    ${chip("custom", "plus", "Custom", customItems().length)}
    <div class="catdd"><span class="chip-pair"><button class="chip" type="button" data-cats aria-haspopup="menu" aria-expanded="${catsOpen}" aria-pressed="${!!cat}">${glyph("all")}<span>${cat ? esc(catLabel(cat)) : "Categories"}</span>${glyph("chev")}</button>${cat ? `<button class="chip-x" type="button" data-cat="" title="Clear the category" aria-label="Clear the category">${glyph("x")}</button>` : ""}</span>
      ${catsOpen ? `<div class="catdd-list filt-cats" role="menu" aria-label="Categories"><button type="button" role="menuitem" data-cat="" aria-current="${!cat}"><span>All categories</span><small>${cards.length}</small></button>${cats}</div>` : ""}</div>
    <div class="catdd catnav-end"><button class="chip" type="button" data-srcs aria-haspopup="true" aria-expanded="${srcOpen}">${glyph("search")}<span>Sources</span><small>${enabled.size}</small>${glyph("chev")}</button>
      ${srcOpen ? `<div class="catdd-list filt" role="group" aria-label="Sources to look in">${sourceRows()}</div>` : ""}</div></nav>`;
}
/** What the list on screen is called: the kind, the category, or both ("Design & frontend · Skills"). */
const listTitle = () => [shop.cat ? catLabel(shop.cat) : "", LISTS[shop.list]?.title || ""].filter(Boolean).join(" · ");
function listView(kind: "skills" | "mcp") {
  const inCat = (x: Listed) => !shop.cat || (x.cats || []).includes(shop.cat);
  const all = (kind === "skills" ? [...raw.skills].sort((a, b) => (b.installs || 0) - (a.installs || 0) || a.name.localeCompare(b.name)).map((x) => listed.get(x.id)!) : cards.filter((x) => x.sec === "mcp").sort(byName)).filter(inCat);
  const vis = all.slice(0, shop.page), rest = all.length - vis.length;
  return `<div class="crumb-row">${crumbs(listTitle())}</div>${catNav()}<section class="shelf"><h1 class="page-t">${esc(listTitle())}</h1><p>${esc(shop.cat ? `The ${kind === "skills" ? "skills" : "servers"} on Tool up!'s list in this category.` : LISTS[kind].about)}</p>
    <div class="bar"><span class="count">${plural(all.length, kind === "skills" ? "skill" : "server")}</span>${layToggle()}</div>
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
    ${page ? `<div class="bar">${tabsHtml(shop.tab, { all: r.all.length, mcp: r.mcp.length, skill: r.skill.length })}${layToggle()}</div>` : ""}
    ${list.length ? `<div class="${appsCls()}">${list.map(customRow).join("")}</div>` : (page ? emptyState(all.length ? "None of this kind" : "Nothing of your own yet", all.length ? "Your own items are of the other kind." : "Paste an install command anywhere in this window, or drop a .skill file on it, and it shows up here.", { clear: "catalog" }) : `<p class="none">Nothing of yours matches.</p>`)}</section>`;
}

function discover() {
  if (!enabled.has("toolup")) return emptyState(`Search ${[...enabled].map((id) => sourceOf(id)?.name).filter(Boolean).join(", ") || "a catalog"}`, enabled.size ? "Type at least two letters in the search box above." : "Switch on a source in the Sources menu.");
  const feat = raw.packs.map((p, i) => {
    const c = COVERS[i % COVERS.length], items = p.ids.map((id) => listed.get(id)).filter((x): x is Listed => !!x);
    return `<article class="feat" style="background-image:url(${c.file})"><button class="feat-open" type="button" data-pack="${i}" aria-label="See what is in ${esc(p.name)}"></button><div class="feat-in">
      <span class="eyebrow">Starter pack</span><h2>${esc(p.name)}</h2><p>${esc(p.ds)}</p>
      <div class="feat-b"><span class="feat-logos">${items.slice(0, 6).map((x) => cardLogo(x, "mini")).join("")}</span><span class="feat-n">${plural(items.length, "item")}</span><button class="get light" type="button" data-getpack="${i}">Get all</button></div></div></article>`;
  }).join("");
  const top = [...raw.skills].sort((a, b) => (b.installs || 0) - (a.installs || 0)).slice(0, 9).map((x) => listed.get(x.id)!);
  const servers = raw.mcp.slice(0, 9).map((x) => listed.get(x.id)!);
  const cats = Object.entries(raw.categories).map(([c, label]) => {
    const n = cards.filter((x) => (x.cats || []).includes(c)).length, h = CAT_HUE[c] ?? 250;
    return `<button class="tile" type="button" data-cat="${c}" style="--h:${h}"><b>${esc(label)}</b><small>${n}</small></button>`;
  }).join("") + `<button class="tile" type="button" data-list="custom" style="--h:285"><b>Custom</b><small>${customItems().length}</small></button>`;
  const arrow = (dir: number, label: string, d: string) => `<button class="car-arrow ${dir < 0 ? "prev" : "next"}" type="button" data-car="${dir}" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg></button>`;
  return `<section class="shelf"><div class="carousel at-start"><div class="feats">${feat}</div>${arrow(-1, "Earlier packs", "m15 6-6 6 6 6")}${arrow(1, "More packs", "m9 6 6 6-6 6")}<div class="car-dots" role="group" aria-label="Starter packs"></div></div></section>
    ${shelf("Popular skills", "The skills people install most.", top, "skills", raw.skills.length)}
    ${shelf("Connect your tools", "MCP servers from the tools' own makers. You sign in the first time an agent uses one.", servers, "mcp", raw.mcp.length)}
    ${pluginShelf()}
    <section class="shelf"><h2>Browse by category</h2><div class="tiles">${cats}</div></section>`;
}

function results() {
  const term = q.trim(), ql = term.toLowerCase();
  const hit = (x: Listed) => (!shop.cat || (x.cats || []).includes(shop.cat)) && (!ql || [x.name, x.ds, x.by || x.repo, x.id, ...(x.cats || []).map((c) => raw.categories[c])].join(" ").toLowerCase().includes(ql));
  const all = enabled.has("toolup") ? cards.filter(hit).sort(byName) : [];
  const r: Record<Tab, Listed[]> = { all, mcp: all.filter((x) => x.sec === "mcp"), skill: all.filter((x) => x.sec === "skill") };
  const list = r[shop.tab], vis = list.slice(0, shop.page), rest = list.length - vis.length;
  const own = enabled.has("toolup") ? `<section class="shelf">${shop.cat && !term ? `<h1 class="page-t">${esc(raw.categories[shop.cat])}</h1>` : `<h2>Tool up!</h2>`}
      <div class="bar">${tabsHtml(shop.tab, { all: r.all.length, mcp: r.mcp.length, skill: r.skill.length })}${layToggle()}</div>
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
    <span class="base">${kindBadge(f.kind)}${f.install ? `<button class="get" type="button" data-found="${source}:${i}">Get</button>` : `<span class="blocked">${esc(f.blocked)}</span>`}</span></div>`;
}

/** The page for one Tool up! item. */
function detailView() {
  const x = listed.get(shop.detail)!, skill = x.sec === "skill", n = cols().length, have = haveIt(x.id);
  const d = more[x.id], repo = d?.repo || (skill ? x.repo : "") || "";
  const when = d?.updated ? new Date(d.updated).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—";
  const facts: [string, string][] = [
    ["Kind", skill ? "Skill" : "MCP server"],
    [skill ? "Installs" : "Sign-in", skill ? (x.installs ? fmt(x.installs) : "—") : x.auth === "oauth" ? "In your browser" : "None needed"],
    ["Stars", d?.stars ? fmt(d.stars) : "—"],
    ["Licence", d?.license || "—"],
    ["Updated", when],
    ["Category", (x.cats || []).map((c) => raw.categories[c]).join(", ") || "—"],
    ["On this computer", have.length ? `${have.length} of ${plural(n, "agent")}` : "Not installed"],
  ];
  const shots = d?.images?.length ? `<section class="shelf"><h2>Pictures</h2><div class="shots">${d.images.map((im, i) => `<button type="button" data-shot="${esc(im.src)}" aria-label="Enlarge picture ${i + 1}"><img src="${esc(im.src)}" alt="${esc(im.alt)}" loading="eager" decoding="async"></button>`).join("")}</div></section>` : "";
  const start = `<section class="shelf"><h2>Quick start</h2><p>${skill ? `Once it is on, ask your agent in your own words. It reaches for the skill when it fits, or you can name it: “Use ${esc(x.name)} to …”.` : `Once it is added, ask your agent for something that needs ${esc(x.name)}.${x.auth === "oauth" ? " The first time, a sign-in page opens in your browser." : ""}`}</p>
    ${d?.examples?.length ? `<ul class="tries">${d.examples.map((e) => `<li class="say"><span>${esc(e)}</span><button class="copy" type="button" data-copy="${esc(e)}" title="Copy" aria-label="Copy">${glyph("copy")}</button></li>`).join("")}</ul><p class="src-note">Examples from ${repo ? esc(repo) : "its page"} on GitHub.</p>` : ""}</section>`;
  const packs = raw.packs.filter((p) => p.ids.includes(x.id)).map((p) => p.name);
  const family = cards.filter((y) => y.id !== x.id && y.sec === x.sec && cardBy(y) && cardBy(y) === cardBy(x)).sort(byName).slice(0, 9);
  const url = !skill ? (raw.mcp.find((m) => m.id === x.id) as unknown as { url?: string })?.url : "";
  const doc = detailDoc?.id === x.id ? detailDoc : null;
  const extra = skill ? `<section class="shelf"><h2>What it tells your agents</h2>
      ${!doc ? `<p>A skill is a page of instructions. You can read this one before you install it.</p><button class="btn" type="button" data-readmore="${x.id}">Read the instructions</button>`
        : doc.state === "loading" ? `<p class="none">Fetching it from ${esc(x.repo)}…</p>`
        : doc.state === "error" ? `<p class="note bad">${glyph("warn")}<span>${esc(doc.text)}</span></p>`
        : `<div class="doc">${esc(doc.text)}</div>`}</section>`
    : `<section class="shelf"><h2>How it connects</h2><p>${url ? `Your agents talk to <b>${esc(new URL(url).host)}</b>.` : ""} ${x.auth === "oauth" ? "The first time an agent uses it, a sign-in page opens in your browser. Tool up! never sees your password or any key." : "No account or key is needed."}</p></section>`;
  return `${crumbs(x.name)}
    <div class="hero k-${x.sec}">${cardLogo(x, "big")}<div class="hero-t"><h1>${esc(x.name)}</h1><p>${esc(cardBy(x))}</p><span class="hero-b">${getButton(x.id)}${repo ? `<button class="btn small" type="button" data-url="${esc(repoUrl(repo, d?.path || ""))}">View on GitHub</button>` : ""}</span></div></div>
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    ${shots}
    <section class="shelf"><h2>About</h2><p class="about">${esc(x.ds || "")}</p>${d?.about && clean(d.about) !== clean(x.ds || "") ? `<p>${esc(d.about)}</p>` : ""}${packs.length ? `<p>Part of the ${esc(packs.join(", "))} pack${packs.length > 1 ? "s" : ""}.</p>` : ""}</section>
    ${start}
    ${extra}
    ${shelf(`More from ${cardBy(x)}`, "", family)}`;
}

/** Where you are in the Catalog, each step a way back: Discover › a pack or a category › the item. */
function crumbs(here: string) {
  const trail: [string, string][] = [["Discover", "home"]];
  if (shop.plugin && shop.list === "plugins") trail.push(["Plugins", "list"]);
  else if (shop.detail && shop.pack < 0 && !q.trim() && (shop.list === "skills" || shop.list === "mcp")) trail.push([listTitle(), "list"]);
  else if (shop.plugin && q.trim()) trail.push(["Search", "list"]);
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
  return `${crumbs(p.name)}
    <div class="pack-hero" style="background-image:url(${c.file})"><div class="feat-in">
      <span class="eyebrow">Starter pack</span><h1>${esc(p.name)}</h1><p>${esc(p.ds)}</p>
      <div class="feat-b"><span class="feat-n">${plural(items.length, "item")}${missing ? "" : " · all installed"}</span>${missing ? `<button class="get light" type="button" data-getpack="${shop.pack}">Get all ${items.length}</button>` : ""}</div></div></div>
    ${shelf("Skills in this pack", "", items.filter((x) => x.sec === "skill"))}
    ${shelf("MCP servers in this pack", "", items.filter((x) => x.sec === "mcp"))}`;
}

function catalogView() {
  if (shop.detail && listed.has(shop.detail)) return detailView();
  if (shop.pack >= 0 && raw.packs[shop.pack]) return packView();
  if (enabled.has("plugins")) loadMarket();
  const open = shop.plugin && market.plugins.find((p) => p.name === shop.plugin);
  if (open) return pluginView(open);
  if (shop.list === "plugins" && !q.trim()) return `<div class="crumb-row">${crumbs("Plugins")}${sourcesMenu()}</div>${catNav()}<section class="shelf"><h1 class="page-t">Plugins</h1><p>${esc(MARKET.title)}, from ${esc(MARKET.by)} and its partners. Claude Code installs a plugin whole; your other agents get its skills.</p><div class="bar"><span></span>${layToggle()}</div><div class="${appsCls()}">${market.plugins.map(pluginRow).join("")}</div></section>`;
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
const pluginGet = (p: Plugin) => (pluginAgents().length && pluginAgents().every((a) => pluginIn(p).includes(a)) ? `<span class="get done" title="Installed in ${esc(pluginIn(p).map(chipOf).join(", "))}">Installed</span>` : `<button class="get" type="button" data-getplugin="${esc(p.name)}">Get</button>`);
const pluginRow = (p: Plugin) => `<div class="app"><button class="app-main" type="button" data-plugin="${esc(p.name)}">${pluginIcon(p)}<span class="app-t"><b>${esc(p.title)}</b>${appMeta([p.own ? MARKET.by : p.repo?.split("/")[0] || "A partner", p.description ? p.category : ""].filter(Boolean))}<small>${esc(p.description || p.category)}</small></span></button>${pluginGet(p)}</div>`;
const pluginHits = (ql: string) => market.plugins.filter((p) => `${p.title} ${p.name} ${p.description} ${p.category}`.toLowerCase().includes(ql));
function pluginShelf() {
  if (!enabled.has("plugins")) return "";
  const body = market.state === "ok" ? `<div class="${appsCls()}">${market.plugins.slice(0, 9).map(pluginRow).join("")}</div>`
    : market.state === "error" ? `<p class="note bad">${glyph("warn")}<span>The plugin list could not be loaded. ${esc(market.error)}</span></p>` : `<p class="none">Loading plugins…</p>`;
  return `<section class="shelf">${shelfHead("Plugins", market.state === "ok" ? "plugins" : "", market.plugins.length)}<p>Bundles of skills and connectors for a kind of work, from ${esc(MARKET.by)} and its partners.</p>${body}</section>`;
}
function pluginView(p: Plugin) {
  const skills = skillsOf(p), conns = connectorsOf(p), owner = p.own ? MARKET.by : p.repo?.split("/")[0] || "A partner";
  const facts: [string, string][] = [["Kind", "Plugin"], ["From", owner], ["Skills", skills === null ? "…" : String(skills.length)], ["Connectors", conns === null ? "…" : String(conns.length)], ["On this computer", pluginHere(p) ? `In ${pluginIn(p).map(chipOf).join(", ")}` : "Not installed"]];
  const chips = (items: string[]) => `<div class="chips2">${items.map((t) => `<span>${esc(t)}</span>`).join("")}</div>`;
  return `${crumbs(p.title)}
    <div class="hero">${pluginIcon(p, "big")}<div class="hero-t"><h1>${esc(p.title)}</h1><p>${esc(owner)}${p.category ? ` · ${esc(p.category)}` : ""}</p><span class="hero-b">${pluginGet(p)}${p.repo ? `<button class="btn small" type="button" data-url="${esc(repoUrl(p.repo, p.path))}">View on GitHub</button>` : ""}</span></div></div>
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    <section class="shelf"><h2>About</h2><p class="about">${esc(p.description || "No description.")}</p>
      <p>Claude Code installs it as a plugin, with everything in it. Codex has plugins too: Tool up! adds this plugin to Codex's list, and you finish the install inside Codex. Agents without plugins get its skills; its connectors are not added to them.</p></section>
    <section class="shelf"><h2>Skills</h2>${skills === null ? `<p class="none">Looking in ${esc(p.repo)}…</p>` : skills.length ? chips(skills.map((s) => s.split("/").pop()!)) : `<p class="none">${p.repo ? "This plugin has no skills of its own." : "Its files are not on GitHub, so its skills can't be listed here."}</p>`}</section>
    ${conns && conns.length ? `<section class="shelf"><h2>Connectors</h2><p>The services it can reach. Each one asks you to sign in the first time.</p>${chips(conns.map((c) => (c.host ? `${c.name} · ${c.host}` : c.name)))}</section>` : ""}`;
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
      try { next = { state: "ok", items: s.parse(JSON.parse(await fetchJson(s.url(term), s.id === "skillsmp" ? smpKey : ""))), error: "" }; }
      catch (e) { next = { state: "error", items: [], error: said(e) }; }
      if (seq === searchSeq) { ext[s.id] = next; paint(); }
    })();
  }, 350);
}

/* ---------- look: light or dark, and the accent colour (Settings) ---------- */
const THEMES: [string, string][] = [["system", "Match the system"], ["light", "Light"], ["dark", "Dark"]];
// the first is Tool up!'s own violet, tuned by hand; the others are worked out from one colour each (see style.css)
const ACCENTS: [string, string, string][] = [["violet", "Violet", "#7d22d8"], ["blue", "Blue", "#2563eb"], ["teal", "Teal", "#0d8f80"], ["green", "Green", "#2f8f3a"], ["orange", "Orange", "#d9670f"], ["pink", "Pink", "#d6337f"], ["graphite", "Graphite", "#5b5f6b"]];
let theme = THEMES.some(([t]) => t === saved("toolup.theme")) ? saved("toolup.theme") : "system";
let accent = ACCENTS.some(([a]) => a === saved("toolup.accent")) ? saved("toolup.accent") : "violet";
const DARK = "(prefers-color-scheme: dark)", darkRules = new Set<CSSMediaRule>();
function applyLook() {
  const root = document.documentElement;
  // the dark styles are written as "when the system is dark" rules. A fixed choice switches those rules always on
  // (Dark) or always off (Light); "Match the system" puts them back as they were.
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

function settingsView() {
  return `<div class="head"><div><h1>Settings</h1></div></div>
    <h3>Appearance</h3>
    <p class="hint">How the window looks. Both are kept on this computer.</p>
    <ul class="sets">
      <li class="look"><span class="set-t"><b>Theme</b><small>Light, dark, or whatever your computer is set to.</small></span>
        <span class="seg" role="group" aria-label="Theme">${THEMES.map(([t, label]) => `<button type="button" data-theme-set="${t}" aria-pressed="${theme === t}">${label}</button>`).join("")}</span></li>
      <li class="look"><span class="set-t"><b>Accent colour</b><small>The colour of buttons, links and what is switched on.</small></span>
        <span class="swatches" role="group" aria-label="Accent colour">${ACCENTS.map(([a, label, hex]) => `<button type="button" data-accent-set="${a}" aria-pressed="${accent === a}" title="${label}" aria-label="${label}" style="--c:${hex}"></button>`).join("")}</span></li>
    </ul>
    <h3>Agents</h3>
    <p class="hint">The agents Tool up! looks for on this computer.</p>
    <ul class="sets">${inv!.harnesses.map((h) => { const a = agents.get(h.id); return `<li class="agent-row">${a ? logo(a.icon, "mini") : ""}<b>${esc(h.name)}</b>${h.present ? `<span class="state found">Installed</span>` : `<span class="state">Not installed</span>${getAgentUrl(h.id) ? `<button class="get" type="button" data-getagent="${h.id}" title="Opens ${esc(h.name)}'s download page in your browser">Get</button>` : ""}`}</li>`; }).join("")}</ul>
    <h3>New skills</h3>
    <p class="hint">How a skill is added when you install one. You can still change it for a single install.</p>
    <ul class="sets">${SKILL_MODES.map(([v, label, hint]) => `<li><label class="sw"><input type="radio" name="skill-mode" value="${v}" ${skillMode === v ? "checked" : ""}><span class="set-t"><b>${esc(label)}</b><small>${esc(hint)}</small></span></label></li>`).join("")}</ul>
    <h3>Catalog sources</h3>
    <p class="hint">Switch sources on and off from the Sources menu in the Catalog. Not available yet: ${NOT_YET.map((n) => `${esc(n.name)} (${esc(n.why)})`).join(", ")}.</p>
    <ul class="sets"><li><label class="key"><span>SkillsMP API key (optional)</span><input id="smp-key" type="password" value="${esc(smpKey)}" placeholder="sk_live_…" autocomplete="off" spellcheck="false"><small>${esc(sourceOf("skillsmp")!.keyNote || "")} The key is kept on this computer and sent only to SkillsMP.</small></label></li></ul>
    <h3>Photo credits</h3>
    <p class="hint">The cover photos are in the public domain (CC0), from Wikimedia Commons.</p>
    <ul class="sets credits">${COVERS.map((c) => `<li><b>${esc(c.title.replace(/\.[a-z]+$/i, ""))}</b><small>${esc(c.artist || "Unknown")} · ${esc(c.license)}</small></li>`).join("")}</ul>`;
}

/* ---------- the tray (your picks) and the install sheet ---------- */
function tray() {
  if (screen !== "catalog" || !picked.size || !inv) return "";
  const cs = cols(), items = [...picked].map((id) => listed.get(id)!).sort(byName);
  const nm = items.filter((x) => x.sec === "mcp").length, ns = items.length - nm;
  const targets = cs.map((h) => { const a = agents.get(h.id); return `<button class="agent" type="button" data-agent="${h.id}" aria-pressed="${into!.has(h.id)}" title="${esc(h.name)}">${a ? logo(a.icon, "tiny") : ""}<span>${esc(a?.chip || h.name)}</span></button>`; }).join("");
  return `<div class="tray"><div class="tray-in">
    <div class="tray-h"><b>${plural(items.length, "pick")}</b><span>${plural(nm, "MCP")} · ${plural(ns, "skill")}</span><button class="link" type="button" data-clear>Clear</button></div>
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
    ? `<li class="s-${st.state} pickable" role="checkbox" tabindex="0" aria-checked="${!!st.picked}" data-step-pick="${esc(st.pick)}">${st.logo}<span class="st-t"><b>${esc(st.title)}</b>${st.detail ? `<small>${esc(st.detail)}</small>` : ""}</span><span class="st-box" aria-hidden="true">${st.picked ? glyph("check") : ""}</span></li>`
    : `<li class="s-${st.state}">${st.logo}<span class="st-t"><b>${esc(st.title)}</b>${st.detail ? `<small>${esc(st.detail)}</small>` : ""}</span><span class="st-m">${mark[st.state]}</span></li>`;
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
    <div class="sheet-b">${choice}${s.link && !busy ? `<button class="link" type="button" data-url="${esc(s.link.url)}">${esc(s.link.label)}</button>` : ""}<span class="grow"></span>${buttons}</div></div></div>`;
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
    const x = listed.get(id)!, t = order(), have = haveIt(id);
    const missing = t.filter((a) => !have.includes(a)), has = t.filter((a) => have.includes(a));
    const base = { logo: cardLogo(x), title: x.name };
    if (!after) return { ...base, detail: missing.length ? `Add to ${names(missing)}${has.length ? ` · already in ${names(has)}` : ""}` : `Already in ${names(has)}`, state: missing.length ? "todo" : "skip" };
    if (!missing.length) return { ...base, detail: `In ${names(t)}`, state: "done" };
    return { ...base, detail: ran ? `The installer finished, but it does not show up in ${names(missing)}` : `Not added to ${names(missing)}`, state: "fail" };
  });
  return openSheet({
    title: `Install ${plural(ids.length, "item")}?`, sub: fromTray ? "" : `Into ${names(order())}`, fromTray, targets: fromTray ? targets : null,
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
      if (servers.length) { const r = await toolup(servers, to.length === cols().length ? [] : to, false); s.log = r.output; ok = r.code === 0; }
      for (const id of skills) {
        try { await addCatalogSkill(id, to); }
        catch (e) { ok = false; s.log += `\n${listed.get(id)!.name}: ${said(e)}`; }
      }
      await load(true);
      s.steps = steps(true, ok);
      return ok && s.steps.every((st) => st.state === "done");
    },
  });
}

/** A remote MCP server from another catalog, into the agents ticked. */
function openInstallServer(f: Found, id: string, url: string) {
  const targets = new Set(into!), host = new URL(url).host, key = `url:${bareUrl(url)?.url}`;
  const logoHtml = coolIcon(f.name, f.description, undefined, "cat-mcp", "");
  const order = () => cols().map((h) => h.id).filter((a) => targets.has(a));
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
  let name = "", shown = "", path = "", origin: { repo: string; path: string } | null = null;
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
  const wanted = () => paths!.filter((p) => !left.has(p));
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
      s.steps = paths.map((p): Step => ({ logo: coolIcon(nameOf(p), "", undefined, "book-open", "round"), title: nameOf(p), detail: have(p) ? "You already have one with this name; this replaces it" : "", state: left.has(p) ? "skip" : "todo", pick: p, picked: !left.has(p) }));
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
        // asking GitHub for each skill's version is kept for small sets; a big one is installed untracked
        const meta = got.length <= 5 ? await metaFor(repo, g.path) : JSON.stringify({ repo, path: g.path, sha: "", installedAt: new Date().toISOString() });
        if (link) await installSkill(g.staged, [store], dirs, meta); else await installSkill(g.staged, dirs, [], meta);
      }
      const done = new Set(got.map((g) => nameOf(g.path)));
      s.steps = want.map((p): Step => ({ logo: coolIcon(nameOf(p), "", undefined, "book-open", "round"), title: nameOf(p), detail: done.has(nameOf(p)) ? "" : "Could not be fetched", state: done.has(nameOf(p)) ? "done" : "fail" }));
      s.note = got.length < want.length ? "" : `Your agents pick ${want.length === 1 ? "it" : "them"} up the next time they start.`;
      await load(true);
      return got.length === want.length;
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
      if (item) { await work(item); await load(true); }
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
    o ? tool(`data-url="${esc(repoUrl(o.repo, o.path || ""))}"`, "link", "GitHub") : "",
    o ? tool(`data-version="${k}"`, "refresh", "Check version") : "",
    skill && off > 1 ? tool(`data-enable-all="${k}"`, "plus", "On for all") : "",
  ].join("");
  const tabs: [string, string][] = skill ? [["about", "Overview"], ["doc", "Instructions"], ["where", "Location"]] : [["about", "Overview"], ["where", "Location"]];
  const want = detail.tab, tab = tabs.some(([t]) => t === want) ? want : "about";
  const pane = tab === "doc"
    ? (detail.doc === null ? `<p class="none">Reading it…</p>` : detail.doc ? `<div class="doc">${esc(detail.doc)}</div>` : `<p class="none">Its instructions could not be read.</p>`)
    : tab === "where" ? `<div class="doc where">${esc(where.join("\n"))}</div>`
    : `${about ? `<p class="about">${esc(about)}</p>` : ""}
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
      const o = item.origin!, folder = key.slice("skill:".length), parent = (p: string) => p.slice(0, p.lastIndexOf("/"));
      const dirs = item.store ? [parent(item.store)] : [...new Set(Object.values(item.in).filter((p) => !p.linked).map((p) => parent(p.source)))];
      if (!dirs.length) throw new Error("Tool up! could not find the copy to update.");
      const got = await fetchSkill(o.repo, folder, o.path || "");
      await installSkill(got.staged, dirs, [], await metaFor(o.repo, got.path));
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
function menuHtml() {
  const item = menu && inv?.items.find((i) => i.key === menu!.key);
  if (!menu || !item) return "";
  const off = cols().filter((h) => !item.in[h.id]), skill = item.kind === "skill";
  return `<div class="menu" role="menu" aria-label="More for ${esc(item.name)}" style="top:${menu.y}px;right:${menu.x}px">
    <button type="button" role="menuitem" data-about="${esc(item.key)}">${glyph("info")}Details</button>
    ${placeOf(item) ? `<button type="button" role="menuitem" data-reveal="${esc(item.key)}">${glyph("folder")}Show in Finder</button>` : ""}
    ${item.origin ? `<button type="button" role="menuitem" data-version="${esc(item.key)}">${glyph("refresh")}Check for a newer version</button><button type="button" role="menuitem" data-url="${esc(repoUrl(item.origin.repo, item.origin.path || ""))}">${glyph("link")}View on GitHub</button>` : ""}
    ${skill && off.length > 1 ? `<button type="button" role="menuitem" data-enable-all="${esc(item.key)}">${glyph("plus")}Turn on for every agent</button>` : ""}
    ${skill ? `<button class="bad" type="button" role="menuitem" data-delskill="${esc(item.key)}">${glyph("trash")}Delete from this computer…</button>` : ""}</div>`;
}

/** Show or hide the row menu without redrawing the list under it. */
function paintMenu() {
  document.querySelector("#menu")!.innerHTML = menuHtml();
  document.querySelectorAll<HTMLElement>("[data-menu]").forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.menu === menu?.key)));
}

/* ---------- frame ---------- */
function body() {
  if (failed) return `<p class="note bad">${glyph("warn")}<span>${esc(failed)}</span></p>`;
  if (!inv) return `<p class="boot">Looking at your agents…</p>`;
  const notes = [
    demo ? `<p class="note">${glyph("warn")}<span>Sample data. Open the desktop app to see your own machine.</span></p>` : "",
    ...inv.harnesses.flatMap((h) => h.problems.map((p) => `<p class="note bad">${glyph("warn")}<span><b>${esc(h.name)}</b> ${esc(p)}</span></p>`)),
  ].join("");
  if (!cols().length && screen === "installed") return `${notes}${emptyState("No agents found on this machine", `Tool up! looks for ${inv.harnesses.map((h) => h.name).join(", ")}. Install one, then scan again.`)}`;
  return notes + (screen === "installed" ? installed() : screen === "catalog" ? catalogView() : settingsView());
}
function shell() {
  app.innerHTML = `<header data-tauri-drag-region>
    <div class="views" role="group" aria-label="View"><button type="button" data-screen="installed">Installed</button><button type="button" data-screen="catalog">Catalog</button></div>
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
window.addEventListener("resize", wireCarousel);
function paint() {
  document.querySelectorAll<HTMLElement>(".views [data-screen]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.screen === screen)));
  document.querySelector<HTMLInputElement>("#q")!.placeholder = screen === "installed" ? "Search what's installed…" : "Search skills and MCP servers…";
  document.querySelector("#body")!.innerHTML = body();
  document.querySelector("#tray")!.innerHTML = tray();
  document.querySelector("#sheet")!.innerHTML = sheetHtml();
  document.querySelector("#detail")!.innerHTML = detailHtml() + (shotOpen ? `<div class="lightbox" role="dialog" aria-modal="true" aria-label="Picture"><button class="lightbox-x" type="button" aria-label="Close picture" title="Close (Esc)">${glyph("x")}</button><img src="${esc(shotOpen)}" alt=""></div>` : "");
  paintMenu();
  wireCarousel();
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
  if (menu) { menu = null; paintMenu(); }   // any other click closes it (and may go on to pick an item from it)
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
  if (hit("[data-clear-inst]")) { instFilter = "all"; q = ""; document.querySelector<HTMLInputElement>("#q")!.value = ""; return paint(); }
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
  if ((el = hit("[data-screen]"))) { screen = el.dataset.screen as Screen; shop.detail = ""; shop.pack = -1; shop.plugin = ""; shop.list = ""; document.querySelector("#body")!.scrollTop = 0; paint(); return queueSearch(); }
  if (hit("[data-cats]")) { catsOpen = !catsOpen; srcOpen = false; return paint(); }
  if (hit("[data-srcs]")) { srcOpen = !srcOpen; catsOpen = false; return paint(); }
  // each menu closes on a click anywhere else; Categories also when one is picked, Sources stays open while boxes are ticked
  if (catsOpen) { catsOpen = false; if (!hit("[data-cat]")) paint(); }
  if (srcOpen && !hit(".catdd-list")) { srcOpen = false; paint(); }
  if ((el = hit("[data-detail]"))) { shop.detail = el.dataset.detail!; document.querySelector("#body")!.scrollTop = 0; return paint(); }
  if ((el = hit("[data-crumb]"))) {
    shop.detail = ""; shop.plugin = "";
    if (el.dataset.crumb === "home") { shop.pack = -1; shop.cat = ""; shop.list = ""; q = ""; document.querySelector<HTMLInputElement>("#q")!.value = ""; ext = {}; }
    document.querySelector("#body")!.scrollTop = 0;
    return paint();
  }
  if ((el = hit("[data-plugin]"))) { shop.plugin = el.dataset.plugin!; document.querySelector("#body")!.scrollTop = 0; return paint(); }
  if ((el = hit("[data-list]"))) { const k = el.dataset.list!, on = !q.trim() && shop.list === k && el.classList.contains("chip");
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
  if ((el = hit("[data-cat]"))) { shop.cat = el.dataset.cat!; if (shop.cat && (shop.list === "plugins" || shop.list === "custom")) shop.list = ""; q = ""; document.querySelector<HTMLInputElement>("#q")!.value = ""; shop.pack = -1; shop.page = PAGE; document.querySelector("#body")!.scrollTop = 0; return paint(); }
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
app.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "q") { q = t.value; shop.page = PAGE; shop.detail = ""; shop.pack = -1; shop.plugin = ""; queueSearch(); paint(); }
  if (t.dataset.catalog) {
    t.checked ? enabled.add(t.dataset.catalog) : enabled.delete(t.dataset.catalog);
    save("toolup.sources.v2", [...enabled].join(",") || "none"); paint(); queueSearch();
  }
  if (t.id === "smp-key") { smpKey = t.value.trim(); save("toolup.skillsmp-key", smpKey); }
  if (t.name === "skill-mode") { skillMode = t.value; save("toolup.skill-mode", skillMode); }
  if (t.name === "choice" && sheet?.choice && sheet.phase === "ready") { sheet.choice.value = t.value; const s = sheet; s.prepare(s).then(() => { if (sheet === s) paint(); }); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu) { menu = null; paintMenu(); } });
// a step's tick box answers to Space and Enter, like any checkbox
document.addEventListener("keydown", (e) => {
  const el = (e.target as HTMLElement).closest?.<HTMLElement>("[data-step-pick]");
  if (el && (e.key === " " || e.key === "Enter") && sheet?.pick && sheet.phase === "ready") { e.preventDefault(); void pickStep(el); }
});
// scrolling the list closes the menu, except for a scroll still settling when it was opened (trackpad momentum)
document.querySelector("#body")!.addEventListener("scroll", () => { if (menu && performance.now() - menuAt > 400) { menu = null; paintMenu(); } });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (shotOpen) { shotOpen = ""; return paint(); }
  if (sheet) { if (sheet.phase !== "preview" && sheet.phase !== "running") { sheet = null; paint(); } }
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
load();
