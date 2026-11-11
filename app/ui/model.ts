// What the window shows, worked out from an inventory. No DOM here, so it is tested in Node.
import type { Inventory, Item, HarnessReport } from "../core/types.ts";

export type Tab = "all" | "mcp" | "skill";
export interface View {
  tab: Tab;
  q: string;
}

/** The columns: harnesses that are installed. */
export const columns = (inv: Inventory): HarnessReport[] => inv.harnesses.filter((h) => h.present);

/** How many installed harnesses lack this item. */
export const gapsOf = (item: Item, cols: HarnessReport[]) => cols.filter((h) => !item.in[h.id]).length;

const matches = (i: Item, q: string) => !q || [i.name, i.target || "", i.description || "", ...Object.values(i.in).map((p) => p.name)].join(" ").toLowerCase().includes(q);

/** Items passing the search, per tab, so each tab can show its count. */
export function rows(inv: Inventory, view: View): Record<Tab, Item[]> {
  const q = view.q.trim().toLowerCase();
  const all = inv.items.filter((i) => matches(i, q))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  return { all, mcp: all.filter((i) => i.kind === "mcp"), skill: all.filter((i) => i.kind === "skill") };
}

export function totals(inv: Inventory) {
  const cols = columns(inv);
  return {
    harnesses: cols.length,
    mcp: inv.items.filter((i) => i.kind === "mcp").length,
    skills: inv.items.filter((i) => i.kind === "skill").length,
    gaps: inv.items.reduce((n, i) => n + gapsOf(i, cols), 0),
  };
}
