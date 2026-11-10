// Refreshes catalog/installs.json: the install count skills.sh shows on each skill's page.
// Run by .github/workflows/installs.yml every day; a skill whose page can't be read keeps its last count.
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const { skills } = JSON.parse(await readFile(new URL("catalog/skills.json", root), "utf8"));
let counts = {};
try { counts = JSON.parse(await readFile(new URL("catalog/installs.json", root), "utf8")); } catch {}

const toNumber = (s) => {
  const m = /^([\d.,]+)\s*([KM]?)$/i.exec(s.trim());
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Math.round(n * ({ K: 1e3, M: 1e6 }[m[2].toUpperCase()] || 1));
};

async function count(s) {
  const res = await fetch(`https://skills.sh/${s.repo}/${s.id}`, { headers: { "user-agent": "toolup-sh-catalog-builder" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const m = /<span>Installs<\/span><\/div><div[^>]*>([^<]+)<\/div>/.exec(await res.text());
  const n = m && toNumber(m[1]);
  if (!n) throw new Error("no install count on the page");
  return n;
}

let ok = 0;
const queue = [...skills];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let s; (s = queue.shift()); ) {
    try { counts[`${s.repo}/${s.id}`] = await count(s); ok++; }
    catch (e) { console.warn(`${s.repo}/${s.id}: ${e.message}${counts[`${s.repo}/${s.id}`] ? " (keeping the last count)" : ""}`); }
  }
}));

const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(new URL("catalog/installs.json", root), JSON.stringify(sorted, null, 2) + "\n");
console.log(`installs: ${ok}/${skills.length} refreshed`);
if (ok === 0) process.exit(1);
