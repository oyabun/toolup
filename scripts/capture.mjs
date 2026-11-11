// Captures what the catalog needs to know about one skill, MCP server or plugin, straight from its source:
//
//   npm run capture -- skill  <owner/repo | GitHub address> [skill …]     every skill in the repo, or the ones named
//   npm run capture -- mcp    <https address of the server> [--name "Title"]
//   npm run capture -- plugin <owner/repo of the marketplace> [plugin …]  every plugin it lists, or the ones named
//
//   --ref <commit>   read the repo at that commit instead of its latest one
//   --out <file>     write the JSON there instead of printing it
//   --no-live        leave out the numbers that change by the day (stars, last update)
//
// For each item it prints one record with the same fields, in the same order:
//   kind, id, title, by, description (one line), about (in full), logo, usage (things to say to an agent),
//   install (the command), repo, path, commit, license, homepage, live, and `entry`: a line ready for
//   catalog/skills.json or catalog/mcp.json (pick its categories by hand: that is a judgement, not a fact).
//
// It is deterministic: every field comes from a fixed rule over the files at one commit (recorded as `commit`),
// never from a model or a guess. Run it again with --ref <that commit> --no-live and the output is byte for byte
// the same. What can't be read is left empty, not made up.
import { readFile, readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import * as simple from "simple-icons";
import { UA, clean, download, examples, exists, findSkill, frontMatter, repoFacts, text } from "./extract.mjs";

const root = new URL("..", import.meta.url).pathname;
const json = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));
const { owners, skills: listedSkills } = await json("catalog/skills.json");
const listedServers = await json("catalog/mcp.json");

/* ---------- the rules ---------- */

const ACRONYMS = new Set(["ai", "api", "aws", "ci", "cd", "cli", "css", "csv", "db", "gcp", "html", "http", "id", "io", "js", "json", "llm", "mcp", "ml", "pdf", "pr", "qa", "sdk", "seo", "sql", "ssh", "tdd", "ts", "ui", "ux", "url", "xml"]);
/** "ui-ux-pro-max" → "UI UX Pro Max": words split on dashes, underscores and dots; known acronyms in capitals. */
const titleOf = (id) => id.split(/[-_.\s]+/).filter(Boolean).map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
/** A document's own title: its first top-level heading, when that is a short plain name. */
function heading(md) {
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(md.replace(/(```|~~~)[\s\S]*?\1/g, ""));
  const t = m ? clean(m[1].replace(/[*_`]|\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s[-–—:|]\s.*$/, "")) : "";
  return t.length >= 2 && t.length <= 40 && !/[<>{}]/.test(t) ? t : "";
}
/** One line from a full description: its first sentence, without the "use when…" that follows; past 110 characters it is cut between words and ends in "…". */
function oneLine(about) {
  let s = clean(about).replace(/^(?:this skill|use this skill to|a skill (?:that|to|for)|skill (?:that|to|for))\s+/i, "");
  s = s.split(/(?<=[.!?])\s+(?=[A-Z"“(])/)[0].split(/[.;]?\s+(?:Use (?:this|when|it|for)|Trigger(?:s|ed)? (?:on|when|for)|Not for)\b/)[0].replace(/[.:;,\s]+$/, "");
  const cut = s.length > 110;   // a sentence too long for one line is cut between words and marked with an ellipsis
  if (cut) s = s.slice(0, 110).replace(/\s+\S*$/, "").replace(/(?:[,:;(]|\s(?:and|or|for|with|to|the|a|an|of|in))+$/i, "").trim();
  return s ? `${s[0].toUpperCase()}${s.slice(1)}${cut ? "…" : "."}` : "";
}

const hasLobe = (n) => existsSync(join(root, `node_modules/@lobehub/icons-static-svg/icons/${n}.svg`));
const hasSimple = (n) => !!simple[`si${n[0].toUpperCase()}${n.slice(1)}`];
/**
 * The logo, by the first rule that fits:
 *   1. the icon the catalog already gives this owner (catalog/skills.json "owners")
 *   2. an AI provider's logo in Lobe Icons, then a brand logo in Simple Icons, named like the owner or the product
 *   3. a logo file kept in the repo itself (reported as `file`, for a person to look at: it is not drawn automatically)
 *   4. the catalog's default icon
 * `avatar` is always the owner's GitHub picture, as a last resort to show.
 */
async function logoFor(names, owner, dir) {
  const slugs = [...new Set(names.filter(Boolean).flatMap((n) => { const s = n.toLowerCase().replace(/[^a-z0-9]/g, ""); return [s, s.replace(/(labs?|inc|hq|ai|dev|com|io|app|team|official|oss|mcp|skills?)$/, "")]; }).filter((s) => s.length > 1))];
  const avatar = owner ? `https://github.com/${owner}.png` : "";
  let file = "";
  if (dir) {
    const found = [];
    for (const sub of ["", ".github", "assets", "docs", "images", "img", "public", "static", "media"]) {
      for (const e of await readdir(join(dir, sub), { withFileTypes: true }).catch(() => [])) if (e.isFile() && /^(logo|icon)[\w.-]*\.(svg|png)$/i.test(e.name)) found.push(join(sub, e.name));
    }
    file = found.sort((a, b) => Number(/\.png$/i.test(a)) - Number(/\.png$/i.test(b)) || a.split("/").length - b.split("/").length || a.localeCompare(b))[0] || "";
  }
  const known = owner && owners[owner.toLowerCase()];
  if (known) return { spec: known, rule: "the catalog's icon for this owner", file, avatar };
  for (const s of slugs) if (hasLobe(`${s}-color`)) return { spec: `lobe:${s}-color`, rule: "Lobe Icons", file, avatar };
  for (const s of slugs) if (hasLobe(s)) return { spec: `lobe:${s}`, rule: "Lobe Icons", file, avatar };
  for (const s of slugs) if (hasSimple(s)) return { spec: `si:${s}`, rule: "Simple Icons", file, avatar };
  return { spec: owners._default, rule: file ? "the catalog's default; the repo has a logo file to consider" : "the catalog's default", file, avatar };
}

/** A two-letter key no catalog item has yet (it names the item in a share link): initials first, then the id's letters in order. */
function freeKey(id, taken) {
  const words = id.split(/[-_.]+/).filter(Boolean), flat = id.replace(/[^a-z0-9]/g, "");
  const tries = [words.length > 1 ? words[0][0] + words[1][0] : "", flat.slice(0, 2), ...[...flat.slice(1)].map((c) => flat[0] + c), ...[..."abcdefghijklmnopqrstuvwxyz0123456789"].map((c) => flat[0] + c)];
  const k = tries.find((t) => t.length === 2 && !taken.has(t)) || "";
  taken.add(k);
  return k;
}
const takenKeys = new Set([...listedSkills, ...listedServers].map((x) => x.k));

/** The commit a ref points at, so everything is read from one fixed state of the repo. */
async function commitOf(repo, ref) {
  const r = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`, { headers: { ...UA, accept: "application/vnd.github.sha" } });
  if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${repo}@${ref}`);
  return (await r.text()).trim();
}
/** The stable facts about a repo (licence, homepage) and, apart, the ones that move (stars, last update). */
async function facts(repo, live) {
  const f = await repoFacts(repo);
  return { license: f.license, homepage: f.homepage, repoAbout: f.about, live: live ? { stars: f.stars, updated: f.updated } : undefined };
}
const repoFrom = (s) => {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:[/?#].*)?$/.exec(s) || /^([\w.-]+\/[\w.-]+)$/.exec(s);
  if (!m) throw new Error(`"${s}" is not a GitHub repo (owner/repo or its address).`);
  return m[1];
};
/** Every folder in a checked-out repo that holds a SKILL.md, shallowest first; one per folder name. */
async function skillDirs(dir) {
  const hits = [];
  async function walk(d, depth) {
    if (depth > 7) return;
    for (const e of (await readdir(d, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.name === ".git" || e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (await exists(join(p, "SKILL.md"))) hits.push(p);
      await walk(p, depth + 1);
    }
  }
  await walk(dir, 0);
  const seen = new Set();
  return hits.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)).filter((p) => !seen.has(basename(p)) && seen.add(basename(p)));
}

/* ---------- one kind at a time ---------- */

async function captureSkills(source, names, { ref, live, work }) {
  const repo = repoFrom(source), owner = repo.split("/")[0], commit = await commitOf(repo, ref);
  const [f, dir] = await Promise.all([facts(repo, live), download(repo, work, commit)]);
  const readme = await text(join(dir, "README.md"));
  const all = await skillDirs(dir);
  const picked = names.length ? await Promise.all(names.map(async (n) => (await findSkill(dir, n)) || Promise.reject(new Error(`${repo} has no skill called ${n}.`)))) : all;
  if (!picked.length) throw new Error(`No skills were found in ${repo}.`);
  const out = [];
  for (const at of picked) {
    const fm = frontMatter(await text(join(at, "SKILL.md"))), id = fm.name && /^[\w.-]+$/.test(fm.name) ? fm.name : basename(at);
    const own = at !== dir ? await text(join(at, "README.md")) : "", alone = all.length <= 2 || at === dir;
    const about = clean(fm.description), title = heading(fm.body) || titleOf(id), description = oneLine(about);
    const listed = listedSkills.find((s) => s.id === id);
    out.push({
      kind: "skill", id, title, by: owner, description, about,
      logo: await logoFor([owner], owner, dir),
      usage: examples([own, alone ? readme : "", fm.body].filter(Boolean), fm.description),
      install: `npx skills add ${repo} --skill ${id}`,
      repo, path: relative(dir, at), commit, license: f.license || (/^[\w.+-]{2,24}$/.test(fm.license) ? fm.license : ""), homepage: f.homepage, live: f.live,
      entry: listed ? { inCatalog: true, ...listed } : { id, k: freeKey(id, takenKeys), repo: repo.toLowerCase(), name: title, ds: description, cats: [] },
    });
  }
  return out;
}

/** What the official MCP Registry records for the server at this address, if it lists it. */
async function registryEntry(url) {
  const bare = (u) => { try { const x = new URL(u); return `${x.host}${x.pathname.replace(/\/+$/, "")}`.toLowerCase(); } catch { return ""; } };
  const host = new URL(url).hostname.split(".").filter((p) => !["www", "mcp", "api", "app"].includes(p));
  for (const q of [host.length > 1 ? host[host.length - 2] : host[0]]) {
    for (let cursor = "", page = 0; page < 5; page++) {
      const r = await fetch(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=100&version=latest${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`).catch(() => null);
      if (!r?.ok) break;
      const d = await r.json();
      const hit = (d.servers || []).map((e) => e.server || {}).filter((v) => (v.remotes || []).some((x) => bare(x.url) === bare(url))).sort((a, b) => a.name.localeCompare(b.name))[0];
      if (hit) return hit;
      cursor = d.metadata?.nextCursor || d.metadata?.next_cursor || "";
      if (!cursor) break;
    }
  }
  return null;
}

async function captureServer(url, { name, ref, live, work }) {
  if (!/^https:\/\/\S+$/.test(url)) throw new Error("A server is captured by its https address.");
  const u = new URL(url), parts = u.hostname.split(".").filter((p) => !["www", "mcp", "api", "app"].includes(p)), label = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  const reg = await registryEntry(url), remote = reg?.remotes?.find((x) => x.url.replace(/\/+$/, "") === url.replace(/\/+$/, ""));
  const repo = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(reg?.repository?.url || "")?.[1] || null;
  let f = { license: "", homepage: "", repoAbout: "", live: undefined }, dir = "", commit = "", readme = "";
  if (repo) {
    commit = await commitOf(repo, ref);
    [f, dir] = await Promise.all([facts(repo, live), download(repo, work, commit)]);
    readme = await text(join(dir, "README.md"));
  }
  const id = label.toLowerCase().replace(/[^a-z0-9-]/g, ""), title = name || clean(reg?.title || "").split(/\s[-–—:|]\s/)[0] || titleOf(id);
  const about = clean(reg?.description || f.repoAbout), description = oneLine(about);
  const needsKey = !!remote?.headers?.some((h) => h.isRequired || /authorization|api[-_ ]?key|token/i.test(h.name || "") && h.isRequired !== false && !/optional/i.test(h.description || ""));
  const listed = listedServers.find((s) => s.url.replace(/\/+$/, "") === url.replace(/\/+$/, ""));
  const logo = await logoFor([label, title, repo?.split("/")[0]], repo?.split("/")[0] || "", dir);
  return [{
    kind: "mcp", id, title, by: titleOf(label), description, about, logo,
    usage: examples([readme], ""),
    install: `claude mcp add --transport http ${id} ${url}`,
    repo, path: repo ? "" : null, commit, license: f.license, homepage: reg?.websiteUrl || f.homepage || `${u.protocol}//${parts.join(".")}`, live: f.live,
    registry: reg ? { name: reg.name, version: reg.version || "", needsKey } : null,
    entry: listed ? { inCatalog: true, ...listed } : { id, k: freeKey(id, takenKeys), name: title, by: titleOf(label), ds: description, color: "", transport: "http", url, auth: needsKey ? "key" : "oauth", icon: logo.spec, cats: [] },
  }];
}

async function capturePlugins(source, names, { ref, live, work }) {
  const market = repoFrom(source), commit = await commitOf(market, ref);
  const [f, dir] = await Promise.all([facts(market, live), download(market, work, commit)]);
  const m = JSON.parse(await text(join(dir, ".claude-plugin/marketplace.json")) || "null");
  if (!m || !Array.isArray(m.plugins)) throw new Error(`${market} is not a plugin marketplace (no .claude-plugin/marketplace.json).`);
  const wanted = m.plugins.filter((p) => typeof p?.name === "string" && (!names.length || names.includes(p.name))).sort((a, b) => a.name.localeCompare(b.name));
  for (const n of names) if (!wanted.some((p) => p.name === n)) throw new Error(`${market} does not list a plugin called ${n}.`);
  const out = [];
  for (const p of wanted) {
    // where the plugin's files are: a folder of the marketplace's own repo, or another GitHub repo
    let repo = market, at = "", pdir = dir, pcommit = commit, lic = f.license, home = f.homepage, liveFacts = f.live, readable = true;
    if (typeof p.source === "string") at = p.source.replace(/^\.?\/+|\/+$/g, "");
    else {
      const other = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(p.source?.url || "")?.[1] || (/^[\w.-]+\/[\w.-]+$/.test(p.source?.repo || "") ? p.source.repo : "");
      at = String(p.source?.path || "").replace(/^\.?\/+|\/+$/g, "");
      if (!other) readable = false;
      else try {
        repo = other; pcommit = await commitOf(other, p.source?.sha || p.source?.ref || "HEAD");
        const [of, od] = await Promise.all([facts(other, live), download(other, work, pcommit)]);
        pdir = od; lic = of.license; home = of.homepage; liveFacts = of.live;
      } catch { readable = false; }
    }
    const here = readable ? join(pdir, at) : "";
    const manifest = here ? JSON.parse(await text(join(here, ".claude-plugin/plugin.json")) || "{}") : {};
    const readme = here ? await text(join(here, "README.md")) : "";
    const dirs = async (sub, re) => (here ? (await readdir(join(here, sub), { withFileTypes: true }).catch(() => [])).filter((e) => re(e)).map((e) => e.name.replace(/\.md$/, "")).sort() : []);
    const skillNames = (await Promise.all((await dirs("skills", (e) => e.isDirectory())).map(async (n) => ((await exists(join(here, "skills", n, "SKILL.md"))) ? n : "")))).filter(Boolean);
    const commands = await dirs("commands", (e) => e.isFile() && e.name.endsWith(".md"));
    const servers = here ? Object.entries(JSON.parse(await text(join(here, ".mcp.json")) || "{}").mcpServers || {}).map(([name, v]) => { let host = ""; try { host = new URL(v?.url || "").host; } catch { /* a program, not an address */ } return { name, host }; }).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const about = clean(p.description || manifest.description || ""), owner = repo.split("/")[0];
    out.push({
      kind: "plugin", id: p.name, title: p.displayName || manifest.displayName || heading(readme) || titleOf(p.name), by: clean(p.author?.name || manifest.author?.name || "") || owner,
      description: oneLine(about), about,
      logo: await logoFor([p.name, owner], owner, here),
      usage: [...commands.map((c) => `/${p.name}:${c}`).slice(0, 4), ...examples([readme], about)].slice(0, 6),
      install: `/plugin marketplace add ${market}\n/plugin install ${p.name}@${m.name}`,
      repo: readable ? repo : null, path: readable ? at : null, commit: readable ? pcommit : "", license: lic, homepage: p.homepage || manifest.homepage || home, live: liveFacts,
      plugin: { marketplace: m.name, category: p.category || "", version: p.version || manifest.version || "", skills: skillNames, commands, connectors: servers },
    });
  }
  return out;
}

/* ---------- the command ---------- */

const argv = process.argv.slice(2), flag = (n) => { const i = argv.indexOf(n); return i < 0 ? undefined : argv.splice(i, 2)[1]; };
const ref = flag("--ref") || "HEAD", outFile = flag("--out"), name = flag("--name");
const live = !argv.includes("--no-live");
const [kind, source, ...names] = argv.filter((a) => a !== "--no-live");
if (!["skill", "mcp", "plugin"].includes(kind) || !source) {
  console.error((await readFile(new URL(import.meta.url), "utf8")).split("\n").slice(0, 19).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(2);
}
const work = await mkdtemp(join(tmpdir(), "toolup-capture-"));
try {
  const opts = { ref, live, work, name };
  const records = kind === "skill" ? await captureSkills(source, names, opts) : kind === "mcp" ? await captureServer(source, opts) : await capturePlugins(source, names, opts);
  const out = JSON.stringify(records.sort((a, b) => a.id.localeCompare(b.id)), null, 2) + "\n";
  if (outFile) { await writeFile(outFile, out); console.error(`${records.length} ${kind}${records.length === 1 ? "" : "s"} → ${outFile}`); }
  else process.stdout.write(out);
} catch (e) {
  console.error(`capture: ${e.message}`);
  process.exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
