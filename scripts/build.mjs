// Builds the public files from the curated catalog:
//   catalog/agents.json, mcp.json, skills.json, packs.json   what we offer (nothing is pulled in automatically)
//   catalog/installs.json                                    skills.sh install counts (npm run installs refreshes them)
// Writes public/catalog.json (for the page), public/catalog.tsv and public/install.sh (for the installer).
import { readFile, writeFile } from "node:fs/promises";
import * as simple from "simple-icons";
import lucide from "./lucide.mjs";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, root), "utf8"));

const SITE_URL = (process.env.SITE_URL || "https://toolup.sh").replace(/\/$/, "");
const SITE_HOST = new URL(SITE_URL).host;

const tsv = (v) => {
  const s = v == null || v === "" ? "-" : Array.isArray(v) ? v.join("|") || "-" : String(v);
  if (/[\t\n]/.test(s)) throw new Error(`tab or newline in catalog value: ${JSON.stringify(s)}`);
  return s;
};

// "lobe:claude-color" is an AI provider's logo from Lobe Icons (MIT); "si:github" a brand logo from Simple Icons (CC0);
// "lu:globe#2ead33" a Lucide glyph on that colour, for things neither carries (VS Code is not a provider, for one).
// All resolve to what the page needs to draw them inline.
function icon(spec, where) {
  const [, kind, name, hex] = /^(si|lu|lobe):([a-z0-9-]+)(?:#([0-9a-fA-F]{6}))?$/.exec(spec || "") || [];
  if (kind === "lobe") {
    let svg;
    try { svg = readFileSync(new URL(`node_modules/@lobehub/icons-static-svg/icons/${name}.svg`, root), "utf8"); }
    catch { throw new Error(`${where}: no Lobe Icons logo "${name}"`); }
    const [, attrs, inner] = /<svg([^>]*)>([\s\S]*)<\/svg>/.exec(svg);
    const keep = ["fill", "fill-rule", "clip-rule"].map((a) => new RegExp(`\\s${a}="([^"]*)"`).exec(attrs)).filter(Boolean).map((m) => m[0]).join("");
    return { svg: `<g${keep}>${inner.replace(/<title>[\s\S]*?<\/title>/, "")}</g>` };
  }
  if (kind === "si") {
    const i = simple[`si${name[0].toUpperCase()}${name.slice(1)}`];
    if (!i) throw new Error(`${where}: no Simple Icons logo "${name}"`);
    return { path: i.path, color: `#${i.hex}` };
  }
  if (kind === "lu") {
    if (!lucide[name]) throw new Error(`${where}: no Lucide icon "${name}"`);
    if (!hex) throw new Error(`${where}: a Lucide icon needs a colour, like lu:${name}#0b8a6b`);
    return { stroke: lucide[name], color: `#${hex}` };
  }
  throw new Error(`${where}: bad icon "${spec}"`);
}

export async function build() {
  const agents = await read("catalog/agents.json");
  const mcp = await read("catalog/mcp.json");
  const { owners, repos, skills } = await read("catalog/skills.json");
  const packs = await read("catalog/packs.json");
  // one list of categories for servers and skills alike; every item sits in at least one, and may sit in several
  const categories = await read("catalog/categories.json");
  for (const [kind, list] of [["server", mcp], ["skill", skills]]) {
    for (const x of list) {
      if (!Array.isArray(x.cats) || !x.cats.length) throw new Error(`${kind} ${x.id}: needs at least one category in "cats"`);
      for (const c of x.cats) if (!categories[c]) throw new Error(`${kind} ${x.id}: unknown category "${c}" (see catalog/categories.json)`);
    }
  }
  let installs = {};
  try { installs = await read("catalog/installs.json"); } catch {}

  // A skill or repo takes its owner's logo. Owners without a brand logo of their own fall back to the GitHub mark,
  // flagged `generic` so the page can leave it out rather than repeat the same mark on every row.
  const ownerIcon = (explicit, repo, where) => {
    const spec = explicit || owners[repo.split("/")[0]];
    return { ...icon(spec || owners._default, where), ...(spec ? {} : { generic: true }) };
  };
  const skillsOut = skills.map((s) => ({ ...s, icon: ownerIcon(s.icon, s.repo, s.id), installs: installs[`${s.repo}/${s.id}`] ?? null }));
  const agentsOut = agents.map((a) => ({ ...a, icon: icon(a.icon, a.id) }));
  const mcpOut = mcp.map((m) => ({ ...m, icon: icon(m.icon, m.id) }));
  const reposOut = repos.map((r) => ({ ...r, icon: ownerIcon(r.icon, r.repo, r.repo) }));

  const rows = [
    ...agents.map((a) => ["agent", a.id, a.name, a.bin, a.paths, a.method, a.skills, a.skillsDir, a.config, a.serversKey, a.urlKey]),
    ...mcp.map((m) => ["mcp", m.id, m.name, m.transport, m.transport === "http" ? m.url : m.cmd, m.docker, m.needs]),
    ...skills.map((s) => ["skill", s.id, s.repo]),
  ].map((r) => r.map(tsv).join("\t"));

  const catalog = { site: { url: SITE_URL, host: SITE_HOST }, agents: agentsOut, mcp: mcpOut, categories, repos: reposOut, skills: skillsOut, packs };
  await writeFile(new URL("public/catalog.json", root), JSON.stringify(catalog));
  await writeFile(new URL("public/catalog.tsv", root), rows.join("\n") + "\n");

  const sh = (await readFile(new URL("src/install.sh", root), "utf8"))
    .replaceAll("__SITE_URL__", SITE_URL).replaceAll("__SITE_HOST__", SITE_HOST);
  await writeFile(new URL("public/install.sh", root), sh);
  console.log(`built: ${agents.length} agents, ${mcp.length} servers, ${skills.length} skills, ${packs.length} packs → public/ (${SITE_URL})`);
}

if (import.meta.url === `file://${process.argv[1]}`) await build();
