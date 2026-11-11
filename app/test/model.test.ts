// What the window shows for a given inventory: columns, rows per tab, and the gap counts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { columns, gapsOf, rows, totals } from "../ui/model.ts";
import { sample } from "../ui/sample.ts";

test("columns are the installed harnesses only", () => {
  assert.deepEqual(columns(sample).map((h) => h.id), ["claude-code", "codex", "gemini", "cursor"]);
});

test("gaps count the installed harnesses an item is missing from", () => {
  const cols = columns(sample), by = (n: string) => sample.items.find((i) => i.name === n)!;
  assert.equal(gapsOf(by("Sentry"), cols), 3);
  assert.equal(gapsOf(by("TDD"), cols), 0);
  const t = totals(sample);
  assert.deepEqual([t.harnesses, t.mcp, t.skills], [4, 6, 4]);
  assert.equal(t.gaps, sample.items.reduce((n, i) => n + (4 - Object.keys(i.in).length), 0));
});

test("tabs and search", () => {
  const all = rows(sample, { tab: "all", q: "" });
  assert.deepEqual([all.all.length, all.mcp.length, all.skill.length], [10, 6, 4]);
  const names = all.all.map((i) => i.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })), "by name, both kinds together");
  assert.deepEqual(rows(sample, { tab: "all", q: "gh" }).all.map((i) => i.name), ["GitHub"], "search also finds the name a harness uses");
});
