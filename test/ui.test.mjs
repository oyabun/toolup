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
async function boot(hash = "#catalog", page = 1000) {   // the catalog view: what these tests walk through
  const dom = new JSDOM(html, { url: `http://localhost:3000/${hash}`, runScripts: "outside-only", pretendToBeVisual: true });
  window = dom.window;
  window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  window.KITEM_PAGE = page;   // the tests count whole lists; pagination has its own test
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
const tabTo = (k) => { const s = $("#show-pick"); s.value = k; s.dispatchEvent(new window.Event("change")); };   // the header's "show" dropdown
// the page shows one list at a time (tabs): finding a card opens the tab it lives in
const card = (id) => {
  let el = $(`.item[data-id="${id}"]`);
  if (!el) { tabTo(catalog.skills.some((x) => x.id === id) ? "skills" : "mcp"); el = $(`.item[data-id="${id}"]`); }
  return el;
};
const pick = (...ids) => ids.forEach((i) => click(card(i)));
const cmd = () => $("#cmd").textContent;
before(() => boot());

test("the page loads without script errors", () => assert.deepEqual(errors, []));

test("the hero, the wordmark with its beta pill and the logo are there", () => {
  assert.match($("#v-catalog h1").textContent, /Tool up your agents in one line\./);
  assert.equal($(".logo").getAttribute("aria-label"), "Tool up!");
  assert.equal($(".logo").tagName.toLowerCase(), "svg", "the logo is a vector");
  assert.equal($$(".home .logo path").length, 1, "one path: the official logo");
  assert.equal($(".logo path").getAttribute("d"), /\sd="([^"]+)"/.exec(read("images/logo.svg"))[1], "exactly the path of images/logo.svg");
  assert.equal($(".logo").getAttribute("fill"), "currentColor", "so it can be dark on light and white on dark");
  assert.ok($("link[rel=icon]").getAttribute("href").endsWith(".svg"), "and the favicon is the toolbox too")
  assert.deepEqual($$("header #show-pick option").map((o) => o.value), ["all", "mcp", "skills"], "All, MCP servers and Skills are one dropdown in the header");
  assert.equal($("header .faq-link"), null, "the FAQ is not in the top bar");
  assert.equal($("header a[href=\"#faq\"]"), null);
  assert.ok($("header #q") && $("header #cat-pick") && $("header #theme"), "search, categories and theme share the header's one line");
  assert.equal($("#toolbar"), null, "there is no second toolbar");
  assert.equal($("header a.ext"), null, "Get'Em! is a different use case, not in the header");
  assert.match(read("style.css"), /header\{position:fixed;top:0;left:0;right:0;z-index:50/, "the header is fixed, not sticky");
  assert.ok($(".hero #agent-btn"), "the agent selector lives in the hero");
  assert.ok(!$("header #agent-btn"), "and not in the header");
  assert.ok($("header .theme"), "the theme button is in the header, with the rest of the tools");
  assert.equal($(".beta").textContent, "beta");
  assert.match($(".brand").textContent, /Tool up!/);
});

test("the page opens on the app; the header's tabs switch to the catalog and back", () => {
  const view = () => window.document.documentElement.dataset.view;
  const current = () => $$(".views a[aria-current]").map((a) => a.dataset.view);
  assert.equal(view(), "catalog", "#catalog opens the catalog");
  click($('.views a[data-view="app"]'));
  assert.equal(view(), "app");
  assert.deepEqual(current(), ["app"]);
  assert.equal(window.location.hash, "");
  assert.match($("#v-app h1").textContent, /one window/);
  assert.ok($("#v-app .app-shot img"), "with a picture of the app");
  click($('.views a[data-view="catalog"]'));
  assert.equal(view(), "catalog");
  assert.deepEqual(current(), ["catalog"]);
  assert.equal(window.location.hash, "#catalog", "the address says which view, so a reload stays there");
  click($('#v-app a[data-view="catalog"]'));
  assert.equal(view(), "catalog", "the app page's own links to the catalog go there too");
  assert.match(read("app.js"), /viewOf = \(h\) => \(h === "catalog" \|\| h\.startsWith\("e-"\) \? "catalog" : "app"\)/, "no hash: the app comes first");
  assert.match(read("style.css"), /\[data-view="app"\] #v-catalog,\[data-view="catalog"\] #v-app\{display:none\}/, "only one view shows");
  assert.match(read("index.html"), /dataset\.view = h === "catalog" \|\| h\.indexOf\("e-"\) === 0 \? "catalog" : "app"/, "set before the first paint: #catalog or a share link opens the catalog");
});

test("sections run 01 to 02 in order, then the FAQ; the list's heading explains the open tab", () => {
  const heads = $$("#v-catalog h2").map((h) => h.textContent.replace(/\s+/g, " ").trim());
  assert.match(heads[0], /^01 Start from a pack/);
  assert.match(heads[1], /^02 Pick your tools/, "one list, not a section per kind");
  assert.equal(heads[2], "Questions, answered");
  tabTo("skills");
  assert.match($$("#v-catalog h2")[1].textContent, /Skills teach your agents/);
  tabTo("all");
});

test("three tabs, All, MCPs and Skills, over one list; cards say which kind they are", () => {
  const tabs = () => $$("#cat .tabs .tab");
  assert.deepEqual(tabs().map((b) => b.querySelector("span").textContent), ["All", "MCPs", "Skills"]);
  assert.deepEqual(tabs().map((b) => b.querySelector("small").textContent), ["209", "56", "153"]);
  assert.equal($('[data-show="all"]').getAttribute("aria-pressed"), "true");
  assert.equal($$("#cat .grid").length, 1, "All is one mixed list");
  const names = $$("#cat .item .nm").map((n) => n.textContent);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })), "by name, servers and skills together");
  assert.ok($$("#cat .item.k-mcp").every((i) => i.querySelector(".kind").textContent === "MCP"));
  assert.ok($$("#cat .item.k-skill").every((i) => i.querySelector(".kind").textContent === "Skill"));
  click($('[data-show="mcp"]'));
  assert.equal($('[data-show="mcp"]').getAttribute("aria-pressed"), "true");
  assert.equal($("#show-pick").value, "mcp", "the header's dropdown follows");
  assert.ok($$("#cat .item").length === 56 && !$("#cat .item.k-skill"));
  tabTo("skills");
  assert.equal($('[data-show="skills"]').getAttribute("aria-pressed"), "true", "and the tabs follow the dropdown");
  assert.ok($$("#cat .item").length === 153 && !$("#cat .item.k-mcp"));
  const q = $("#q");
  q.value = "sentry"; q.dispatchEvent(new window.Event("input"));
  assert.ok(+$('[data-show="mcp"] small').textContent >= 1 && +$('[data-show="all"] small').textContent < 209, "the counts follow the search");
  q.value = "linear"; q.dispatchEvent(new window.Event("input"));
  if (!$("#cat .item")) { click($("#cat .empty [data-show]")); assert.ok($("#cat .item.k-mcp"), "an empty tab points at the one that has the match"); }
  q.value = ""; q.dispatchEvent(new window.Event("input"));
  click($('[data-show="all"]'));
});


test("the agent selector is a dropdown in the header: All agents by default, then the five agents", () => {
  const btn = $("#agent-btn"), opts = $$("#agent-opts [role=option]");
  assert.deepEqual(opts.map((o) => o.querySelector(".dd-nm").textContent), ["All agents", "Claude Code", "Codex CLI", "Gemini CLI", "Cursor", "VS Code + Copilot"]);
  assert.equal(opts[0].getAttribute("aria-selected"), "true");
  assert.equal($("#agent-main").textContent, "All agents");
  assert.equal($$("#agent-logos .ico").length, 5, "all five logos show while All is chosen");
  assert.equal(btn.getAttribute("aria-haspopup"), "listbox");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.ok($("#agent-list").hidden, "closed to start with");
  assert.equal($("#agent-opts").getAttribute("aria-multiselectable"), "true");
  assert.match($("#agent-head").textContent, /Which agents\?.*Leave on “All” to tool up every agent the script finds/);
  assert.match($("#agent-flag").textContent, /No --to/);
});

test("the dropdown opens and closes; you can pick several agents without it closing", () => {
  const btn = $("#agent-btn"), list = $("#agent-list");
  click(btn);
  assert.ok(!list.hidden);
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  click($('[data-tgt="claude-code"]')); click($('[data-tgt="gemini"]'));
  assert.ok(!list.hidden, "stays open while you pick");
  assert.equal($("#agent-main").textContent, "Claude Code + Gemini CLI");
  assert.equal($("#agent-flag").textContent, "--to claude-code,gemini");
  assert.equal($("#agent-btn").title, "--to claude-code,gemini");
  assert.equal($$("#agent-logos .ico").length, 2);
  assert.equal($('[data-tgt="gemini"]').getAttribute("aria-selected"), "true");
  assert.equal($("[data-all]").getAttribute("aria-selected"), "false");
  click(window.document.body);
  assert.ok(list.hidden, "a click outside closes it");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  click($("[data-all]"));
  assert.equal($("#agent-main").textContent, "All agents");
});

test("the dropdown works from the keyboard: arrows move, Escape closes and gives focus back", () => {
  const btn = $("#agent-btn"), key = (el, k) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  btn.focus();
  key(btn, "ArrowDown");
  assert.ok(!$("#agent-list").hidden);
  const opts = $$("#agent-opts [role=option]");
  assert.equal(window.document.activeElement, opts[0], "focus lands on the chosen option");
  key(opts[0], "ArrowDown");
  assert.equal(window.document.activeElement, opts[1]);
  key(opts[1], "End");
  assert.equal(window.document.activeElement, opts[5]);
  key(opts[5], "ArrowDown");
  assert.equal(window.document.activeElement, opts[0], "it wraps");
  key(opts[0], "Escape");
  assert.ok($("#agent-list").hidden);
  assert.equal(window.document.activeElement, btn);
});

test("six packs, 56 servers and 153 skills are listed from the catalog", () => {
  assert.equal($$(".pack").length, 6);
  assert.equal($$("#cat .item.k-mcp").length, 56);
  tabTo("skills");
  assert.equal($$("#cat .item.k-skill").length, 153);
  assert.match($('[data-tab="mcp"]').textContent, /56/);
  assert.match($('[data-tab="skills"]').textContent, /153/);
  tabTo("mcp");
});

test("an empty selection gives no command and disables the buttons", () => {
  assert.match(cmd(), /^Pick servers or skills/);
  for (const b of ["copy", "view", "dl", "link"]) assert.ok($("#" + b).disabled, b);
});

test("picking items builds the line; ids come out in catalog order, not click order", () => {
  pick("tdd", "sentry", "github", "grill-me", "frontend-design");
  assert.equal(cmd(), "curl -fsSL toolup.sh | bash -s -- github sentry grill-me tdd frontend-design");
  assert.equal(card("tdd").getAttribute("aria-pressed"), "true");
  assert.match($("#count").textContent, /^2 servers · 3 skills → all your agents$/);
  assert.ok(!$("#copy").disabled);
});

test("Review lists what's picked, lets you remove items live, and clears all", () => {
  click($("#clear"));
  assert.ok($("#review").disabled);
  pick("github", "tdd");
  assert.ok(!$("#review").disabled);
  assert.ok($("#drawer").hidden, "the list starts closed");
  click($("#review"));
  assert.ok(!$("#drawer").hidden);
  assert.equal($("#review").getAttribute("aria-expanded"), "true");
  assert.equal($$("#drawer .chip").length, 2);
  assert.match($("#drawer").textContent, /GitHub/);
  click($('#drawer [data-rm="tdd"]'));
  assert.equal($$("#drawer .chip").length, 1);
  assert.ok(!$("#drawer").hidden, "it stays open while you take things out");
  assert.equal(card("tdd").getAttribute("aria-pressed"), "false");
  click($("#drawer [data-rmall]"));
  assert.ok($("#drawer").hidden, "and closes when nothing is left");
  assert.match(cmd(), /^Pick servers or skills/);
  pick("tdd", "sentry", "github", "grill-me", "frontend-design");   // the next tests build on this selection
});

test("choosing specific agents adds --to, and going back to All removes it", () => {
  click($('[data-tgt="claude-code"]')); click($('[data-tgt="cursor"]'));
  assert.match(cmd(), / --to claude-code,cursor$/);
  assert.match($("#count").textContent, /→ Claude Code, Cursor$/);
  click($("[data-all]"));
  assert.doesNotMatch(cmd(), /--to/);
  assert.equal($("[data-all]").getAttribute("aria-selected"), "true");
});

test("the --dry-run flag edits the line, and there is no Docker switch on the page", () => {
  click($("#dryflag")); assert.match(cmd(), / --dry-run$/); assert.equal($("#dryflag").getAttribute("aria-pressed"), "true");
  click($("#dryflag"));
  assert.doesNotMatch(cmd(), /--docker|--dry-run/);
  assert.equal($("#dock"), null, "no Docker switch in the bar");
  assert.ok(!/Docker/.test($("#faq").textContent) || !/Run servers in Docker/.test($("#faq").textContent), "no FAQ entry for it");
});

test("Copy command and Copy link put the right text on the clipboard", async () => {
  click($("#copy")); await wait();
  assert.equal(window.__copied, cmd());
  click($("#link")); await wait();
  assert.match(window.__copied, /^http:\/\/localhost:3000\/#e-/);
});

test("the share link restores the selection", async () => {
  click($("#clear"));
  assert.match(cmd(), /^Pick/);
  pick("github", "tdd", "notion");
  const link = window.location.hash;
  assert.match(link, /^#e-gh-/);
  const was = cmd();
  await boot(link);
  assert.equal(cmd(), was);
  assert.equal(card("tdd").getAttribute("aria-pressed"), "true");
  assert.ok(link.split("-").every((k) => !/[A-Z]/.test(k)) && !/grill|sentry/.test(link), "short codes, not names");
});

test("a pack pre-selects its servers and skills", async () => {
  await boot();
  click($$(".pack")[0]);
  assert.match(cmd(), /grill-me .*tdd/);
  await boot();
  click($$(".pack").find((p) => p.querySelector("b").textContent === "Ship & monitor"));
  assert.match(cmd(), /github sentry vercel posthog pagerduty circleci gh-fix-ci deploy-to-vercel$/, "catalog order, whatever order the pack lists them in");
});

test("search finds servers and skills together, and says when nothing matches", () => {
  const q = $("#q");
  q.value = "postgres"; q.dispatchEvent(new window.Event("input"));
  const ids = $$(".item").map((i) => i.dataset.id);
  assert.ok(ids.includes("supabase") && ids.includes("neon-postgres") && ids.includes("supabase-postgres-best-practices"), ids.join());
  q.value = "zzzzqqq"; q.dispatchEvent(new window.Event("input"));
  assert.match($("#cat").textContent, /Nothing matches/);
  q.value = ""; q.dispatchEvent(new window.Event("input"));
  assert.equal($$(".item").length, 209, "back to the tab view: the All tab shows servers and skills");
  assert.equal($("#show-pick").value, "all");
});

test("MCP cards carry the tags: remote, oauth", () => {
  const tags = (id) => [...card(id).querySelectorAll(".tag")].map((t) => t.textContent);
  assert.deepEqual(tags("github"), ["remote", "oauth"]);
  assert.deepEqual(tags("context7"), ["remote"]);
  assert.deepEqual(tags("tldraw"), ["remote"], "a server that needs no sign-in is just remote");
  assert.deepEqual(tags("sentry"), ["remote", "oauth"]);
});

test("skill cards show owner/repo, an install count and the Helmcode badge", () => {
  const withCounts = catalog.skills.filter((s) => s.installs);
  assert.ok(withCounts.length > 0, "run npm run installs to fill the counts");
  const s = withCounts[0];
  assert.match(card(s.id).textContent, /\d+(\.\d)?[KM] installs/);
  assert.match(card("tdd").querySelector(".by").textContent, /^mattpocock\/skills$/);
  for (const id of ["finops", "building-a-beatdeck", "remotion-product-video"]) assert.ok([...card(id).querySelectorAll(".tag.h")].some((t) => t.textContent === "helmcode"), id);
  assert.equal($$(".tag.h").length, 3);
});

test("a skill's details show its whole family, each addable, plus Add all", async () => {
  await boot();
  tabTo("skills");
  assert.equal($$(".repo, .repos").length, 0, "no repo strip above the skills");
  click($('[data-info="tdd"]'));
  assert.match($("#sheet .fam h4").textContent, /mattpocock\/skills family/);
  const ids = $$("#sheet .fam [data-ftog]").map((b) => b.dataset.ftog);
  assert.ok(ids.length >= 11 && ids.includes("tdd") && ids.includes("grill-me"));
  assert.ok($("#sheet .fam li.cur .fam-open").dataset.info === "tdd", "the current one is marked");
  click($('#sheet [data-ftog="grill-me"]'));
  assert.ok($("#scrim").classList.contains("show"), "the sheet stays open");
  assert.equal(card("grill-me").getAttribute("aria-pressed"), "true");
  assert.equal($('#sheet [data-ftog="grill-me"]').textContent, "✓ Added");
  click($("#sheet [data-fall]"));
  assert.ok(ids.every((i) => card(i).getAttribute("aria-pressed") === "true"));
  assert.match($("#sheet [data-fall]").textContent, /^Remove all/);
  click($("#sheet [data-fall]"));
  assert.ok(ids.every((i) => card(i).getAttribute("aria-pressed") === "false"));
  click($('#sheet .fam-open[data-info="grill-me"]'));
  assert.match($("#sheet-title").textContent, /Grill Me/);
  click($("[data-close]"));
});

test("servers from one publisher show a family too; a lone one doesn't", () => {
  tabTo("mcp");
  click($('[data-info="context7"]'));
  assert.match($("#sheet .fam h4").textContent, /Upstash family/);
  assert.ok($$("#sheet .fam [data-ftog]").some((b) => b.dataset.ftog === "upstash"));
  click($("[data-close]"));
  click($('[data-info="stripe"]'));
  assert.equal($("#sheet .fam"), null);
  click($("[data-close]"));
});

test("one row of categories, the same for servers and skills, filters both lists", () => {
  tabTo("all");
  const rows = $$("#cat .cats");
  assert.equal(rows.length, 1, "a single category row, not one per list");
  const names = $$("#cat .cats .cat").map((c) => c.childNodes[0].textContent.trim());
  assert.deepEqual(names, ["All", ...Object.values(catalog.categories)]);
  click($('.cat[data-cat="work"]'));
  const inWork = (list, i) => list.find((x) => x.id === i.dataset.id).cats.includes("work");
  const skillItems = $$("#cat .item.k-skill"), serverItems = $$("#cat .item.k-mcp");
  assert.ok(skillItems.length > 0 && skillItems.every((i) => inWork(catalog.skills, i)), "skills are filtered by the category");
  assert.ok(serverItems.length > 0 && serverItems.every((i) => inWork(catalog.mcp, i)), "and so are servers, by the same category");
  assert.ok(serverItems.some((i) => i.dataset.id === "linear") && skillItems.some((i) => i.dataset.id === "brainstorming"));
  click($('.cat[data-cat=""]'));
});

test("a server in several categories shows under each", () => {
  const ids = () => $$("#cat .item.k-mcp").map((i) => i.dataset.id);
  click($('[data-cat="test"]'));
  assert.ok(ids().includes("sentry"), "Sentry is under Testing");
  const inTest = ids().join();
  click($('[data-cat="cloud"]'));
  assert.ok(ids().includes("sentry"), "and under Cloud too");
  assert.notEqual(ids().join(), inTest);
  click($('[data-cat=""]'));
  assert.equal(ids().length, 56);
});

test("MCP details show transport, URL and the exact wiring for every agent", () => {
  tabTo("mcp");
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
  tabTo("mcp");
  click($('[data-tgt="gemini"]'));
  click($('[data-info="sentry"]'));
  const sheet = $("#sheet").textContent;
  assert.match(sheet, /gemini mcp add -s user -t http sentry https:\/\/mcp\.sentry\.dev\/mcp/);
  assert.doesNotMatch(sheet, /claude mcp add/);
  click($("[data-close]")); click($("[data-all]"));
});

test("skill details show the repo link and the npx skills add line", () => {
  tabTo("skills");
  click($('[data-info="tdd"]'));
  assert.equal($("#sheet a").getAttribute("href"), "https://github.com/mattpocock/skills");
  assert.match($("#sheet").textContent, /npx skills add mattpocock\/skills --skill tdd -g/);
  click($("[data-close]"));
});

test("the details sheet is a dialog: Escape closes it and focus goes back to where it was", () => {
  tabTo("mcp");
  const btn = $('[data-info="github"]'); btn.focus();
  click(btn);
  assert.equal($("#sheet").getAttribute("role"), "dialog");
  assert.ok($("#scrim").classList.contains("show"));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!$("#scrim").classList.contains("show"));
  assert.equal(window.document.activeElement, btn);
});

test("toggling a card keeps keyboard focus on it", () => {
  const c = card("notion"); c.focus(); click(c);
  assert.equal(window.document.activeElement, c);
  click(c);
});

test("every control is a real button, input or link, and none is nested inside another", () => {
  assert.equal($$("[onclick], div[role=button], span[role=button]").length, 0);
  assert.equal($$("button button, a button, button a").length, 0);
  for (const b of $$("button")) assert.ok(b.textContent.trim() || b.getAttribute("aria-label"), `unlabelled button ${b.outerHTML.slice(0, 60)}`);
  assert.ok($("#q").getAttribute("aria-label"));
});

test("light and dark: tokens exist for both, and one toolbar button switches between them", () => {
  const css = read("style.css");
  assert.match(css, /prefers-color-scheme:dark/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /--accent:#[0-9a-f]{6}/, "an accent colour is defined");
  const root = window.document.documentElement;
  assert.equal($$("header .theme").length, 1, "a single button, not a three-way switch");
  assert.ok($("#theme .i-moon") && $("#theme .i-sun"), "with real sun and moon icons");
  click($("#theme"));
  assert.equal(root.dataset.theme, "dark");
  click($("#theme"));
  assert.equal(root.dataset.theme, "light");
  click($("#theme"));
  assert.equal(root.dataset.theme, "dark");
});

test("the toolbar has the search, a categories picker and the theme button, and no captions or pack picker", () => {
  const tb = $("header");
  assert.ok(tb.querySelector("#q") && tb.querySelector("#cat-pick") && tb.querySelector("#theme"));
  assert.equal(tb.querySelector("#pack-pick"), null, "starter packs live in section 01, not in the toolbar");
  assert.equal(tb.querySelector(".tb-cap"), null, "no captions above the pickers");
  assert.equal($("#cat-pick").getAttribute("aria-label"), "Categories", "but the picker is still named for screen readers");
  tabTo("all");
  const cp = $("#cat-pick"); cp.value = "test"; cp.dispatchEvent(new window.Event("change"));
  assert.equal($("#show-pick").value, "all", "the category filters both lists, it does not switch lists");
  assert.ok($$("#cat .item.k-mcp").length < 20 && $$("#cat .item.k-skill").length < 30);
  assert.equal($('[data-cat="test"]').getAttribute("aria-pressed"), "true", "and the chip row agrees");
  cp.value = ""; cp.dispatchEvent(new window.Event("change"));
  assert.equal($('[data-cat=""]').getAttribute("aria-pressed"), "true");
  tabTo("all");
});

test("it works at phone width: viewport meta, no fixed widths over the viewport", () => {
  assert.match(read("index.html"), /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(read("style.css"), /@media \(max-width:639px\)/);
});

test("the FAQ answers the questions the brief lists", () => {
  const q = $$(".faq summary").map((s) => s.textContent);
  for (const re of [/actually do/, /install the agents/, /safe/, /tokens/, /re-running/, /remove/, /skills picked/]) assert.ok(q.some((t) => re.test(t) || re.test(t.toLowerCase())), String(re));
  assert.match($("#faq").innerHTML, /href="https:\/\/getem\.sh\/"/);
});

// ---- the script the page hands out

test("Download .sh builds a self-contained script with the selection baked in", async () => {
  await boot();
  pick("github", "tdd", "linear"); click($('[data-tgt="claude-code"]'));
  click($("#dl")); await wait(50);
  assert.equal(window.__download, "toolup.sh");
  const blob = downloads.at(-1);
  const sh = await new Promise((res) => { const r = new window.FileReader(); r.onload = () => res(r.result); r.readAsText(blob); });
  assert.match(sh, /^#!\/bin\/bash/);
  assert.match(sh, /EMBEDDED=1\nDEFAULT_IDS="github linear tdd"\nDEFAULT_TO="claude-code"\nDEFAULT_DOCKER=0/);
  assert.match(sh, /^mcp\tgithub\t/m);
  assert.doesNotMatch(sh, /@@EMBED_START@@ \(downloaded/);
});

test("the downloaded script runs offline with no arguments and does what the page said", async () => {
  await boot();
  pick("github", "sentry", "tdd"); click($('[data-tgt="claude-code"]')); click($('[data-tgt="gemini"]'));
  const sh = await window.ToolUp.script();
  const m = machine();
  const { writeFileSync } = await import("node:fs");
  const file = join(m.dir, "toolup.sh"); writeFileSync(file, sh);
  const { spawnSync } = await import("node:child_process");
  const run = (...a) => spawnSync("bash", [file, ...a], { encoding: "utf8", env: { PATH: `${m.dir}/bin:${process.env.PATH}`, HOME: m.home, STUB_STATE: m.state, NO_COLOR: "1", CATALOG_URL: "http://127.0.0.1:9/never" } });
  const { spawnSync: sp } = await import("node:child_process");
  assert.equal(sp("bash", ["-n", file]).status, 0, "downloaded script is valid bash");
  if (!sp("shellcheck", ["--version"]).error) assert.equal(sp("shellcheck", ["-s", "bash", file], { encoding: "utf8" }).status, 0, "downloaded script passes shellcheck");
  const dry = run("--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /claude mcp add --scope user --transport http github/);
  assert.match(dry.stdout, /gemini mcp add -s user -t http sentry https:\/\/mcp\.sentry\.dev\/mcp/);
  assert.doesNotMatch(dry.stdout, /codex mcp add|--add-mcp|cursor/);
  assert.equal(run().status, 0);
  assert.ok(m.calls().some((c) => /skills add mattpocock\/skills -g -y -a claude-code -a gemini-cli --skill tdd/.test(c)), m.calls().join("\n"));
});

// What the page shows for a server is what the installer runs. Checked on the real catalog (remote servers) and, because the
// installer still supports local ones (npx / uvx), on a few of those from the test catalog.
function wiringMatches(m, items) {
  const ran = lines(m.run("--dry-run", ...items.map((x) => x.id)).out, "→").map((l) => l.replaceAll(m.home, "$HOME"));
  for (const a of catalog.agents) {
    for (const x of items) {
      const shown = window.ToolUp.wire(a.id, x);
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
}
test("the wiring commands the page shows are the ones the installer runs, for every agent and every server", () => {
  wiringMatches(machine(undefined, { real: true }), catalog.mcp);
  const local = [
    { id: "playwright", transport: "stdio", cmd: "npx -y @playwright/mcp@latest", needs: ["node"] },
    { id: "fetch", transport: "stdio", cmd: "uvx mcp-server-fetch", needs: ["uv"] },
    { id: "filesystem", transport: "stdio", cmd: "npx -y @modelcontextprotocol/server-filesystem $HOME", needs: ["node"] },
  ];
  wiringMatches(machine(), local);
});

test("every server and agent chip shows an inline logo, not initials", async () => {
  await boot();
  const noIcon = (sel) => $$(sel).filter((el) => !el.querySelector(".ico svg path, .ico svg g")).map((el) => el.dataset.id || el.dataset.repo || el.dataset.tgt);
  assert.deepEqual(noIcon("#cat .item.k-mcp"), []);
  assert.deepEqual(noIcon("[data-tgt]"), []);
  assert.equal($$("#cat .item.k-mcp .ico").length, 56);
  assert.ok(!$$(".ico").some((i) => /^[A-Za-z]{2}$/.test(i.textContent)), "no two-letter placeholders");
});

test("skills are cards like servers; a brand owner shows its logo, anyone else an initial tile, never one generic mark twenty times", () => {
  tabTo("skills");
  assert.ok(!$("#cat .grid").classList.contains("list"));
  for (const id of ["frontend-design", "find-skills", "supabase-postgres-best-practices", "prisma-cli", "gh-fix-ci"]) assert.ok(card(id).querySelector(".top .ico svg"), `${id} should carry its owner's logo`);
  for (const id of ["tdd", "grill-me", "brainstorming", "caveman"]) { const t = card(id).querySelector(".top .ico.initial"); assert.ok(t, `${id} has no brand owner: an initial tile`); assert.equal(t.textContent, card(id).querySelector(".nm").textContent[0].toUpperCase()); }
  assert.equal($$("#cat .item.k-skill .ico svg path[d^='M12 .297']").length, 0, "the GitHub mark is not used as a skill logo");
});

test("a server whose publisher is its own name doesn't say it twice", () => {
  assert.equal(card("github").querySelector(".by"), null);
  assert.equal(card("context7").querySelector(".by").textContent, "Upstash");
});

test("each pack shows the logos of the servers inside it", () => {
  const frontend = $$(".pack").find((p) => p.querySelector("b").textContent === "Frontend");
  assert.ok(frontend.querySelectorAll(".pk-logos .ico").length >= 4);
  assert.match(frontend.querySelector(".more").textContent, /5 skills|\d+ skills?/);
});

test("logos and providers", () => {
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

test("an added pack is marked as added, and clicking it again takes it back out", async () => {
  await boot();
  const kit = (name) => $$(".pack").find((p) => p.querySelector("b").textContent === name);
  const frontend = kit("Frontend");
  assert.equal(frontend.getAttribute("aria-pressed"), "false");
  assert.equal(frontend.querySelector(".cta-t").textContent, "Add pack");
  click(frontend);
  assert.equal(frontend.getAttribute("aria-pressed"), "true");
  assert.ok(frontend.classList.contains("done"));
  assert.equal(frontend.querySelector(".cta-t").textContent, "Added");
  assert.ok(!kit("Backend").classList.contains("done"), "other packs are untouched");
  assert.match(cmd(), /github context7 figma vercel .*frontend-design/);
  click(frontend);
  assert.equal(frontend.getAttribute("aria-pressed"), "false");
  assert.ok(!frontend.classList.contains("done"));
  assert.match(cmd(), /^Pick servers or skills/, "the pack's picks are gone again");
});

test("a pack stops looking added as soon as one of its picks is removed by hand", async () => {
  await boot();
  const frontend = $$(".pack").find((p) => p.querySelector("b").textContent === "Frontend");
  click(frontend);
  assert.ok(frontend.classList.contains("done"));
  click(card("impeccable"));
  assert.ok(!frontend.classList.contains("done"));
  assert.equal(frontend.getAttribute("aria-pressed"), "false");
});

test("on a phone the menu button opens the links, and a link, Escape or a tap elsewhere closes it", async () => {
  await boot();
  const hdr = $("header"), btn = $("#menu-btn");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(btn.getAttribute("aria-controls"), "site-nav");
  click(btn);
  assert.ok(hdr.classList.contains("open"));
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  tabTo("skills");
  assert.ok(!hdr.classList.contains("open"), "choosing in the dropdown closes the panel");
  tabTo("all");
  click(btn); assert.ok(hdr.classList.contains("open"));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!hdr.classList.contains("open"), "Escape closes it");
  assert.equal(window.document.activeElement, btn);
  click(btn); click(window.document.body);
  assert.ok(!hdr.classList.contains("open"), "a tap elsewhere closes it");
});

test("long lists: the header filters show one list at a time (or all), 24 cards per page with Show more", async () => {
  await boot("", 24);
  assert.equal($$("#show-pick option").length, 3);
  assert.equal($("#show-pick").value, "all", "All is the first option and the default");
  assert.equal($$("#cat .item").length, 24, "All pages as one list");
  assert.match($("[data-more=all]").textContent, /Show 24 more/);
  assert.match($('[data-tab="all"]').textContent, /209/);
  tabTo("mcp");
  assert.equal($("#show-pick").value, "mcp");
  assert.equal($$("#cat .item.k-mcp").length, 24);
  assert.match($("[data-more=mcp]").textContent, /Show 24 more/);
  click($("[data-more=mcp]"));
  assert.equal($$("#cat .item.k-mcp").length, 48);
  click($("[data-more=mcp]"));
  assert.equal($$("#cat .item.k-mcp").length, 56);
  assert.equal($("[data-more=mcp]"), null, "nothing left to show");
  click($('[data-cat="test"]'));
  assert.ok($$("#cat .item.k-mcp").length < 24 && !$("[data-more=mcp]"), "a filter starts from the first page again");
  click($('[data-cat=""]'));
  tabTo("skills");
  assert.equal($("#show-pick").value, "skills");
  assert.equal($$("#cat .item.k-skill").length, 24);
  await boot();
});

test("the folder at the bottom right shows the picks: stacked pages, a count, and it opens the vertical list", () => {
  click($("#clear"));
  assert.ok($(".bar-in > #review.folder"), "the folder sits in the bar, to the right");
  assert.ok($("#review").disabled && $("#fo-n").textContent === "0 picks");
  assert.match(read("style.css"), /\.folder:disabled\{display:none/, "an empty folder is not shown at all");
  pick("github");
  assert.equal($$("#fo-pages .fo-page").length, 1);
  pick("tdd", "sentry", "grill-me");
  assert.equal($$("#fo-pages .fo-page").length, 4, "every pick up to five shows its logo");
  pick("vercel", "stripe");
  assert.equal($$("#fo-pages .fo-page").length, 5, "at most five logos");
  assert.equal($(".fo-more").textContent, "+1", "the picks that do not fit are counted");
  assert.equal($("#fo-n").textContent, "6 picks");
  assert.equal($("#fo-sub").textContent, "4 MCPs · 2 skills");
  click($("#review"));
  assert.deepEqual($$("#chips li.lbl").map((l) => l.textContent.replace(/\s+/g, " ").trim()), ["Servers 4", "Skills 2"]);
  const outside = $("#h-packs"); click(outside);
  assert.ok($("#drawer").hidden, "a click elsewhere closes it");
  click($("#review"));
  $("#review").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok($("#drawer").hidden, "Escape closes it");
  click($("#clear"));
  assert.equal($("#fo-n").textContent, "0 picks");
  pick("tdd", "sentry", "github", "grill-me", "frontend-design");   // the next tests build on this selection
});

test("the picks drawer lets you choose the agents, in step with the hero's dropdown and the command", () => {
  click($("#clear")); click($('[data-all]'));
  pick("github");
  click($("#review"));
  assert.equal($$("#dr-agents [data-dtgt]").length, 5);
  assert.equal($("[data-dall]").getAttribute("aria-pressed"), "true", "All by default");
  click($('[data-dtgt="claude-code"]')); click($('[data-dtgt="codex"]'));
  assert.match(cmd(), / --to claude-code,codex$/);
  assert.equal($('[data-dtgt="codex"]').getAttribute("aria-pressed"), "true");
  assert.equal($("[data-dall]").getAttribute("aria-pressed"), "false");
  assert.equal($('[data-tgt="codex"]').getAttribute("aria-selected"), "true", "the hero dropdown agrees");
  assert.match($("#count").textContent, /→ Claude Code, Codex$/);
  click($("[data-dall]"));
  assert.doesNotMatch(cmd(), /--to/);
  assert.ok(!$("#drawer").hidden, "the drawer stays open while you edit");
  click($("#drawer-close"));
  click($("#clear"));
  pick("tdd", "sentry", "github", "grill-me", "frontend-design");   // the next tests build on this selection
});

test("the header's dropdowns have an icon on every option, open on click, pick on click and close with Escape or a click outside", () => {
  const order = $$("#site-nav > *").map((e) => e.id || e.dataset.dd || e.className);
  assert.deepEqual([order[0], order[1], order[2]], ["tb-search", "show-pick", "cat-pick"], "search first, then All, then Categories");
  for (const id of ["show-pick", "cat-pick"]) {
    const root = $(`[data-dd="${id}"]`), btn = root.querySelector(".dd2-btn"), list = root.querySelector(".dd2-list");
    assert.ok(list.hidden);
    click(btn);
    assert.ok(!list.hidden && btn.getAttribute("aria-expanded") === "true");
    const opts = [...list.querySelectorAll(".dd2-opt")];
    assert.ok(opts.length >= 3 && opts.every((o) => o.querySelector("svg path, svg rect, svg circle")), `${id}: an icon on every option`);
    click(window.document.body);
    assert.ok(list.hidden, "a click outside closes it");
    click(btn);
    list.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.ok(list.hidden, "Escape closes it");
  }
  assert.equal($('[data-dd="show-pick"] .dd2-lbl').textContent, "All", "the button says it short");
  assert.match($('[data-dd="show-pick"] .dd2-opt[data-v="all"]').textContent, /All · 209/, "the list has the counts");
  click($('[data-dd="show-pick"] .dd2-btn'));
  click($('[data-dd="show-pick"] .dd2-opt[data-v="skills"]'));
  assert.equal($("#show-pick").value, "skills", "picking in the list sets the real value");
  assert.equal($('[data-dd="show-pick"] .dd2-lbl').textContent, "Skills");
  assert.ok($('[data-dd="show-pick"] .dd2-list').hidden, "and closes the list");
  click($('[data-dd="cat-pick"] .dd2-btn'));
  click($('[data-dd="cat-pick"] .dd2-opt[data-v="cloud"]'));
  assert.equal($('[data-dd="cat-pick"] .dd2-lbl').textContent, "Cloud, data & deploy");
  assert.equal($('[data-cat="cloud"]').getAttribute("aria-pressed"), "true", "the chip row agrees");
  click($('[data-dd="cat-pick"] .dd2-btn')); click($('[data-dd="cat-pick"] .dd2-opt[data-v=""]'));
  tabTo("all");
});

test("each header dropdown has a clear button that shows only while it filters, and puts it back to its default", () => {
  tabTo("all");
  const x = (id) => $(`[data-dd="${id}"] .dd2-x`);
  assert.ok(x("show-pick").hidden && x("cat-pick").hidden, "nothing to clear at the defaults");
  tabTo("skills");
  assert.ok(!x("show-pick").hidden, "filtering to Skills can be cleared");
  click(x("show-pick"));
  assert.equal($("#show-pick").value, "all");
  assert.ok(x("show-pick").hidden);
  assert.equal($('[data-dd="show-pick"] .dd2-lbl').textContent, "All");
  const cp = $("#cat-pick"); cp.value = "cloud"; cp.dispatchEvent(new window.Event("change"));
  assert.ok(!x("cat-pick").hidden);
  assert.equal($('[data-cat="cloud"]').getAttribute("aria-pressed"), "true");
  click(x("cat-pick"));
  assert.equal($("#cat-pick").value, "");
  assert.equal($('[data-cat=""]').getAttribute("aria-pressed"), "true", "the chip row goes back to All too");
  assert.ok(x("cat-pick").hidden);
  assert.ok($('[data-dd="cat-pick"] .dd2-list').hidden, "clearing does not open the list");
});

test("servers and skills are listed by name, A to Z, while the command keeps catalog order", () => {
  tabTo("all");
  const sorted = (arr) => [...arr].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  const names = (sel) => $$(sel).map((i) => i.querySelector(".nm").textContent);
  const servers = names("#cat .item.k-mcp"), skills = names("#cat .item.k-skill");
  assert.deepEqual(servers, sorted(servers), "servers by name");
  assert.deepEqual(skills, sorted(skills), "skills by name");
  assert.equal(servers[0], "Ahrefs");
  click($("#clear"));
  pick("sentry", "github", "figma");
  assert.match(cmd(), /github figma sentry/, "the command still follows catalog order");
  click($("#review"));
  const listed = $$("#chips li.chip b").map((b) => b.textContent);
  assert.deepEqual(listed, ["Figma", "GitHub", "Sentry"], "the picks list is by name too");
  click($("#drawer-close"));
  click($("#clear"));
  pick("tdd", "sentry", "github", "grill-me", "frontend-design");   // the next tests build on this selection
});

test("Copy command is one split button: its menu holds Copy link, Download and Preview, and the whole bar is one row", async () => {
  click($("#clear"));
  assert.ok($("#more").disabled && $("#copy").disabled, "nothing to copy yet");
  pick("github", "tdd");
  assert.ok(!$("#more").disabled);
  const menu = $("#more-menu");
  assert.ok(menu.hidden);
  assert.ok(menu.contains($("#dl")) && menu.contains($("#view")), "Download and Preview live in the menu");
  assert.ok($(".split").contains($("#copy")) && menu.contains($("#link")), "Copy link is in the menu too: one button, three ways to get it");
  assert.ok($(".term .cmd").contains($(".split")), "the button sits inside the terminal, on the command line");
  click($("#more"));
  assert.ok(!menu.hidden && $("#more").getAttribute("aria-expanded") === "true");
  assert.equal(window.document.activeElement, $("#link"), "focus goes to the first item");
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(menu.hidden && window.document.activeElement === $("#more"), "Escape closes it and gives focus back");
  click($("#more")); click(window.document.body);
  assert.ok(menu.hidden, "a click outside closes it");
  click($("#more")); click($("#view")); await wait(60);
  assert.ok(menu.hidden, "choosing an item closes the menu");
  assert.ok($("#scrim").classList.contains("show"), "and does what it says");
  click($("[data-close]"));
  assert.equal($(".bar-main"), null, "no stacked rows any more");
  click($("#clear"));
  pick("tdd", "sentry", "github", "grill-me", "frontend-design");   // the next tests build on this selection
});

test("with nothing picked there is no bottom bar at all; it appears with the first pick and goes away with the last", () => {
  click($("#clear"));
  assert.ok($(".bar").hidden, "no bar, no disabled buttons, no empty command");
  assert.ok(!window.document.body.classList.contains("has-bar"));
  pick("github");
  assert.ok(!$(".bar").hidden && window.document.body.classList.contains("has-bar"));
  assert.match(cmd(), /github$/);
  pick("github");
  assert.ok($(".bar").hidden, "taking the last one out hides it again");
  click($("#clear"));
  pick("tdd", "sentry", "github", "grill-me", "frontend-design");   // the next tests build on this selection
});

test("the logo is near-black in the light theme and white in the dark one", () => {
  const css = read("style.css");
  assert.match(css, /\.logo\{[^}]*color:#4a4a54/, "dark on light");
  assert.match(css, /data-theme="dark"\] \.logo\{color:#e2e2ea\}/, "soft white on dark");
});

test("the agents dropdown opens where there is room: below by default, above when below is tight, and never taller than its room", () => {
  const btn = $("#agent-btn"), m = $("#agent-list");
  const place = (top, bottom, height, innerH) => {
    Object.defineProperty(window, "innerHeight", { value: innerH, configurable: true });
    btn.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top });
    Object.defineProperty(m, "scrollHeight", { value: height, configurable: true });
    window.ToolUp.placeMenu(btn, m);
  };
  place(200, 240, 420, 900);
  assert.ok(!m.classList.contains("up"), "plenty of room below: down");
  place(700, 740, 420, 800);
  assert.ok(m.classList.contains("up"), "the button is near the bottom: up");
  assert.ok(parseInt(m.style.maxHeight) <= 700 - 65, "and it fits under the header");
  place(120, 160, 900, 700);
  assert.ok(parseInt(m.style.maxHeight) >= 180, "tight on both sides: still usable, and it scrolls");
  assert.ok(!m.classList.contains("up") || parseInt(m.style.maxHeight) > 0);
});
