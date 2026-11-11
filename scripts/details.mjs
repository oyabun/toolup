// Builds catalog/details.json: the same facts for every skill and MCP server, read from its GitHub repo.
//   - the repo's stars, licence, last update, homepage
//   - the item's own description, in full
//   - quick-start examples, taken from its README or SKILL.md
//   - its pictures (screenshots, demos), copied to app/ui/public/shots/<id>/ so the app has them without the network
// Run by hand: npm run details. It downloads each repo once (36 or so) and asks GitHub's API one question per repo.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";

import { UA, clean, download, examples, findSkill, frontMatter, pictures, repoFacts, serverRepo, size, text } from "./extract.mjs";

const root = new URL("..", import.meta.url).pathname;
const shotsDir = join(root, "app/ui/public/shots");
const { skills } = JSON.parse(await readFile(join(root, "catalog/skills.json"), "utf8"));
const servers = JSON.parse(await readFile(join(root, "catalog/mcp.json"), "utf8"));

const MAX_IMAGES = 4, MAX_IMAGE_BYTES = 1_500_000;

// items whose only pictures are a logo or a video thumbnail, checked by eye: no picture section for them
const NO_PICTURES = new Set(["tldraw", "browserstack"]);

async function savePictures(id, pics) {
  const out = [];
  const dir = join(shotsDir, id);
  await rm(dir, { recursive: true, force: true });
  if (NO_PICTURES.has(id)) return out;
  for (const p of pics) {
    if (out.length >= MAX_IMAGES) break;
    try {
      let data;
      if (p.file) data = (await stat(p.file)).size <= MAX_IMAGE_BYTES ? await readFile(p.file) : null;
      else {
        const r = await fetch(p.url, { headers: { "user-agent": UA["user-agent"] }, signal: AbortSignal.timeout(20000) });
        data = r.ok && /^image\//.test(r.headers.get("content-type") || "") ? Buffer.from(await r.arrayBuffer()) : null;
      }
      if (!data || data.length > MAX_IMAGE_BYTES || data.length < 4000) continue;   // too heavy for a bundle, or too small to be a screenshot
      const [w, h] = size(data);
      if (w < 480 || h < 300 || w / h > 2.6) continue;   // a button, a strip or a banner, not a picture of the thing
      const ext = (extname((p.file || new URL(p.url).pathname)).toLowerCase() || ".png").replace(".jpeg", ".jpg");
      await mkdir(dir, { recursive: true });
      const name = `${out.length + 1}${ext}`;
      await writeFile(join(dir, name), data);
      out.push({ src: `shots/${id}/${name}`, alt: clean(p.alt).slice(0, 120) });
    } catch { /* a picture that cannot be read is skipped */ }
  }
  return out;
}


const work = await mkdtemp(join(tmpdir(), "toolup-details-"));
const details = {};
const repos = [...new Set(skills.map((s) => s.repo))];
let n = 0;
for (const repo of repos) {
  const mine = skills.filter((s) => s.repo === repo);
  process.stdout.write(`[${++n}/${repos.length}] ${repo} (${mine.length}) `);
  try {
    const [facts, dir] = await Promise.all([repoFacts(repo), download(repo, work)]);
    const readme = await text(join(dir, "README.md"));
    for (const s of mine) {
      const at = await findSkill(dir, s.id);
      const fm = frontMatter(at ? await text(join(at, "SKILL.md")) : "");
      const own = at && at !== dir ? await text(join(at, "README.md")) : "";
      const alone = mine.length <= 2 || at === dir;   // the repo's README is about this skill only when the repo holds little else
      const pics = [...(at ? pictures(fm.body, at, dir) : []), ...(own ? pictures(own, at, dir) : []), ...(alone ? pictures(readme, dir, dir) : [])];
      details[s.id] = {
        kind: "skill", repo, path: at ? relative(dir, at) : null, ...facts,
        license: facts.license || (/^[\w.+-]{2,24}$/.test(fm.license) ? fm.license : ""), about: fm.description || s.ds,
        examples: examples([own, alone ? readme : "", fm.body].filter(Boolean), fm.description),
        images: await savePictures(s.id, pics.filter((p, i, a) => a.findIndex((q) => (q.file || q.url) === (p.file || p.url)) === i)),
      };
      process.stdout.write(at ? "." : "?");
    }
    await rm(dir, { recursive: true, force: true });
    console.log("");
  } catch (e) {
    console.log(` failed: ${e.message}`);
    for (const s of mine) details[s.id] ||= { kind: "skill", repo, path: null, stars: 0, license: "", updated: "", homepage: "", about: s.ds, examples: [], images: [] };
  }
}

n = 0;
for (const s of servers) {
  process.stdout.write(`[mcp ${++n}/${servers.length}] ${s.id} `);
  const base = { kind: "mcp", repo: null, path: null, stars: 0, license: "", updated: "", homepage: "", about: s.ds, examples: [], images: [] };
  try {
    const repo = s.transport === "http" ? await serverRepo(s) : null;
    if (!repo) { details[s.id] = base; console.log("no repo on record"); continue; }
    const [facts, dir] = await Promise.all([repoFacts(repo), download(repo, work)]);
    const readme = await text(join(dir, "README.md"));
    details[s.id] = { ...base, repo, path: "", ...facts, about: s.ds, examples: examples([readme], ""), images: await savePictures(s.id, pictures(readme, dir, dir)) };
    await rm(dir, { recursive: true, force: true });
    console.log(repo);
  } catch (e) { details[s.id] = base; console.log(`failed: ${e.message}`); }
}

await rm(work, { recursive: true, force: true });
// hand-written corrections, such as an English version of a description its author wrote in another language
const overrides = JSON.parse(await text(join(root, "catalog/details-overrides.json")) || "{}");
for (const [id, o] of Object.entries(overrides)) if (details[id]) Object.assign(details[id], o);
const sorted = Object.fromEntries(Object.entries(details).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(join(root, "catalog/details.json"), JSON.stringify(sorted, null, 1) + "\n");
const all = Object.values(sorted);
console.log(`\n${all.length} items · ${all.filter((d) => d.repo).length} with a repo · ${all.filter((d) => d.examples.length).length} with examples · ${all.filter((d) => d.images.length).length} with pictures (${all.reduce((k, d) => k + d.images.length, 0)} files)`);
