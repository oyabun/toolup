// Reading a skill, a server or a plugin out of its GitHub repo: the helpers scripts/details.mjs (the whole catalog)
// and scripts/capture.mjs (one item) share. Everything here is a fixed rule over the repo's files: no guessing,
// so the same commit always gives the same answer.
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join, normalize } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const UA = { "user-agent": "toolup-sh-catalog-builder", accept: "application/vnd.github+json" };
const MAX_EXAMPLES = 4;
export const exists = (p) => stat(p).then(() => true, () => false);
export const text = (p) => readFile(p, "utf8").catch(() => "");

export async function repoFacts(repo) {
  const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: UA });
  if (!r.ok) throw new Error(`GitHub API ${r.status} for ${repo}`);
  const d = await r.json();
  return { stars: d.stargazers_count ?? 0, license: d.license?.spdx_id && d.license.spdx_id !== "NOASSERTION" ? d.license.spdx_id : "", updated: (d.pushed_at || "").slice(0, 10), homepage: d.homepage || "", about: d.description || "" };
}

export async function download(repo, work, ref = "HEAD") {
  const dir = join(work, repo.replace("/", "__"));
  await mkdir(dir, { recursive: true });
  const tar = `${dir}.tar.gz`;
  await run("curl", ["-fsSL", "--max-time", "240", "-o", tar, `https://github.com/${repo}/archive/${ref}.tar.gz`]);
  await run("tar", ["-xzf", tar, "-C", dir, "--strip-components", "1"]);
  await rm(tar, { force: true });
  return dir;
}

/** The folder of the skill called `id`: one named after it with a SKILL.md, else one whose SKILL.md is named so, else the repo itself. */
export async function findSkill(dir, id) {
  const hits = [];
  async function walk(d, depth) {
    if (depth > 7) return;
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || e.name === ".git" || e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (await exists(join(p, "SKILL.md"))) hits.push(p);
      await walk(p, depth + 1);
    }
  }
  await walk(dir, 0);
  const named = hits.find((p) => basename(p) === id);
  if (named) return named;
  for (const p of hits) if (new RegExp(`^name:\\s*["']?${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*$`, "m").test(frontMatter(await text(join(p, "SKILL.md"))).raw)) return p;
  return (await exists(join(dir, "SKILL.md"))) ? dir : null;
}

export function frontMatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  const raw = m ? m[1] : "", body = m ? md.slice(m[0].length) : md;
  const get = (k) => {
    const line = new RegExp(`^${k}:[ \\t]*(.*)$`, "m").exec(raw);
    if (!line) return "";
    let v = line[1].trim();
    if (/^[|>][+-]?$/.test(v)) {   // a block: the indented lines that follow
      const rest = raw.slice(line.index + line[0].length).split(/\r?\n/).slice(1);
      const lines = [];
      for (const l of rest) { if (/^\S/.test(l)) break; lines.push(l.trim()); }
      v = lines.join(" ").trim();
    }
    return v.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  };
  return { raw, body, name: get("name"), description: get("description"), license: get("license") };
}

/** The part of a markdown document under the first heading that matches, up to the next heading of the same or a higher level. */
export function section(md, re) {
  const lines = md.split(/\r?\n/);
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    const h = !fence && /^(#{1,4})\s+(.*)$/.exec(lines[i]);
    if (!h || !re.test(h[2])) continue;
    const out = [];
    let f = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*(```|~~~)/.test(lines[j])) f = !f;
      const n = !f && /^(#{1,4})\s/.exec(lines[j]);
      if (n && n[1].length <= h[1].length) break;
      out.push(lines[j]);
    }
    return out.join("\n");
  }
  return "";
}

export const clean = (s) => s.replace(/\s+/g, " ").trim();
/** Short things to try: prompts in quotes, slash commands and small code blocks from a usage section; quoted phrases from the description as a fallback. */
// how a request to an agent starts: an instruction, a question, or a slash command
const ASK = /^(\/[a-z][\w-]*(?:\s|$)|(use|using|create|make|build|add|set up|set|help|review|check|find|show|compare|deploy|write|generate|optimi[sz]e|test|explore|polish|upgrade|get|recommend|explain|how|what|which|why|can|could|please|run|fix|analy[sz]e|summari[sz]e|draft|plan|design|convert|turn|give|list|search|open|audit|debug|refactor|migrate|track|schedule|send|update|improve|implement|document|translate|research|install|configure|scan|monitor|record|edit|remove|rename|animate|render|prototype|brainstorm|grill|start)\b)/i;
/** Things to say to your agent, as the item's own pages put them: from a usage or examples section, else quoted in its description. */
export function examples(docs, description) {
  const out = [];
  const add = (s) => {
    s = clean(s).replace(/^["“'`]+|["”'`]+$/g, "").replace(/\s+(→|->|#).*$/, "").replace(/["”'`]+$/, "").trim();
    if (s.length < 12 || s.length > 240 || !ASK.test(s) || (!s.startsWith("/") && s.split(" ").length < 4)) return;
    if (/npx skills add|claude plugin|\/plugin |git clone|npm i(nstall)? |pip install|brew install|uv tool install/i.test(s)) return;   // installing is Tool up!'s job
    if (!out.includes(s)) out.push(s);
  };
  for (const md of docs) {
    const part = section(md, /^(usage|how to use|using|quick ?start|getting started|examples?|example prompts?|try it|what (you can|to) (ask|say)|prompts?)\b/i);
    if (!part) continue;
    for (const m of part.matchAll(/(?:```|~~~)[^\n]*\n([\s\S]*?)(?:```|~~~)/g)) { const lines = m[1].trim().split("\n"); if (lines.length <= 5) lines.forEach(add); }
    for (const m of part.matchAll(/^\s*(?:[-*]|\d+\.)\s+(?:\*\*)?["“]([^"”\n]{8,240})["”]/gm)) add(m[1]);
    for (const m of part.matchAll(/^\s*(?:[-*>]|\d+\.)\s+`(\/[^`\n]{2,120})`/gm)) add(m[1]);
    for (const m of part.matchAll(/^>\s*["“]?([^"”\n]{12,240})["”]?\s*$/gm)) add(m[1]);
    if (out.length >= MAX_EXAMPLES) break;
  }
  if (out.length < 2) for (const m of description.matchAll(/["“]([^"”]{10,120})["”]/g)) add(m[1]);
  return out.slice(0, MAX_EXAMPLES);
}

/** Width and height of a PNG, GIF, WebP or JPEG, read from its first bytes; [0, 0] when it is something else. */
export function size(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.slice(0, 3).toString() === "GIF") return [b.readUInt16LE(6), b.readUInt16LE(8)];
  if (b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") {
    const k = b.slice(12, 16).toString();
    if (k === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (k === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (k === "VP8L") { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  }
  if (b[0] === 0xff && b[1] === 0xd8) for (let i = 2; i < b.length - 9; ) {
    if (b[i] !== 0xff) { i++; continue; }
    if ([0xc0, 0xc1, 0xc2].includes(b[i + 1])) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  return [0, 0];
}
const BADGE = /ytimg|img\.youtube|youtube\.com\/vi|shields\.io|badge|buymeacoffee|ko-fi|star-history|contrib\.rocks|github-readme-stats|codecov|travis|circleci|sonarcloud|vercel\.com\/button|deploy.*button|skills\.sh\/b\/|hits\.|visitor|sponsor|\/actions\/workflows\/|opencollective|\/logo|logo[-_.]|favicon|avatar/i;
/** Pictures in a markdown document: where each one is, resolved to a file in the repo or left as a web address. */
export function pictures(md, fromDir, repoDir) {
  const found = [];
  const push = (src, alt) => {
    src = src.trim().replace(/^<|>$/g, "").split(/\s+["']/)[0];
    if (!src || BADGE.test(src) || BADGE.test(alt) || !/\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(src)) return;
    const raw = /^https:\/\/(?:raw\.githubusercontent\.com|github\.com)\/[^/]+\/[^/]+\/(?:raw\/|blob\/)?[^/]+\/(.+?)(?:\?.*)?$/.exec(src);
    if (/^https?:\/\//.test(src) && !raw) return void found.push({ url: src, alt });
    const rel = raw ? raw[1] : src.replace(/^\.?\//, "").split(/[?#]/)[0];
    const file = normalize(join(raw ? repoDir : fromDir, decodeURIComponent(rel)));
    if (file.startsWith(repoDir)) found.push({ file, alt });
  };
  for (const m of md.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) push(m[2], m[1]);
  for (const m of md.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)) push(m[1], /\balt=["']([^"']*)["']/i.exec(m[0])?.[1] || "");
  return found;
}
/** The GitHub repo behind a remote MCP server, as the official MCP Registry records it. */
export async function serverRepo(s) {
  const bare = (u) => { try { const x = new URL(u); return `${x.host}${x.pathname.replace(/\/+$/, "")}`.toLowerCase(); } catch { return ""; } };
  for (const q of [s.name, new URL(s.url).host.split(".").slice(-2, -1)[0]]) {
    const r = await fetch(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=50&version=latest`).catch(() => null);
    if (!r?.ok) continue;
    for (const e of (await r.json()).servers || []) {
      const v = e.server || {};
      if (!(v.remotes || []).some((x) => bare(x.url) === bare(s.url))) continue;
      const m = /^https:\/\/github\.com\/([^/]+\/[^/.]+)/.exec(v.repository?.url || "");
      if (m) return m[1];
    }
  }
  return null;
}
