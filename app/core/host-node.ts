// The Host for Node: the command-line scan and the tests. The desktop shell will bring its own.
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { DirEntry, Host } from "./types.ts";

export function nodeHost(opts: { home?: string; path?: string[] } = {}): Host {
  const home = opts.home || homedir();
  // an app started from the Dock gets a bare PATH, so the usual install places are searched too
  const dirs = opts.path || [
    ...(process.env.PATH || "").split(delimiter).filter(Boolean),
    "/opt/homebrew/bin", "/usr/local/bin", join(home, ".local/bin"), join(home, ".npm-global/bin"), join(home, ".bun/bin"), join(home, ".volta/bin"),
  ];
  const exists = (p: string) => access(p).then(() => true, () => false);
  return {
    home,
    exists,
    readText: (p) => readFile(p, "utf8").catch(() => null),
    async list(p) {
      let names;
      try { names = await readdir(p, { withFileTypes: true }); } catch { return null; }
      const out: DirEntry[] = [];
      for (const d of names) {
        const full = join(p, d.name);
        if (d.isSymbolicLink()) {
          const target = await realpath(full).catch(() => null);
          const dir = target ? await stat(target).then((s) => s.isDirectory(), () => false) : false;
          out.push({ name: d.name, dir, link: target || full });
        } else out.push({ name: d.name, dir: d.isDirectory(), link: null });
      }
      return out;
    },
    async onPath(bin) {
      for (const d of dirs) if (await exists(join(d, bin))) return true;
      return false;
    },
  };
}
