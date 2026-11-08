// The page in jsdom: loads public/index.html and app.js with the built catalog and walks the main interactions.
// Each check is its own test, so a failure names what broke. Run: npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { machine, lines } from "./helpers.mjs";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const read = (f) => readFileSync(root + f, "utf8");
const catalog = JSON.parse(read("catalog.json"));
const html = read("index.html").replace(/<script[^>]*src="app\.js[^"]*"[^>]*><\/script>/, "");
const errors = [];
let window, $, $$, click;
const downloads = [];

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function boot(hash = "") {
  const dom = new JSDOM(html, { url: `http://localhost:3000/${hash}`, runScripts: "outside-only", pretendToBeVisual: true });
  window = dom.window;
  window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  window.fetch = async (u) => ({ ok: true, json: async () => catalog, text: async () => read(String(u)) });
  window.matchMedia = () => ({ matches: false });
  window.navigator.clipboard = { writeText: async (t) => { window.__copied = t; } };
  window.URL.createObjectURL = (b) => { downloads.push(b); return "blob:x"; };
  window.HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
  window.eval(read("app.js"));
  await wait(30);
  $ = (s) => window.document.querySelector(s);
  $$ = (s) => [...window.document.querySelectorAll(s)];
  click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}
const card = (id) => $(`.item[data-id="${id}"]`);
const pick = (...ids) => ids.forEach((i) => click(card(i)));
const cmd = () => $("#cmd").textContent;
before(() => boot());

test("the page loads without script errors", () => assert.deepEqual(errors, []));

test("the hero, the wordmark with its beta pill and the logo are there", () => {
  assert.match($("h1").textContent, /Kit your agents in one line\./);
  assert.equal($(".logo").textContent, "K!/");
  assert.equal($(".beta").textContent, "beta");
  assert.match($(".brand").textContent, /Kit'Em!/);
});

test("sections run 01 to 04 in order, then the FAQ", () => {
  const heads = $$("h2").map((h) => h.textContent.replace(/\s+/g, " ").trim());
  assert.match(heads[0], /^01 Kit which agents\?/);
  assert.match(heads[1], /^02 Start from a kit/);
  assert.match(heads[2], /^03 MCP servers/);
  assert.match(heads[3], /^04 Skills/);
  assert.equal(heads[4], "Questions, answered");
});

test("agent chips: All agents is on by default, then the five agents", () => {
  const chips = $$("#targets button");
  assert.deepEqual(chips.map((c) => c.textContent.trim()), ["All agents", "Claude Code", "Codex", "Gemini CLI", "Cursor", "VS Code"]);
  assert.equal(chips[0].getAttribute("aria-pressed"), "true");
});

test("six kits, 22 servers and 45 skills are listed from the catalog", () => {
  assert.equal($$(".pack").length, 6);
  assert.equal($$("#h-mcp ~ .grid .item").length, 22);
  assert.equal($$("#h-skills ~ .grid .item").length, 45);
});

test("an empty selection gives no command and disables the buttons", () => {
  assert.match(cmd(), /^Pick servers or skills/);
  for (const b of ["copy", "view", "dl", "link"]) assert.ok($("#" + b).disabled, b);
});

test("picking items builds the line; ids come out in catalog order, not click order", () => {
  pick("tdd", "playwright", "github", "grill-me", "frontend-design");
  assert.equal(cmd(), "curl -fsSL kitenm.sh | bash -s -- github playwright grill-me tdd frontend-design");
  assert.equal(card("tdd").getAttribute("aria-pressed"), "true");
  assert.match($("#count").textContent, /^2 servers · 3 skills → all your agents$/);
  assert.ok(!$("#copy").disabled);
});

test("choosing specific agents adds --to, and going back to All removes it", () => {
  click($('[data-tgt="claude-code"]')); click($('[data-tgt="cursor"]'));
  assert.match(cmd(), / --to claude-code,cursor$/);
  assert.match($("#count").textContent, /→ Claude Code, Cursor$/);
  click($("[data-all]"));
  assert.doesNotMatch(cmd(), /--to/);
  assert.equal($("[data-all]").getAttribute("aria-pressed"), "true");
});

test("the --dry-run flag and the Docker toggle edit the line", () => {
  click($("#dryflag")); assert.match(cmd(), / --dry-run$/); assert.equal($("#dryflag").getAttribute("aria-pressed"), "true");
  $("#dock").checked = true; $("#dock").dispatchEvent(new window.Event("change"));
  assert.match(cmd(), / --docker --dry-run$/);
  click($("#dryflag")); $("#dock").checked = false; $("#dock").dispatchEvent(new window.Event("change"));
  assert.doesNotMatch(cmd(), /--docker|--dry-run/);
});

test("Copy command and Copy link put the right text on the clipboard", async () => {
  click($("#copy")); await wait();
  assert.equal(window.__copied, cmd());
  click($("#link")); await wait();
  assert.match(window.__copied, /^http:\/\/localhost:3000\/#e-/);
});

test("the share link restores the selection, Docker switch included", async () => {
  click($("#clear"));
  assert.match(cmd(), /^Pick/);
  pick("github", "tdd", "fetch");
  $("#dock").checked = true; $("#dock").dispatchEvent(new window.Event("change"));
  const link = window.location.hash;
  assert.match(link, /^#e-gh-.*-zz$/);
  const was = cmd();
  await boot(link);
  assert.equal(cmd(), was);
  assert.ok($("#dock").checked);
  assert.equal(card("tdd").getAttribute("aria-pressed"), "true");
  assert.ok(link.split("-").every((k) => !/[A-Z]/.test(k)) && !/grill|playwright/.test(link), "short codes, not names");
});

test("a kit pre-selects servers and skills; Docker-first also flips the gateway on", async () => {
  await boot();
  click($$(".pack")[0]);
  assert.match(cmd(), /grill-me .*tdd/);
  await boot();
  click($$(".pack").find((p) => p.textContent.startsWith("Docker-first")));
  assert.match(cmd(), /github context7 playwright fetch memory --docker$/);
});

test("search finds servers and skills together, and says when nothing matches", () => {
  const q = $("#q");
  q.value = "postgres"; q.dispatchEvent(new window.Event("input"));
  const ids = $$(".item").map((i) => i.dataset.id);
  assert.ok(ids.includes("supabase") && ids.includes("neon-postgres") && ids.includes("supabase-postgres-best-practices"), ids.join());
  q.value = "zzzzqqq"; q.dispatchEvent(new window.Event("input"));
  assert.match($("#cat").textContent, /Nothing matches/);
  q.value = ""; q.dispatchEvent(new window.Event("input"));
  assert.equal($$(".item").length, 67);
});

test("MCP cards carry the tags: remote, local, oauth, docker, runtime needed", () => {
  const tags = (id) => [...card(id).querySelectorAll(".tag")].map((t) => t.textContent);
  assert.deepEqual(tags("github"), ["remote", "oauth", "docker"]);
  assert.deepEqual(tags("context7"), ["remote", "docker"]);
  assert.deepEqual(tags("playwright"), ["local", "docker", "needs node"]);
  assert.deepEqual(tags("fetch"), ["local", "docker", "needs uv"]);
  assert.deepEqual(tags("chrome-devtools"), ["local", "needs node"]);
});

test("skill cards show owner/repo, a skills.sh install count and the Helmcode badge", () => {
  const withCounts = catalog.skills.filter((s) => s.installs);
  assert.ok(withCounts.length > 0, "run npm run installs to fill the counts");
  const s = withCounts[0];
  assert.match(card(s.id).textContent, /\d+(\.\d)?[KM] installs/);
  assert.match(card("tdd").querySelector(".by").textContent, /^mattpocock\/skills$/);
  for (const id of ["finops", "building-a-beatdeck", "remotion-product-video"]) assert.ok([...card(id).querySelectorAll(".tag.h")].some((t) => t.textContent === "helmcode"), id);
  assert.equal($$(".tag.h").length, 3);
});

test("featured repos filter the skills and count what's picked from each", async () => {
  await boot();
  assert.equal($$(".repo").length, 8);
  pick("tdd", "grill-me", "pdf");
  const picked = (r) => $(`[data-picked="${r}"]`).textContent;
  assert.equal(picked("mattpocock/skills"), "2");
  assert.equal(picked("anthropics/skills"), "1");
  assert.equal(picked("obra/superpowers"), "0");
  click($('.repo[data-repo="obra/superpowers"]'));
  assert.deepEqual($$("#h-skills ~ .grid .item").map((i) => i.dataset.id).sort(), ["brainstorming", "systematic-debugging", "verification-before-completion", "writing-plans"]);
  assert.equal($('.repo[data-repo="obra/superpowers"]').getAttribute("aria-pressed"), "true");
  click($('.repo[data-repo="obra/superpowers"]'));
  assert.equal($$("#h-skills ~ .grid .item").length, 45);
});

test("category chips filter the skills", () => {
  const cats = $$(".cat").map((c) => c.textContent);
  assert.deepEqual(cats, ["All", "Planning & workflow", "Code quality & debugging", "Frontend & design", "Backend, data & cloud", "Docs, slides & video", "Meta"]);
  click($('.cat[data-cat="meta"]'));
  assert.deepEqual($$("#h-skills ~ .grid .item").map((i) => i.dataset.id).sort(), ["caveman", "skill-creator"]);
  click($('.cat[data-cat=""]'));
});

test("MCP details show transport, URL and the exact wiring for every agent", () => {
  click($('[data-info="github"]'));
  const sheet = $("#sheet").textContent;
  assert.match(sheet, /Streamable HTTP/);
  assert.match(sheet, /https:\/\/api\.githubcopilot\.com\/mcp\//);
  assert.match(sheet, /claude mcp add --scope user --transport http github https:\/\/api\.githubcopilot\.com\/mcp\//);
  assert.match(sheet, /codex mcp add github --url /);
  assert.match(sheet, /gemini mcp add -s user -t http github /);
  assert.match(sheet, /code --add-mcp '\{"name":"github","type":"http"/);
  assert.match(sheet, /\.cursor\/mcp\.json/);
  click($("[data-close]"));
  assert.ok(!$("#scrim").classList.contains("show"));
});

test("with agents chosen, details show only those agents' commands", () => {
  click($('[data-tgt="gemini"]'));
  click($('[data-info="playwright"]'));
  const sheet = $("#sheet").textContent;
  assert.match(sheet, /gemini mcp add -s user playwright npx -y @playwright\/mcp@latest/);
  assert.doesNotMatch(sheet, /claude mcp add/);
  click($("[data-close]")); click($("[data-all]"));
});

test("skill details show the repo link and the npx skills add line", () => {
  click($('[data-info="tdd"]'));
  assert.equal($("#sheet a").getAttribute("href"), "https://github.com/mattpocock/skills");
  assert.match($("#sheet").textContent, /npx skills add mattpocock\/skills --skill tdd -g/);
  click($("[data-close]"));
});

test("the details sheet is a dialog: Escape closes it and focus goes back to where it was", () => {
  const btn = $('[data-info="fetch"]'); btn.focus();
  click(btn);
  assert.equal($("#sheet").getAttribute("role"), "dialog");
  assert.ok($("#scrim").classList.contains("show"));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!$("#scrim").classList.contains("show"));
  assert.equal(window.document.activeElement, btn);
});

test("toggling a card keeps keyboard focus on it", () => {
  const c = card("memory"); c.focus(); click(c);
  assert.equal(window.document.activeElement, c);
  click(c);
});

test("every control is a real button, input or link, and none is nested inside another", () => {
  assert.equal($$("[onclick], div[role=button], span[role=button]").length, 0);
  assert.equal($$("button button, a button, button a").length, 0);
  for (const b of $$("button")) assert.ok(b.textContent.trim() || b.getAttribute("aria-label"), `unlabelled button ${b.outerHTML.slice(0, 60)}`);
  assert.ok($("#q").getAttribute("aria-label"));
});

test("light and dark: tokens exist for both, and the toggle sets a theme", () => {
  const css = read("style.css");
  assert.match(css, /prefers-color-scheme:dark/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /--accent:#7c6df0/);
  click($("#theme"));
  assert.equal(window.document.documentElement.dataset.theme, "dark");
  click($("#theme"));
  assert.equal(window.document.documentElement.dataset.theme, "light");
});

test("it works at phone width: viewport meta, no fixed widths over the viewport", () => {
  assert.match(read("index.html"), /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(read("style.css"), /@media \(max-width:639px\)/);
});

test("the FAQ answers the questions the brief lists", () => {
  const q = $$(".faq summary").map((s) => s.textContent);
  for (const re of [/actually do/, /install the agents/, /safe/, /tokens/, /Docker/, /re-running/, /remove/, /skills picked/]) assert.ok(q.some((t) => re.test(t) || re.test(t.toLowerCase())), String(re));
  assert.match($("#faq").innerHTML, /href="https:\/\/getem\.sh\/"/);
});

// ---- the script the page hands out

test("Download .sh builds a self-contained script with the selection baked in", async () => {
  await boot();
  pick("github", "tdd", "filesystem"); click($('[data-tgt="claude-code"]'));
  click($("#dl")); await wait(50);
  assert.equal(window.__download, "kitenm.sh");
  const blob = downloads.at(-1);
  const sh = await new Promise((res) => { const r = new window.FileReader(); r.onload = () => res(r.result); r.readAsText(blob); });
  assert.match(sh, /^#!\/bin\/bash/);
  assert.match(sh, /EMBEDDED=1\nDEFAULT_IDS="github filesystem tdd"\nDEFAULT_TO="claude-code"\nDEFAULT_DOCKER=0/);
  assert.match(sh, /^mcp\tgithub\t/m);
  assert.doesNotMatch(sh, /@@EMBED_START@@ \(downloaded/);
});

test("the downloaded script runs offline with no arguments and does what the page said", async () => {
  await boot();
  pick("github", "playwright", "tdd"); click($('[data-tgt="claude-code"]')); click($('[data-tgt="gemini"]'));
  const sh = await window.Kitem.script();
  const m = machine();
  const { writeFileSync } = await import("node:fs");
  const file = join(m.dir, "kitenm.sh"); writeFileSync(file, sh);
  const { spawnSync } = await import("node:child_process");
  const run = (...a) => spawnSync("bash", [file, ...a], { encoding: "utf8", env: { PATH: `${m.dir}/bin:${process.env.PATH}`, HOME: m.home, STUB_STATE: m.state, NO_COLOR: "1", CATALOG_URL: "http://127.0.0.1:9/never" } });
  const { spawnSync: sp } = await import("node:child_process");
  assert.equal(sp("bash", ["-n", file]).status, 0, "downloaded script is valid bash");
  if (!sp("shellcheck", ["--version"]).error) assert.equal(sp("shellcheck", ["-s", "bash", file], { encoding: "utf8" }).status, 0, "downloaded script passes shellcheck");
  const dry = run("--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /claude mcp add --scope user --transport http github/);
  assert.match(dry.stdout, /gemini mcp add -s user playwright npx -y @playwright\/mcp@latest/);
  assert.doesNotMatch(dry.stdout, /codex mcp add|--add-mcp|cursor/);
  assert.equal(run().status, 0);
  assert.ok(m.calls().some((c) => /skills add mattpocock\/skills -g -y -a claude-code -a gemini-cli --skill tdd/.test(c)), m.calls().join("\n"));
});

test("the wiring commands the page shows are the ones the installer runs, for every agent and every server", () => {
  const m = machine();
  const ids = catalog.mcp.map((x) => x.id);
  const dry = m.run("--dry-run", ...ids);
  const ran = lines(dry.out, "→").map((l) => l.replaceAll(m.home, "$HOME"));
  for (const a of catalog.agents) {
    for (const x of catalog.mcp) {
      const shown = window.Kitem.wire(a.id, x);
      if (a.method === "json") {
        const entry = shown.split("\n")[1];
        assert.ok(ran.some((l) => l.startsWith(`add ${x.id} to `) && l.includes(a.config[0].replace("$HOME", m.home).replaceAll(m.home, "$HOME"))), `${a.id}/${x.id}`);
        assert.ok(entry.startsWith(`"${x.id}": {`));
      } else if (a.method === "vscode") {
        assert.ok(ran.includes(shown.replace(/"\$HOME"/g, '"$HOME"')), `${a.id}/${x.id}: ${shown}`);
      } else {
        const want = shown.replace(/"\$HOME"/g, "$HOME");
        assert.ok(ran.includes(want), `${a.id}/${x.id}: ${want}\n${ran.filter((l) => l.includes(x.id)).join("\n")}`);
      }
    }
  }
});

test("every server, skill, agent chip and repo shows an inline logo, not initials", async () => {
  await boot();
  const noIcon = (sel) => $$(sel).filter((el) => !el.querySelector(".ico svg path, .ico svg g")).map((el) => el.dataset.id || el.dataset.repo || el.dataset.tgt);
  assert.deepEqual(noIcon(".item"), []);
  assert.deepEqual(noIcon(".repo"), []);
  assert.deepEqual(noIcon("[data-tgt]"), []);
  assert.equal($$(".item .ico").length, 67);
  assert.ok(!$$(".item .ico").some((i) => /^[A-Za-z]{2}$/.test(i.textContent)), "no two-letter placeholders");
  // real logos for the brands Simple Icons has; Lucide glyphs only for the handful it lacks
  const logo = (id) => catalog.mcp.find((m) => m.id === id).icon;
  for (const id of ["github", "figma", "notion", "linear", "sentry", "supabase", "vercel", "stripe"]) assert.ok(logo(id).path, `${id} should be a brand logo`);
  // the AI providers use Lobe Icons; VS Code is an editor, not a provider, so it gets no provider logo
  const agent = (id) => catalog.agents.find((a) => a.id === id).icon;
  for (const id of ["claude-code", "codex", "gemini", "cursor"]) assert.ok(agent(id).svg, `${id} should use its Lobe Icons logo`);
  assert.ok(!agent("vscode").svg && agent("vscode").stroke, "VS Code is not a provider");
  assert.ok(catalog.repos.find((r) => r.repo === "anthropics/skills").icon.svg && catalog.repos.find((r) => r.repo === "openai/skills").icon.svg);
  assert.equal($$("[data-tgt] .ico.brand").length, 4);
  click($('[data-info="github"]'));
  assert.ok($("#sheet .sheet-h .ico svg"));
});
