// The one thing in the app that changes the machine: running the Tool up! installer for catalog items.
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./host-tauri.ts";

export interface RunResult {
  /** The installer's exit code; 0 is success. */
  code: number;
  output: string;
}

export interface SkillFile {
  /** The folder name the skill installs under. */
  name: string;
  /** The text of its SKILL.md. */
  skillMd: string;
  /** How many files it holds. */
  files: number;
}
/** Look inside a dropped .skill file without installing anything. */
export const inspectSkill = (path: string) => invoke<SkillFile>("inspect_skill", { path });
/**
 * Install a dropped .skill file: a copy in each of `dirs`, and in each of `linkDirs` a link to the first copy.
 * All are absolute skill folders under home. An older copy of the same skill is replaced. Returns where it went.
 */
export const installSkill = (path: string, dirs: string[], linkDirs: string[], meta = "") => invoke<string[]>("install_skill", { path, dirs, linkDirs, meta: meta || null });

/** Turn an installed skill on for more agents: a link to its folder (`target`) in each of their skills folders. */
export async function linkSkill(target: string, linkDirs: string[]): Promise<string[]> {
  if (inTauri()) return invoke<string[]>("link_skill", { target, linkDirs });
  await new Promise((r) => setTimeout(r, 400));
  return linkDirs;
}

export interface Removed {
  path: string;
  /** A link was removed, a folder went to the Trash, or it was deleted for good. */
  how: "unlinked" | "trashed" | "deleted";
}
/** Remove skill folders or links (absolute paths, each directly inside a skills folder under home). */
export async function removeSkill(paths: string[]): Promise<Removed[]> {
  if (inTauri()) return invoke<Removed[]>("remove_skill", { paths });
  await new Promise((r) => setTimeout(r, 400));
  return paths.map((path) => ({ path, how: "trashed" }));
}

/** Install catalog ids into agents (`to` empty: every agent found). With dryRun, only say what would happen. */
export async function toolup(ids: string[], to: string[], dryRun: boolean): Promise<RunResult> {
  if (inTauri()) return invoke<RunResult>("toolup", { ids, to, dryRun });
  // a plain browser has no machine to change: show what the call would have been
  await new Promise((r) => setTimeout(r, 500));
  return { code: 0, output: `(sample) toolup.sh${dryRun ? " --dry-run" : ""}${to.length ? ` --to ${to.join(",")}` : ""} ${ids.join(" ")}\n\n${ids.map((i) => `  ${dryRun ? "→ would add" : "✓ added"} ${i}`).join("\n")}\n` };
}

/** Ask another catalog a question. In the app this goes through the shell, which only talks to the catalogs it knows. */
export async function fetchJson(url: string, bearer = ""): Promise<string> {
  if (inTauri()) return invoke<string>("fetch_json", { url, bearer: bearer || null });
  const r = await fetch(url, { headers: { accept: "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } });
  if (!r.ok) throw new Error(`The catalog answered ${r.status}.`);
  return r.text();
}
/** Download one skill from a GitHub repo and get it ready to look at; returns where it is, for inspectSkill and installSkill. */
export const fetchSkill = (repo: string, skill: string, path: string) => invoke<{ staged: string; path: string }>("fetch_skill", { repo, skill, hint: path });

/** Install remote MCP servers that are not in the Tool up! catalog, with the same installer. */
export async function toolupServers(servers: { id: string; name: string; url: string }[], to: string[], dryRun: boolean): Promise<RunResult> {
  if (inTauri()) return invoke<RunResult>("toolup_servers", { servers, to, dryRun });
  await new Promise((r) => setTimeout(r, 500));
  return { code: 0, output: "" };
}

/** Show a skill's folder or a server's settings file in Finder. */
export async function reveal(path: string): Promise<void> {
  if (inTauri()) await invoke("reveal_path", { path });
}

/** Open a web page in the user's browser. The shell only opens the agents' own download pages. */
export async function openUrl(url: string): Promise<void> {
  if (inTauri()) await invoke("open_url", { url });
  else window.open(url, "_blank", "noopener");
}

/** Download a repo once and get several of its skills ready (each given by its folder inside the repo). */
export const fetchSkills = (repo: string, paths: string[]) => invoke<{ staged: string; path: string }[]>("fetch_skills", { repo, paths });

/** Install a plugin in Claude Code, with Claude Code's own plugin command. */
export async function claudePlugin(repo: string, market: string, plugin: string): Promise<RunResult> {
  if (inTauri()) return invoke<RunResult>("claude_plugin", { repo, market, plugin });
  await new Promise((r) => setTimeout(r, 500));
  return { code: 0, output: "" };
}

/**
 * Take a skill out of an agent's folder without deleting it: the folder moves to Tool up!'s saved copies
 * (`storeDir`), and each folder in `relinkDirs` gets a link to it there, so agents that were sharing it keep it.
 */
export async function parkSkill(path: string, storeDir: string, relinkDirs: string[]): Promise<string> {
  if (inTauri()) return invoke<string>("park_skill", { path, storeDir, relinkDirs });
  await new Promise((r) => setTimeout(r, 400));
  return path;
}

/** Add a plugin marketplace (a GitHub repo) to Codex, so its plugins show up in Codex's /plugins list. */
export async function codexMarketplace(repo: string): Promise<RunResult> {
  if (inTauri()) return invoke<RunResult>("codex_marketplace", { repo });
  await new Promise((r) => setTimeout(r, 300));
  return { code: 0, output: "" };
}

/** Take MCP servers out of agents, by the name each agent knows them by. */
export async function toolupRemove(names: string[], to: string[]): Promise<RunResult> {
  if (inTauri()) return invoke<RunResult>("toolup_remove", { names, to });
  await new Promise((r) => setTimeout(r, 500));
  return { code: 0, output: "" };
}

/** The text files of a skill about to be installed (a .skill file or a staged download), for the safety check. */
export const skillTexts = (path: string) => invoke<{ path: string; text: string }[]>("skill_texts", { path });

/** Save an instructions file: AGENTS.md, CLAUDE.md or GEMINI.md in a project, or a skill's SKILL.md. */
export const writeText = (path: string, text: string) => invoke<void>("write_text", { path, text });

/** Copy a skill's folder into the store under a new name, as a skill of your own. Returns where the copy is. */
export const copySkill = (source: string, storeDir: string, name: string) => invoke<string>("copy_skill", { source, storeDir, name });

/** Back up the saved skills to a GitHub repository with the user's own git (or, with `restore`, pull them back). */
export async function backupStore(storeDir: string, remote: string, restore: boolean): Promise<RunResult> {
  if (inTauri()) return invoke<RunResult>("backup_store", { storeDir, remote, restore });
  await new Promise((r) => setTimeout(r, 600));
  return { code: 0, output: "(sample) nothing was sent" };
}

/** The toolup:// links the app was opened with. */
export const startLinks = () => (inTauri() ? invoke<string[]>("start_links") : Promise.resolve([] as string[]));

/** Ask for a folder with the system's own dialog; null when the user cancels. */
export const pickFolder = () => invoke<string | null>("pick_folder");

/** Open a terminal in a project folder with an agent started on its own /init, which writes the project's instructions. */
export const openTerminal = (path: string, agent: string) => invoke<void>("open_terminal", { path, agent });
