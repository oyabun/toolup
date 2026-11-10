/* Tool up! — the picker. Reads catalog.json (built from catalog/*.json); nothing about servers or skills lives here. */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let C, ALL = {}, BYK = {};
  let sel = new Set(), dock = false, dry = false, q = "", fcat = "", tab = "all";
  const PAGE = window.KITEM_PAGE || 24, pageOf = { mcp: PAGE, skills: PAGE };   // two long lists: 24 cards at a time, "Show more" for the rest
  let lastFocus = null;
  const cache = {};

  const SECTIONS = [
    ["mcp", "MCP servers", "Registered with each agent you tool up"],
    ["skills", "Skills", "Installed into every agent you tool up, with the open skills CLI"],
  ];

  /* ---------- catalog helpers ---------- */
  const secOf = (id) => ALL[id].sec;
  const ofSec = (s) => C[s].filter((x) => sel.has(x.id));
  const kit = () => [...ofSec("mcp"), ...ofSec("skills")].map((x) => x.id);   // catalog order, so the line is the same however you picked
  const agentsPicked = () => ofSec("agents").map((x) => x.id);
  const fmt = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
  const repoMeta = (r) => C.repos.find((x) => x.repo === r) || {};

  function tagsFor(x) {
    if (x.sec === "mcp") {
      const t = [x.transport === "http" ? "remote" : "local"];
      if (x.auth === "oauth") t.push("oauth");
      (x.needs || []).forEach((n) => t.push(`needs ${n}`));
      return t;
    }
    const t = [];
    if (repoMeta(x.repo).badge) t.push(repoMeta(x.repo).badge);
    if (x.installs) t.push(`${fmt(x.installs)} installs`);
    return t;
  }
  const tagClass = (t) => (t === "docker" ? "d" : /installs$/.test(t) ? "i" : t === "helmcode" ? "h" : "");

  /* ---------- icons: brand logos (Simple Icons) or a Lucide glyph, white or dark on the brand colour ---------- */
  const light = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 170; };
  function ico(x, cls = "") {
    const i = x.icon;
    // Lobe Icons (AI providers) carry their own colours, so they sit on a light tile in either theme
    if (i.svg) return `<span class="ico brand ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${i.svg}</svg></span>`;
    const fg = light(i.color) ? "#16161a" : "#fff";
    const glyph = i.path
      ? `<path d="${i.path}" fill="currentColor"/>`
      : `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${i.stroke}</g>`;
    return `<span class="ico ${cls}" style="background:${i.color};color:${fg}" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${glyph}</svg></span>`;
  }

  // A cluster of fat square pixels, denser toward the right edge, each filled with its own tone-to-clear gradient.
  // Seeded by the pack's position, so every pack has its own shape and it never changes between visits.
  function pixelShape(i) {
    // the hero's own cells: rounded squares, five levels, blue on the left and violet on the right, seeded so each pack keeps its shape
    let seed = i * 7919 + 17;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const N = 7, u = 30, gap = 6, c = u - gap;
    let r = "";
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dens = 0.14 + 0.84 * (x / (N - 1)) ** 1.25 * (1 - Math.abs(y - (N - 1) / 2) / (N * 0.9));
      if (rnd() > dens) continue;
      const level = Math.min(4, 1 + Math.floor(rnd() * dens * 4.4)), side = x < N / 2 ? "b" : "v";
      r += `<rect class="${side}${level}" x="${x * u}" y="${y * u}" width="${c}" height="${c}" rx="${(c * 0.24).toFixed(1)}" style="--d:${(rnd() * 1.6).toFixed(2)}"/>`;
    }
    return `<svg class="shape" viewBox="0 0 ${N * u - gap} ${N * u - gap}" aria-hidden="true">${r}</svg>`;
  }

  /* ---------- the command ---------- */
  function command() {
    const ids = kit();
    if (!ids.length) return "Pick servers or skills to get your line";
    const p = [...ids];
    const to = agentsPicked();
    if (to.length) p.push(`--to ${to.join(",")}`);
    if (dock) p.push("--docker");
    if (dry) p.push("--dry-run");
    return `curl -fsSL ${C.site.host} | bash -s -- ${p.join(" ")}`;
  }
  const code = () => ["e", ...[...sel].map((i) => ALL[i].k), dock ? "zz" : null].filter(Boolean).join("-");

  /* ---------- how a server is wired into each agent (mirrors src/install.sh) ---------- */
  const tok = (t) => (t.includes("$HOME") ? t.replace(/\$HOME/g, '"$HOME"') : t);
  function entry(x, urlKey = "url", lead = {}) {
    if (x.transport === "http") return { ...lead, [urlKey]: x.url };
    const [command, ...args] = x.cmd.split(" ");
    return { ...lead, command, args };
  }
  function wire(agent, x) {
    const a = typeof agent === "string" ? ALL[agent] : agent;
    const stdio = x.transport === "stdio", cmd = stdio ? x.cmd.split(" ").map(tok).join(" ") : "";
    switch (a.method) {
      case "claude": return stdio ? `claude mcp add --scope user ${x.id} -- ${cmd}` : `claude mcp add --scope user --transport http ${x.id} ${x.url}`;
      case "codex": return stdio ? `codex mcp add ${x.id} -- ${cmd}` : `codex mcp add ${x.id} --url ${x.url}`;
      case "gemini": return stdio ? `gemini mcp add -s user ${x.id} ${cmd}` : `gemini mcp add -s user -t http ${x.id} ${x.url}`;
      case "vscode": return `code --add-mcp '${JSON.stringify(entry(x, a.urlKey || "url", stdio ? { name: x.id } : { name: x.id, type: "http" }))}'`;
      case "json": return `# merge into ${a.config[0].replace("$HOME", "~")} → ${a.serversKey}\n"${x.id}": ${JSON.stringify(entry(x, a.urlKey || "url"))}`;
      default: return "";
    }
  }

  /* ---------- the script (the hosted one, with the catalog and selection baked in) ---------- */
  function embed(script, tsv, pick) {
    const block = [
      "# @@EMBED_START@@ (this copy carries its own catalog and selection, so it works without the website)",
      "EMBEDDED=1",
      `DEFAULT_IDS="${pick.ids.join(" ")}"`,
      `DEFAULT_TO="${(pick.to || []).join(",")}"`,
      `DEFAULT_DOCKER=${pick.docker ? 1 : 0}`,
      "embedded_catalog() { cat <<'KITEM_CATALOG'",
      tsv.replace(/\n?$/, "\n") + "KITEM_CATALOG",
      "}",
      "# @@EMBED_END@@",
    ].join("\n");
    return script.replace(/# @@EMBED_START@@[\s\S]*?# @@EMBED_END@@/, () => block);
  }
  async function text(path) {
    if (!cache[path]) cache[path] = fetch(path).then((r) => { if (r.ok === false) throw new Error(path); return r.text(); });
    return cache[path];
  }
  async function script() {
    const [sh, tsv] = await Promise.all([text("install.sh"), text("catalog.tsv")]);
    return embed(sh, tsv, { ids: kit(), to: agentsPicked(), docker: dock });
  }

  /* ---------- render ---------- */
  const tagsHtml = (x) => tagsFor(x).map((t) => `<span class="tag ${tagClass(t)}">${esc(t)}</span>`).join("");
  const infoBtn = (x) => `<button class="info" type="button" data-info="${x.id}" aria-label="Details for ${esc(x.name)}">details</button>`;

  // A server: a logo, a name, one line, and what it takes to run. The publisher is left out when it is the name again.
  function card(x) {
    const by = x.by && x.by.toLowerCase() !== x.name.toLowerCase() ? `<span class="by">${esc(x.by)}</span>` : "";
    return `<div class="card"><button class="item" type="button" data-id="${x.id}" aria-pressed="${sel.has(x.id)}">
      <span class="top">${ico(x)}<span class="who"><span class="nm">${esc(x.name)}</span>${by}</span><span class="check" aria-hidden="true"></span></span>
      <span class="ds">${esc(x.ds)}</span>
      <span class="meta">${tagsHtml(x)}</span></button>${infoBtn(x)}</div>`;
  }
  // A skill is a card like a server: its owner's logo, or an initial tile when it has none, name, repo, description, tags.
  // a server's logo sits in a rounded square, a skill's in a circle: you can tell them apart at a glance, everywhere
  function mark(x) {
    if (x.sec !== "skills") return ico(x);
    if (!x.icon.generic) return ico(x, "round");
    // no brand to show: a tile with the skill's initial, coloured by its repo, so skills from one repo read as a family
    let h = 0; for (const c of x.repo) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `<span class="ico initial round" style="background:hsl(${h} 48% 42%)" aria-hidden="true">${esc(x.name.trim()[0].toUpperCase())}</span>`;
  }
  function skillRow(x) {
    return `<div class="card"><button class="item" type="button" data-id="${x.id}" aria-pressed="${sel.has(x.id)}">
      <span class="top">${mark(x)}<span class="who"><span class="nm">${esc(x.name)}</span><span class="by">${esc(x.repo)}</span></span><span class="check" aria-hidden="true"></span></span>
      <span class="ds">${esc(x.ds)}</span>
      <span class="meta">${tagsHtml(x)}</span></button>${infoBtn(x)}</div>`;
  }
  // lists are shown by name, A to Z (the command keeps catalog order, so it reads the same however you picked)
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  const matches = (x, ql) => !ql || [x.name, x.ds, x.by || x.repo, x.id, ...tagsFor(x), ...(x.cats || []).map((c) => C.categories[c])].join(" ").toLowerCase().includes(ql);

  function focusKey(el) {
    if (!el || !el.dataset) return null;
    for (const k of ["id", "info", "cat", "mcat", "tab", "tgt", "all"]) if (el.dataset[k] !== undefined) return [k, el.dataset[k]];
    return null;
  }
  // One list on screen at a time (tabs), 24 cards at a time. A search looks in both and shows what matched in each, without tabs.
  function renderCatalog(opts = {}) {
    const keep = focusKey(document.activeElement);
    const ql = q.trim().toLowerCase();
    const items = {
      mcp: C.mcp.filter((x) => matches(x, ql) && (!fcat || x.cats.includes(fcat))).sort(byName),
      skills: C.skills.filter((x) => matches(x, ql) && (!fcat || x.cats.includes(fcat))).sort(byName),
    };
    // one row of categories for both lists, with how many servers and skills each holds
    const inCat = (c) => C.mcp.filter((x) => x.cats.includes(c)).length + C.skills.filter((x) => x.cats.includes(c)).length;
    const chipRow = `<div class="cats" role="group" aria-label="Categories"><button class="cat" type="button" data-cat="" aria-pressed="${!fcat}">All</button>${Object.entries(C.categories).map(([c, l]) => `<button class="cat" type="button" data-cat="${c}" aria-pressed="${fcat === c}">${esc(l)} <small>${inCat(c)}</small></button>`).join("")}</div>`;
    const kinds = ql ? SECTIONS.map((x) => x[0]).filter((k) => items[k].length) : tab === "all" ? ["mcp", "skills"] : [tab];
    const html = kinds.map((k) => {
      const [, label, sub] = SECTIONS.find((x) => x[0] === k), all = items[k], vis = all.slice(0, pageOf[k]), rest = all.length - vis.length;
      const more = rest > 0 ? `<button class="showmore btn" type="button" data-more="${k}">Show ${Math.min(PAGE, rest)} more <small>${rest} left</small></button>` : "";
      return `<section aria-labelledby="h-${k}"><h2 id="h-${k}"><span class="n">${kinds.length > 1 && k === "skills" ? "03" : "02"}</span> ${label} <small>${sub}</small></h2><div class="grid">${vis.map(k === "skills" ? skillRow : card).join("") || `<p class="empty">No ${k === "skills" ? "skills" : "servers"} match.</p>`}</div>${more}</section>`;
    }).join("");
    $("#cat").innerHTML = chipRow + (html || `<p class="empty">Nothing matches “${esc(q)}”.</p>`);
    $("#show-pick").value = tab;   // the list filter lives in the header
    $("#cat-pick").value = fcat;
    if (refreshDD["show-pick"]) { refreshDD["show-pick"](); refreshDD["cat-pick"](); }
    sync();
    if (opts.focusItem != null) { const el = $$("#cat .item")[opts.focusItem]; if (el) el.focus(); }
    else if (keep) { const el = $(`[data-${keep[0]}="${keep[1].replace(/["\\]/g, "\\$&")}"]`); if (el) el.focus(); }
  }
  const openTab = (k) => {
    tab = k; renderCatalog();
    const top = $("#cat").getBoundingClientRect().top;   // filtering from the top of the page: bring the list up
    if (top > innerHeight * 0.55 || top < 0) $("#cat").scrollIntoView({ block: "start" });
  };

  // Updates what depends on the selection without rebuilding the grid, so keyboard focus stays where it is.
  function sync() {
    $$(".item").forEach((b) => b.setAttribute("aria-pressed", sel.has(b.dataset.id)));
    $$(".pack").forEach((el) => {
      const done = C.packs[+el.dataset.i].ids.every((i) => sel.has(i));
      el.classList.toggle("done", done);
      el.setAttribute("aria-pressed", done);
      el.querySelector(".cta-t").textContent = done ? "Added" : "Add pack";
    });
    const tg = agentsPicked();
    // the agent selector: options keep their own state; the trigger shows what is picked
    $$("[data-tgt]").forEach((b) => b.setAttribute("aria-selected", sel.has(b.dataset.tgt)));
    $("[data-all]").setAttribute("aria-selected", !tg.length);
    const shown = tg.length ? tg.map((i) => ALL[i]) : C.agents;
    $("#agent-logos").innerHTML = shown.slice(0, 5).map((a) => ico(a, "mini")).join("");
    $("#agent-main").textContent = !tg.length ? "All agents" : tg.length > 2 ? `${tg.length} agents` : tg.map((i) => ALL[i].chip).join(" + ");
    $("#agent-btn").title = tg.length ? `--to ${tg.join(",")}` : "Tools up every agent the script finds";
    $("#agent-flag").textContent = tg.length ? `--to ${tg.join(",")}` : "No --to: tools up every agent it finds";
    $$("[data-dtgt]").forEach((b) => b.setAttribute("aria-pressed", sel.has(b.dataset.dtgt)));
    const dall = $("[data-dall]"); if (dall) dall.setAttribute("aria-pressed", !tg.length);
    const nm = ofSec("mcp").length, ns = ofSec("skills").length;
    $("#count").innerHTML = nm + ns
      ? `<b>${nm}</b> server${nm === 1 ? "" : "s"} · <b>${ns}</b> skill${ns === 1 ? "" : "s"} → ${tg.length ? tg.map((i) => esc(ALL[i].chip)).join(", ") : "all your agents"}`
      : "Pick servers or skills to tool up your agents";
    const picked = [...ofSec("mcp"), ...ofSec("skills")];
    const chip = (x) => `<li class="chip">${x.sec === "skills" ? mark(x) : ico(x, "mini")}<span class="chip-t"><b>${esc(x.name)}</b><small>${esc(x.sec === "mcp" ? x.by : x.repo)}</small></span><button type="button" data-rm="${x.id}" aria-label="Remove ${esc(x.name)}">×</button></li>`;
    const gs = ofSec("mcp").sort(byName), gk = ofSec("skills").sort(byName);
    $("#chips").innerHTML = (gs.length ? `<li class="lbl">Servers <span>${gs.length}</span></li>${gs.map(chip).join("")}` : "") + (gk.length ? `<li class="lbl">Skills <span>${gk.length}</span></li>${gk.map(chip).join("")}` : "");
    $("#drawer").classList.toggle("has", picked.length > 0);
    // the folder: the last few picks fan out of it like loose pages, then the count and what it holds
    $("#review").disabled = !picked.length;
    // the five you added last stack up in the card
    const lastPicks = [...sel].map((i) => ALL[i]).filter((x) => x.sec === "mcp" || x.sec === "skills").slice(-5);
    $("#fo-pages").innerHTML = lastPicks.map((x, i) => `<span class="fo-page ${x.sec === "skills" ? "k-skill" : "k-mcp"}">${x.sec === "skills" ? mark(x) : ico(x, "mini")}<i>${esc(x.name)}</i></span>`).join("") + (picked.length > lastPicks.length ? `<span class="fo-more">+${picked.length - lastPicks.length}</span>` : "");
    const foN = `${picked.length} pick${picked.length === 1 ? "" : "s"}`;
    $("#fo-n").textContent = foN; $(".fo-n2").textContent = foN;
    $("#review").title = picked.length ? `Your toolbox: ${nm} server${nm === 1 ? "" : "s"} · ${ns} skill${ns === 1 ? "" : "s"}` : "Your toolbox";
    $(".fo-sub2").textContent = picked.length ? `${nm} MCP${nm === 1 ? "" : "s"} · ${ns} skill${ns === 1 ? "" : "s"}` : "nothing yet";
    $("#fo-sub").textContent = picked.length ? `${nm} MCP${nm === 1 ? "" : "s"} · ${ns} skill${ns === 1 ? "" : "s"}` : "nothing yet";
    if (!picked.length) closeDrawer();
    $("#cmd").textContent = command();
    ["copy", "more", "view", "dl", "link"].forEach((b) => { $("#" + b).disabled = !(nm + ns); });
    $(".bar").hidden = !(nm + ns);   // nothing picked, nothing to show: no bar, no disabled buttons
    document.body.classList.toggle("has-bar", nm + ns > 0);
    if (!(nm + ns)) closeMore(false);
    $("#dryflag").setAttribute("aria-pressed", dry);
    try { history.replaceState(null, "", sel.size ? "#" + code() : location.pathname + location.search); } catch (e) { /* sandboxed frames */ }
  }
  const render = sync;

  /* ---------- the agent selector: one big dropdown, several choices at once ---------- */
  const menu = () => $("#agent-list");
  const options = () => $$("#agent-opts [role=option]");
  // Opens below its button when there is room, above it when there is more room there, and never taller than the room it has
  // (the fixed header and the bottom bar count as taken); what does not fit scrolls.
  function placeMenu(trigger, m, gap = 12) {
    m.classList.remove("up"); m.style.maxHeight = "";
    const r = trigger.getBoundingClientRect(), bar = $(".bar"), barH = bar && !bar.hidden ? bar.offsetHeight : 0;
    const below = innerHeight - r.bottom - barH - gap - 10, above = r.top - 65 - gap - 10, need = m.scrollHeight + 2;
    const up = need <= below ? false : need <= above ? true : above > below;   // whichever side fits it whole; else the roomier one, scrolling
    if (up) { m.classList.add("up"); m.style.maxHeight = Math.max(180, above) + "px"; } else m.style.maxHeight = Math.max(180, below) + "px";
  }
  function openMenu(focusOption) {
    menu().hidden = false;
    placeMenu($("#agent-btn"), menu());
    $("#agent-btn").setAttribute("aria-expanded", "true");
    if (focusOption) (options().find((o) => o.getAttribute("aria-selected") === "true") || options()[0]).focus();
  }
  let placing = 0;
  const replace = () => { if (!placing) placing = requestAnimationFrame(() => { placing = 0; if (menu() && !menu().hidden) placeMenu($("#agent-btn"), menu()); }); };
  window.addEventListener("resize", replace); window.addEventListener("scroll", replace, { passive: true });
  function closeMenu(refocus) {
    if (menu().hidden) return;
    menu().hidden = true;
    $("#agent-btn").setAttribute("aria-expanded", "false");
    if (refocus) $("#agent-btn").focus();
  }
  function buildAgentMenu() {
    const all = `<span class="ico dd-all" aria-hidden="true"><svg viewBox="0 0 3 3" shape-rendering="crispEdges"><path d="M0 0h1v1H0zM2 0h1v1H2zM1 1h1v1H1zM0 2h1v1H0zM2 2h1v1H2z" fill="currentColor"/></svg></span>`;
    const opt = (attrs, logo, name, by) => `<button class="dd-opt" type="button" role="option" aria-selected="false" ${attrs}>${logo}<span class="dd-on"><span class="dd-nm">${esc(name)}</span><span class="dd-by">${esc(by)}</span></span><span class="dd-tick" aria-hidden="true"></span></button>`;
    $("#agent-opts").innerHTML = opt("data-all", all, "All agents", "Every supported agent found on this machine") +
      C.agents.map((a) => opt(`data-tgt="${a.id}"`, ico(a), a.name, a.by)).join("");
    $("#agent-btn").onclick = () => (menu().hidden ? openMenu(false) : closeMenu(false));
    $("#agent-btn").addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openMenu(true); } });
    menu().addEventListener("keydown", (e) => {   // arrows move between options; Escape and Tab close the menu
      const o = options(), i = o.indexOf(document.activeElement);
      const go = (n) => { e.preventDefault(); o[(n + o.length) % o.length].focus(); };
      if (e.key === "ArrowDown") go(i + 1);
      else if (e.key === "ArrowUp") go(i - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(o.length - 1);
      else if (e.key === "Escape") { e.stopPropagation(); closeMenu(true); }
      else if (e.key === "Tab") closeMenu(false);
    });
  }

  /* ---------- sheet (dialog) ---------- */
  function openSheet(html, small, keepFocusTarget) {
    if (!keepFocusTarget) lastFocus = document.activeElement;
    const s = $("#sheet");
    s.className = "sheet" + (small ? " small" : ""); delete s.dataset.kind;
    s.innerHTML = html;
    $("#scrim").classList.add("show");
    if (!keepFocusTarget) (s.querySelector("[data-close]") || s).focus();
  }
  // The picks drawer: opens above the folder, lists what the line installs, each with a way to take it out. It stays in step with the selection.
  function openDrawer() {
    if ($("#review").disabled) return;
    $("#drawer").style.bottom = ($(".bar").offsetHeight + 28) + "px";   // sits just above the bar, whatever its height
    $("#drawer").hidden = false; $("#review").setAttribute("aria-expanded", "true");
  }
  function closeDrawer(focusFolder) {
    if ($("#drawer").hidden) return;
    $("#drawer").hidden = true; $("#review").setAttribute("aria-expanded", "false");
    if (focusFolder) $("#review").focus();
  }
  function closeSheet() {
    $("#scrim").classList.remove("show");
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }
  function trapTab(e) {
    if (e.key !== "Tab" || !$("#scrim").classList.contains("show")) return;
    const f = $$("#sheet button, #sheet a[href], #sheet pre");
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function toast(t) {
    const e = $("#toast");
    e.textContent = t; e.classList.add("show");
    clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove("show"), 1800);
  }
  async function copy(t, msg) {
    try { await navigator.clipboard.writeText(t); toast(msg); }
    catch (e) { openSheet(`<h3 id="sheet-title">Copy manually</h3><pre tabindex="0">${esc(t)}</pre><div class="row"><button class="btn" type="button" data-close>Close</button></div>`, true); }
  }

  // Everything from the same publisher (skills: the repo; servers: the publisher), shown in each one's details, with one button for all.
  function family(x) {
    const key = x.sec === "mcp" ? x.by : x.repo;
    if (!key) return null;
    const members = C[x.sec].filter((m) => (x.sec === "mcp" ? m.by : m.repo) === key).sort(byName);
    if (members.length < 2) return null;
    return { key, members, ds: (C.repos.find((r) => r.repo === key) || {}).ds || "" };
  }
  function familyHtml(x) {
    const f = family(x);
    if (!f) return "";
    const every = f.members.every((m) => sel.has(m.id));
    return `<section class="fam"><div class="fam-h"><div><h4>The ${esc(f.key)} family</h4>${f.ds ? `<p>${esc(f.ds)}</p>` : ""}</div>
      <button class="btn pri" type="button" data-fall="${x.id}">${every ? "Remove" : "Add"} all ${f.members.length}</button></div>
      <ul class="fam-list">${f.members.map((m) => `<li class="${m.id === x.id ? "cur" : ""}"><button type="button" class="fam-open" data-info="${m.id}" title="About ${esc(m.name)}">${mark(m)}<span class="fam-t"><b>${esc(m.name)}</b><small>${esc(m.ds)}</small></span></button>
        <button class="btn fam-add" type="button" data-ftog="${m.id}" data-of="${x.id}" aria-pressed="${sel.has(m.id)}">${sel.has(m.id) ? "✓ Added" : "Add"}</button></li>`).join("")}</ul></section>`;
  }
  function details(id, again) {
    const x = ALL[id], rows = [];
    if (x.sec === "mcp") {
      rows.push(["Publisher", x.by], ["Category", x.cats.map((c) => C.categories[c]).join(", ")]);
      if (x.transport === "http") rows.push(["Transport", "Streamable HTTP"], ["URL", x.url], ["Sign-in", x.auth === "oauth" ? "OAuth, on first use" : "none needed"]);
      else rows.push(["Transport", "stdio"], ["Runs", x.cmd]);
      if (x.needs) rows.push(["Needs", x.needs.join(", ")]);
    } else {
      rows.push(["Repository", `<a href="https://github.com/${x.repo}">github.com/${x.repo}</a>`], ["Category", x.cats.map((c) => C.categories[c]).join(", ")]);
      if (x.installs) rows.push(["Installs", fmt(x.installs)]);
      rows.push(["Installs with", `npx skills add ${x.repo} --skill ${x.id} -g`]);
    }
    let wiring = "";
    if (x.sec === "mcp") {
      const tg = agentsPicked(), list = tg.length ? tg : C.agents.map((a) => a.id);
      wiring = `<p>The exact wiring${tg.length ? "" : " for each supported agent"}:</p>
      <pre tabindex="0">${esc(list.map((a) => `# ${ALL[a].name}\n${wire(a, x)}`).join("\n\n"))}</pre>`;
    }
    const fam = familyHtml(x), top = again ? $("#sheet").scrollTop : 0, focus = again && document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ftog || (document.activeElement.dataset.fall && "all") : null;
    openSheet(`<h3 id="sheet-title" class="sheet-h">${mark(x)}${esc(x.name)}</h3><p>${esc(x.ds)}</p>
      <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === "Repository" ? v : esc(v)}</dd>`).join("")}</dl>${fam}${wiring}
      <div class="row"><button class="btn" type="button" data-close>Close</button><button class="btn pri" type="button" data-tog="${id}">${sel.has(id) ? "Remove" : "Add"}</button></div>`, !fam, again);
    if (again) { $("#sheet").scrollTop = top; const f = focus === "all" ? $("#sheet [data-fall]") : focus && $(`#sheet [data-ftog="${focus}"]`); if (f) f.focus(); }
  }

  /* ---------- the header's two dropdowns, with icons (the native selects stay behind them as the source of truth) ---------- */
  const IC = {
    "": '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    all: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    mcp: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
    skills: '<path d="M12 5v16"/><path d="M20 19A2 2 0 0 0 22 17V5a2 2 0 0 0-2-2l-4 0a5 5 0 0 0-4 2 5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4a5 5 0 0 1 4 2 5 5 0 0 1 4-2z"/>',
    code: '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
    test: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    design: '<circle cx="13.5" cy="6.5" r=".6"/><circle cx="17.5" cy="10.5" r=".6"/><circle cx="8.5" cy="7.5" r=".6"/><circle cx="6.5" cy="12.5" r=".6"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.7-1.7H16c3 0 5.6-2.5 5.6-5.6C22 6 17.5 2 12 2z"/>',
    docs: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
    media: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/>',
    work: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    pay: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
    web: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    ai: '<path d="M9.9 15.5A2 2 0 0 0 8.5 14.1l-6.1-1.6a.5.5 0 0 1 0-1L8.5 9.9A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z"/>',
    biz: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    util: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  };
  const svgIcon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || IC[""]}</svg>`;
  const refreshDD = {};
  const closeDDs = (except) => $$(".dd2").forEach((r) => { if (r === except) return; const l = r.querySelector(".dd2-list"); if (!l.hidden) { l.hidden = true; r.querySelector(".dd2-btn").setAttribute("aria-expanded", "false"); } });
  function enhance(id) {
    const root = $(`[data-dd="${id}"]`), sel = $("#" + id), btn = root.querySelector(".dd2-btn"), list = root.querySelector(".dd2-list"), clear = root.querySelector(".dd2-x");
    const opts = () => [...list.querySelectorAll(".dd2-opt")];
    const refresh = () => {
      const o = sel.options[sel.selectedIndex];
      root.querySelector(".dd2-ic").innerHTML = svgIcon(o.value);
      root.querySelector(".dd2-lbl").textContent = o.dataset.short || o.textContent;   // the button says it short; the list has the counts
      const filtered = sel.value !== sel.options[0].value;   // anything but the first option is a filter, and can be cleared
      clear.hidden = !filtered; btn.classList.toggle("has-x", filtered);
      list.innerHTML = [...sel.options].map((x) => `<button class="dd2-opt" type="button" role="option" data-v="${esc(x.value)}" aria-selected="${x.value === sel.value}">${svgIcon(x.value)}<span>${esc(x.textContent)}</span></button>`).join("");
    };
    const open = (focusSel) => { closeDDs(root); list.hidden = false; btn.setAttribute("aria-expanded", "true"); if (focusSel) (opts().find((b) => b.getAttribute("aria-selected") === "true") || opts()[0]).focus(); };
    const close = (back) => { list.hidden = true; btn.setAttribute("aria-expanded", "false"); if (back) btn.focus(); };
    const pick = (v) => { sel.value = v; sel.dispatchEvent(new window.Event("change", { bubbles: true })); close(true); };
    btn.onclick = () => (list.hidden ? open(false) : close(false));
    clear.onclick = (e) => { e.stopPropagation(); sel.value = sel.options[0].value; sel.dispatchEvent(new window.Event("change", { bubbles: true })); close(false); btn.focus(); };
    btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(true); } });
    list.addEventListener("click", (e) => { const b = e.target.closest(".dd2-opt"); if (b) pick(b.dataset.v); });
    list.addEventListener("keydown", (e) => {
      const o = opts(), i = o.indexOf(document.activeElement), go = (n) => { e.preventDefault(); o[(n + o.length) % o.length].focus(); };
      if (e.key === "ArrowDown") go(i + 1); else if (e.key === "ArrowUp") go(i - 1); else if (e.key === "Home") go(0); else if (e.key === "End") go(o.length - 1);
      else if (e.key === "Escape") { e.stopPropagation(); close(true); } else if (e.key === "Tab") close(false);
    });
    sel.addEventListener("change", refresh);
    refreshDD[id] = refresh; refresh();
  }

  /* ---------- the split button: Copy command, with Download and Preview in its menu ---------- */
  function closeMore(back) {
    const m = $("#more-menu");
    if (!m || m.hidden) return;
    m.hidden = true; $("#more").setAttribute("aria-expanded", "false");
    if (back) $("#more").focus();
  }
  function openMore() {
    if ($("#more").disabled) return;
    closeDDs(); $("#more-menu").hidden = false; $("#more").setAttribute("aria-expanded", "true");
    $("#more-menu .mi").focus();
  }

  /* ---------- interactions ---------- */
  function toggle(id) { sel.has(id) ? sel.delete(id) : sel.add(id); render(); }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t.closest("#targets")) closeMenu(false);
    if (!t.closest(".dd2")) closeDDs();
    if (!t.closest(".split")) closeMore(false);
    if (!t.closest("#drawer, #review, #scrim")) closeDrawer();
    const info = t.closest("[data-info]");
    if (info) return details(info.dataset.info, !!t.closest("#sheet"));
    const ft = t.closest("[data-ftog]");
    if (ft) { toggle(ft.dataset.ftog); return details(ft.dataset.of, true); }
    const fa = t.closest("[data-fall]");
    if (fa) { const f = family(ALL[fa.dataset.fall]), every = f.members.every((m) => sel.has(m.id)); f.members.forEach((m) => (every ? sel.delete(m.id) : sel.add(m.id))); render(); return details(fa.dataset.fall, true); }
    const it = t.closest(".item");
    if (it) { toggle(it.dataset.id); return; }
    if (t.closest("[data-close]") || t.id === "scrim") return closeSheet();
    if (t.closest("[data-rm]")) { toggle(t.closest("[data-rm]").dataset.rm); return; }
    if (t.closest("[data-rmall]")) { sel.clear(); dock = false; renderCatalog(); closeSheet(); return; }
    const tg = t.closest("[data-tog]");
    if (tg) { closeSheet(); toggle(tg.dataset.tog); return; }
    const cb = t.closest("[data-cat]");
    if (cb) { fcat = cb.dataset.cat; pageOf.mcp = pageOf.skills = PAGE; return renderCatalog(); }
    const mo = t.closest("[data-more]");
    if (mo) { const k = mo.dataset.more, was = pageOf[k]; pageOf[k] += PAGE; return renderCatalog({ focusItem: was }); }
    if (t.closest("[data-all], [data-dall]")) { C.agents.forEach((a) => sel.delete(a.id)); return render(); }
    const da = t.closest("[data-dtgt]");
    if (da) { const id = da.dataset.dtgt; sel.has(id) ? sel.delete(id) : sel.add(id); return render(); }
    const ag = t.closest("[data-tgt]");
    if (ag) { const id = ag.dataset.tgt; sel.has(id) ? sel.delete(id) : sel.add(id); return render(); }
    const pk = t.closest(".pack");
    if (pk) togglePack(C.packs[+pk.dataset.i]);
  });
  // a pack toggles: click adds all of it, click again takes it back out
  function togglePack(p) {
    const done = p.ids.every((i) => sel.has(i));
    if (done) { p.ids.forEach((i) => sel.delete(i)); if (p.docker) dock = false; }
    else { p.ids.forEach((i) => sel.add(i)); if (p.docker) dock = true; }
    render(); toast(`${p.name} pack ${done ? "removed" : "added"}`);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (!$("#more-menu").hidden) closeMore(true); else if ($("#scrim").classList.contains("show")) closeSheet(); else closeDrawer(true); }
    trapTab(e);
  });

  function load() {
    const h = location.hash.slice(1);
    if (h.startsWith("e-")) {
      sel = new Set(); dock = false;
      h.split("-").slice(1).forEach((k) => { if (k === "zz") dock = true; else if (BYK[k]) sel.add(BYK[k].id); });
    }
    renderCatalog();
  }

  function init(catalog) {
    C = catalog;
    for (const s of ["agents", "mcp", "skills"]) C[s].forEach((x) => { x.sec = s; ALL[x.id] = x; BYK[x.k] = x; });
    $("#host").textContent = `${C.site.host} — zsh`;
    buildAgentMenu();
    // the same choice as the hero's dropdown, editable right where you review: one button per agent, and "All"
    $("#dr-agents").innerHTML = `<button class="dr-agent" type="button" data-dall aria-pressed="true">All</button>` + C.agents.map((a) => `<button class="dr-agent" type="button" data-dtgt="${a.id}" aria-pressed="false" title="${esc(a.name)}">${ico(a, "mini")}<span>${esc(a.chip)}</span></button>`).join("");
    // the phone menu: the button opens the link panel; a link, Escape or a tap elsewhere closes it
    const hdr = $("header"), mbtn = $("#menu-btn");
    $$("#show-pick option").forEach((o) => { o.textContent = `${o.dataset.tab === "all" ? "All" : o.dataset.tab === "mcp" ? "MCP servers" : "Skills"} · ${o.dataset.tab === "all" ? C.mcp.length + C.skills.length : C[o.dataset.tab].length}`; });
    $("#show-pick").onchange = (e) => { openTab(e.target.value); setMenu(false); };
    const setMenu = (open) => { hdr.classList.toggle("open", open); mbtn.setAttribute("aria-expanded", open); };
    mbtn.onclick = () => setMenu(!hdr.classList.contains("open"));
    document.addEventListener("click", (e) => { if (!e.target.closest("header")) setMenu(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && hdr.classList.contains("open")) { setMenu(false); mbtn.focus(); } });
    $("#hero-meta").textContent = `${C.mcp.length} MCP servers · ${C.skills.length} skills · ${C.agents.length} agents`;
    // each pack is a tinted card: what's inside as logos, and a block shape of fat gradient pixels, different for each
    $("#packs").innerHTML = C.packs.map((p, i) => {
      const servers = p.ids.filter((id) => ALL[id].sec === "mcp"), n = p.ids.length - servers.length;
      const logos = servers.slice(0, 6).map((id) => ico(ALL[id], "mini")).join("");
      const more = [servers.length && `${servers.length} server${servers.length === 1 ? "" : "s"}`, n && `${n} skill${n === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
      return `<button class="pack t${i % 6}" type="button" data-i="${i}" aria-pressed="false">
        <span class="more">${more}</span>
        <b>${esc(p.name)}</b><span class="pk-ds">${esc(p.ds)}</span>
        <span class="pk-logos">${logos}</span>
        <span class="cta"><span class="cta-t">Add pack</span> <span aria-hidden="true">→</span></span>${pixelShape(i)}</button>`;
    }).join("");
    $("#q").addEventListener("input", (e) => { q = e.target.value; pageOf.mcp = pageOf.skills = PAGE; renderCatalog(); if (q && $("#cat").getBoundingClientRect().top > innerHeight * 0.6) $("#cat").scrollIntoView({ block: "start" }); });
    $("#more").onclick = () => ($("#more-menu").hidden ? openMore() : closeMore(false));
    $("#more-menu").addEventListener("click", () => closeMore(false));
    $("#more-menu").addEventListener("keydown", (e) => {   // arrows move between the two items
      const it = [...$$("#more-menu .mi")], i = it.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); it[(i + 1) % it.length].focus(); } else if (e.key === "ArrowUp") { e.preventDefault(); it[(i + it.length - 1) % it.length].focus(); } else if (e.key === "Tab") closeMore(false);
    });
    $("#review").onclick = () => ($("#drawer").hidden ? openDrawer() : closeDrawer());
    $("#drawer-close").onclick = () => closeDrawer(true);
    $("#clear").onclick = () => { sel.clear(); dock = false; renderCatalog(); };
    $("#dryflag").onclick = () => { dry = !dry; sync(); };
    $("#copy").onclick = () => copy(command(), "Command copied");
    $("#link").onclick = () => copy(location.href.split("#")[0] + "#" + code(), "Share link copied");
    $("#view").onclick = async () => {
      try {
        const s = await script();
        openSheet(`<h3 id="sheet-title">${esc(C.site.host)}</h3><p>The full script your line runs, with your picks baked in. Save it as <code>toolup.sh</code> and run <code>bash toolup.sh --dry-run</code> to preview. It works without this website.</p><pre tabindex="0">${esc(s)}</pre><div class="row"><button class="btn" type="button" data-close>Close</button><button class="btn pri" type="button" id="cs">Copy script</button></div>`);
        $("#cs").onclick = () => copy(s, "Script copied");
      } catch (err) { toast("Couldn't load the script"); }
    };
    $("#dl").onclick = async () => {
      try {
        const s = await script();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([s], { type: "text/x-shellscript" }));
        a.download = "toolup.sh";
        document.body.appendChild(a); a.click(); a.remove();
        toast("Downloaded toolup.sh");
      } catch (err) { toast("Couldn't build the script"); }
    };
    // toolbar: starter packs, categories, theme
    $("#cat-pick").innerHTML = `<option value="" data-short="Categories">All categories</option>${Object.entries(C.categories).map(([c, l]) => `<option value="${c}">${esc(l)}</option>`).join("")}`;
    $("#cat-pick").onchange = (e) => {
      fcat = e.target.value; pageOf.mcp = pageOf.skills = PAGE;
      renderCatalog();
      if (fcat) { const top = $("#cat").getBoundingClientRect().top; if (top > innerHeight * 0.55 || top < 0) $("#cat").scrollIntoView({ block: "start" }); }
    };
    enhance("show-pick"); enhance("cat-pick");
    // one button: light <-> dark (the first click leaves "match the system" for the opposite of what you see)
    $("#theme").onclick = () => {
      const root = document.documentElement;
      const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      root.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("theme", root.dataset.theme); } catch (e) { /* private mode */ }
    };
    window.addEventListener("hashchange", () => { if (location.hash.slice(1) !== code()) load(); });
    load();
    window.ToolUp = { placeMenu, command, wire, embed, code, script, get state() { return { sel: [...sel], dock, dry }; } };
  }

  fetch("catalog.json")
    .then((r) => r.json())
    .then(init)
    .catch(() => { $("#cat").innerHTML = '<p class="empty">Couldn\'t load the catalog. Reload the page, or run <code>curl -fsSL toolup.sh | bash -s -- --list</code>.</p>'; });
})();
