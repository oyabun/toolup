// Scan this machine and print what each harness has. Read-only.
//   npm run scan            a table
//   npm run scan -- --json  the full inventory (no secret values in it)
import { readFile } from "node:fs/promises";
import { nodeHost } from "../core/host-node.ts";
import { scan } from "../core/scan.ts";
import type { Catalog } from "../core/types.ts";

const catalog: Catalog = JSON.parse(await readFile(new URL("../../public/catalog.json", import.meta.url), "utf8"));
const inv = await scan(nodeHost(), catalog);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(inv, null, 2));
} else {
  const here = inv.harnesses.filter((h) => h.present);
  console.log(`Harnesses: ${here.map((h) => h.name).join(", ") || "none found"}`);
  const missing = inv.harnesses.filter((h) => !h.present).map((h) => h.name);
  if (missing.length) console.log(`Not found: ${missing.join(", ")}`);
  for (const h of here) for (const p of h.problems) console.log(`! ${h.name}: ${p}`);
  const w = Math.min(34, Math.max(12, ...inv.items.map((i) => i.name.length)));
  for (const kind of ["mcp", "skill"] as const) {
    const rows = inv.items.filter((i) => i.kind === kind);
    console.log(`\n${kind === "mcp" ? "MCP servers" : "Skills"} (${rows.length})`);
    if (!rows.length) continue;
    console.log(`  ${"".padEnd(w)}  ${here.map((h) => h.id.slice(0, 11).padEnd(11)).join(" ")}`);
    for (const i of rows) {
      const cells = here.map((h) => (i.in[h.id] ? "✓" : "–").padEnd(11)).join(" ");
      const notes = [i.catalogId ? "" : "custom", i.hasSecrets ? "has secrets" : ""].filter(Boolean).join(", ");
      console.log(`  ${i.name.slice(0, w).padEnd(w)}  ${cells} ${notes}`);
    }
  }
}
