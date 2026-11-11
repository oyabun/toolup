// The Host inside the desktop app: every call goes to a read-only command in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";
import type { DirEntry, Host } from "../core/types.ts";

export const inTauri = () => "__TAURI_INTERNALS__" in window;

export async function tauriHost(): Promise<Host> {
  const home = await invoke<string>("home_dir");
  return {
    home,
    readText: (path) => invoke<string | null>("read_text", { path }).catch(() => null),
    list: (path) => invoke<DirEntry[] | null>("list_dir", { path }).catch(() => null),
    exists: (path) => invoke<boolean>("path_exists", { path }),
    onPath: (bin) => invoke<boolean>("on_path", { bin }),
  };
}
