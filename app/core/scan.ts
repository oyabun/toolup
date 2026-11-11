// The read-only scan: which harnesses are on this machine, and which MCP servers and skills each one has.
// It only reads. It runs no harness CLI and writes nothing.
import { parse as parseToml } from "smol-toml";
import { expand, readPlan, SKILL_STORE, type HarnessRead } from "./harnesses.ts";
import { parseOrigin } from "./github.ts";
import { mergePlugins, parseCodexPlugins, parseInstalledPlugins } from "./plugins.ts";
import { bareUrl, normalize, parseJsonc } from "./server.ts";
import type { Catalog, CatalogAgent, HarnessReport, Host, Inventory, Item } from "./types.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

async function present(host: Host, a: CatalogAgent): Promise<boolean> {
  if (a.bin && (await host.onPath(a.bin))) return true;
  for (const p of a.paths || []) if (await host.exists(expand(p, host.home))) return true;
  return false;
}

/** The servers table of one harness: name -> raw entry. */
async function readServers(host: Host, plan: HarnessRead, report: HarnessReport): Promise<Record<string, unknown>> {
  for (const f of plan.mcp.files) {
    const file = expand(f, host.home);
    const text = await host.readText(file);
    if (text === null) continue;
    report.mcpFile = file;
    if (!text.trim()) return {};
    try {
      const doc = plan.mcp.format === "toml" ? parseToml(text) : parseJsonc(text);
      const table = isRecord(doc) ? doc[plan.mcp.key] : null;
      return isRecord(table) ? table : {};
    } catch {
      report.problems.push(`Could not read ${file}: it is not valid ${plan.mcp.format.toUpperCase()}.`);
      return {};
    }
  }
  return {};
}

/** name and description from a SKILL.md's front matter, as far as they are there. */
export function frontMatter(text: string | null): { name: string | null; description: string | null } {
  const m = text && /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const get = (k: string) => {
    const line = m && new RegExp(`^${k}:[ \\t]*(.*)$`, "m").exec(m[1]);
    const v = line ? line[1].trim().replace(/^(["'])(.*)\1$/, "$2") : "";
    return v && !/^[|>][+-]?$/.test(v) ? v : null;   // block scalars are left to the details view
  };
  return { name: get("name"), description: get("description") };
}

export async function scan(host: Host, catalog: Catalog): Promise<Inventory> {
  const harnesses: HarnessReport[] = [];
  const items = new Map<string, Item>();
  const byUrl = new Map<string, Catalog["mcp"][number]>();
  for (const m of catalog.mcp) { const b = m.url && bareUrl(m.url); if (b) byUrl.set(b.url, m); }
  const skillById = new Map(catalog.skills.map((s) => [s.id, s]));
  // A local server that two harnesses call the same and run with the same program is one server,
  // even when its arguments differ (apps often pass the harness's own name).
  const sameLocal = new Map<string, string>();

  for (const agent of catalog.agents) {
    const report: HarnessReport = { id: agent.id, name: agent.name, present: await present(host, agent), mcpFile: null, problems: [] };
    harnesses.push(report);
    const plan = readPlan(agent);
    if (!report.present || !plan) continue;

    for (const [name, raw] of Object.entries(await readServers(host, plan, report))) {
      const s = normalize(name, raw);
      const known = s.url ? byUrl.get(s.url) : undefined;
      const alias = s.bin ? `${name.toLowerCase()}\n${s.bin}` : null;
      const key = (!items.has(s.key) && alias && sameLocal.get(alias)) || s.key;
      if (alias && !sameLocal.has(alias)) sameLocal.set(alias, key);
      let item = items.get(key);
      if (!item) {
        item = { kind: "mcp", key, name: known?.name || name, catalogId: known?.id || null, description: null, transport: s.transport, target: s.target, hasSecrets: false, in: {}, store: null, origin: null };
        items.set(key, item);
      }
      item.hasSecrets ||= s.hasSecrets;
      item.in[agent.id] = { name, source: report.mcpFile!, linked: false, linkTo: null };
    }

    for (const d of plan.skills) {
      const dir = expand(d, host.home);
      for (const e of (await host.list(dir)) || []) {
        if (!e.dir || e.name.startsWith(".")) continue;
        const md = await host.readText(`${dir}/${e.name}/SKILL.md`);
        if (md === null) continue;   // a folder without SKILL.md is not a skill
        const key = `skill:${e.name}`;
        let item = items.get(key);
        if (!item) {
          const fm = frontMatter(md), known = skillById.get(e.name) || skillById.get(fm.name || "");   // by its folder, else by the name it gives itself (a repo may keep it in a folder of another name)
          item = { kind: "skill", key, name: known?.name || fm.name || e.name, catalogId: known?.id || null, description: fm.description, transport: null, target: null, hasSecrets: false, in: {}, store: null, origin: null };
          items.set(key, item);
        }
        // its own folder wins over the shared one when a harness has both
        if (!item.in[agent.id]) item.in[agent.id] = { name: e.name, source: `${dir}/${e.name}`, linked: e.link !== null, linkTo: e.link };
      }
    }
  }

  // skills kept in Tool up!'s store, including ones not turned on for any agent
  const store = expand(SKILL_STORE, host.home);
  for (const e of (await host.list(store)) || []) {
    if (!e.dir || e.name.startsWith(".")) continue;
    const md = await host.readText(`${store}/${e.name}/SKILL.md`);
    if (md === null) continue;
    const key = `skill:${e.name}`;
    let item = items.get(key);
    if (!item) {
      const fm = frontMatter(md), known = skillById.get(e.name) || skillById.get(fm.name || "");   // by its folder, else by the name it gives itself (a repo may keep it in a folder of another name)
      item = { kind: "skill", key, name: known?.name || fm.name || e.name, catalogId: known?.id || null, description: fm.description, transport: null, target: null, hasSecrets: false, in: {}, store: null, origin: null };
      items.set(key, item);
    }
    item.store = `${store}/${e.name}`;
  }

  // where each skill came from: the note Tool up! left beside it, else the catalog's repo for a skill it lists
  for (const item of items.values()) {
    if (item.kind !== "skill") continue;
    const real = item.store || Object.values(item.in).find((p) => !p.linked)?.source || Object.values(item.in)[0]?.linkTo;
    item.origin = parseOrigin(real ? await host.readText(`${real}/.toolup.json`) : null);
    const known = item.catalogId ? skillById.get(item.catalogId) : undefined;
    if (!item.origin && known) item.origin = { repo: known.repo, path: null, sha: "" };
  }

  const sorted = [...items.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  const has = (id: string) => !!harnesses.find((h) => h.id === id)?.present;
  const claude = has("claude-code") ? parseInstalledPlugins(await host.readText(`${host.home}/.claude/plugins/installed_plugins.json`)) : [];
  let codex: ReturnType<typeof parseCodexPlugins> = [];
  if (has("codex")) {
    try { codex = parseCodexPlugins(parseToml((await host.readText(`${host.home}/.codex/config.toml`)) || "")); } catch { /* an unreadable config is already reported above */ }
  }
  return { harnesses, items: sorted, plugins: mergePlugins(claude, codex) };
}
