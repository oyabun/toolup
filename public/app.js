/* Kit'Em! — the picker. Reads catalog.json (built from catalog/*.json); nothing about servers or skills lives here. */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let C, ALL = {}, BYK = {};
  let sel = new Set(), dock = false, dry = false, q = "", fcat = "", frepo = "";
  let lastFocus = null;
  const cache = {};

  const SECTIONS = [
    ["mcp", "MCP servers", "Registered with each agent you kit"],
    ["skills", "Skills", "Installed with the open skills CLI (skills.sh) into every agent"],
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
      if (x.docker) t.push("docker");
      (x.needs || []).forEach((n) => t.push(`needs ${n}`));
      return t;
    }
    const t = [];
    if (repoMeta(x.repo).badge) t.push(repoMeta(x.repo).badge);
    if (x.installs) t.push(`${fmt(x.installs)} installs`);
    t.push(C.categories[x.cat].split(/[ ,]/)[0].toLowerCase());
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
  function card(x) {
    const on = sel.has(x.id);
    const tags = tagsFor(x).map((t) => `<span class="tag ${tagClass(t)}">${esc(t)}</span>`).join("");
    const by = x.sec === "skills" ? x.repo : x.by;
    return `<div class="card"><button class="item" type="button" data-id="${x.id}" aria-pressed="${on}">
      <span class="top">${ico(x)}
        <span><span class="nm">${esc(x.name)}</span><br><span class="by">${esc(by)}</span></span><span class="tick" aria-hidden="true"></span></span>
      <span class="ds">${esc(x.ds)}</span>
      <span class="tags">${tags}</span></button>
      <button class="info" type="button" data-info="${x.id}" aria-label="Details for ${esc(x.name)}">details</button></div>`;
  }
  const matches = (x, ql) => !ql || [x.name, x.ds, x.by || x.repo, x.id, ...tagsFor(x)].join(" ").toLowerCase().includes(ql);

  function focusKey(el) {
    if (!el || !el.dataset) return null;
    for (const k of ["id", "info", "repo", "cat", "tgt", "all"]) if (el.dataset[k] !== undefined) return [k, el.dataset[k]];
    return null;
  }
  function renderCatalog() {
    const keep = focusKey(document.activeElement);
    const ql = q.trim().toLowerCase();
    const html = SECTIONS.map(([k, label, sub], i) => {
      let items = C[k].filter((x) => matches(x, ql));
      let extra = "";
      if (k === "skills") {
        items = items.filter((x) => (!fcat || x.cat === fcat) && (!frepo || x.repo === frepo));
        extra = `<div class="repos" role="group" aria-label="Featured repos">${C.repos.map((R) => {
          const total = C.skills.filter((x) => x.repo === R.repo).length;
          return `<button class="repo" type="button" data-repo="${R.repo}" aria-pressed="${frepo === R.repo}">${ico(R, "mini")}<b>${R.repo}</b><span>${esc(R.ds)} · <span data-picked="${R.repo}"></span> of ${total} picked</span></button>`;
        }).join("")}</div>
        <div class="cats" role="group" aria-label="Categories"><button class="cat" type="button" data-cat="" aria-pressed="${!fcat}">All</button>${Object.entries(C.categories).map(([c, l]) => `<button class="cat" type="button" data-cat="${c}" aria-pressed="${fcat === c}">${esc(l)}</button>`).join("")}</div>`;
      }
      if (!items.length && ql) return "";
      return `<section aria-labelledby="h-${k}"><h2 id="h-${k}"><span class="n">0${i + 3}</span> ${label} <small>${sub}</small></h2>${extra}<div class="grid">${items.map(card).join("") || `<p class="empty">No ${k === "skills" ? "skills" : "servers"} match.</p>`}</div></section>`;
    }).join("");
    $("#cat").innerHTML = html || `<p class="empty">Nothing matches “${esc(q)}”.</p>`;
    sync();
    if (keep) { const el = $(`[data-${keep[0]}="${keep[1].replace(/["\\]/g, "\\$&")}"]`); if (el) el.focus(); }
  }

  // Updates what depends on the selection without rebuilding the grid, so keyboard focus stays where it is.
  function sync() {
    $$(".item").forEach((b) => b.setAttribute("aria-pressed", sel.has(b.dataset.id)));
    $$("[data-picked]").forEach((s) => { s.textContent = C.skills.filter((x) => x.repo === s.dataset.picked && sel.has(x.id)).length; });
    const tg = agentsPicked();
    $("#targets").innerHTML = `<button class="tgt" type="button" data-all aria-pressed="${!tg.length}">All agents</button>` +
      C.agents.map((a) => `<button class="tgt" type="button" data-tgt="${a.id}" aria-pressed="${sel.has(a.id)}">${ico(a, "mini")}${esc(a.chip)}</button>`).join("");
    const nm = ofSec("mcp").length, ns = ofSec("skills").length;
    $("#count").innerHTML = nm + ns
      ? `<b>${nm}</b> server${nm === 1 ? "" : "s"} · <b>${ns}</b> skill${ns === 1 ? "" : "s"} → ${tg.length ? tg.map((i) => esc(ALL[i].chip)).join(", ") : "all your agents"}`
      : "Pick servers or skills to kit your agents";
    $("#cmd").textContent = command();
    ["copy", "view", "dl", "link"].forEach((b) => { $("#" + b).disabled = !(nm + ns); });
    $("#dock").checked = dock;
    $("#dryflag").setAttribute("aria-pressed", dry);
    try { history.replaceState(null, "", sel.size ? "#" + code() : location.pathname + location.search); } catch (e) { /* sandboxed frames */ }
  }
  function render() {
    // the agent chips live in sync(); focus on one of them has to survive that rebuild
    const keep = focusKey(document.activeElement);
    sync();
    if (keep && keep[0] === "tgt") { const el = $(`[data-tgt="${keep[1]}"]`); if (el) el.focus(); }
    if (keep && keep[0] === "all") $("[data-all]").focus();
  }

  /* ---------- sheet (dialog) ---------- */
  function openSheet(html, small) {
    lastFocus = document.activeElement;
    const s = $("#sheet");
    s.className = "sheet" + (small ? " small" : "");
    s.innerHTML = html;
    $("#scrim").classList.add("show");
    (s.querySelector("[data-close]") || s).focus();
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

  function details(id) {
    const x = ALL[id], rows = [];
    if (x.sec === "mcp") {
      rows.push(["Publisher", x.by]);
      if (x.transport === "http") rows.push(["Transport", "Streamable HTTP"], ["URL", x.url], ["Sign-in", x.auth === "oauth" ? "OAuth, on first use" : "none needed"]);
      else rows.push(["Transport", "stdio"], ["Runs", x.cmd]);
      if (x.docker) rows.push(["Docker catalog", x.docker]);
      if (x.needs) rows.push(["Needs", x.needs.join(", ")]);
    } else {
      rows.push(["Repository", `<a href="https://github.com/${x.repo}">github.com/${x.repo}</a>`], ["Category", C.categories[x.cat]]);
      if (x.installs) rows.push(["skills.sh installs", fmt(x.installs)]);
      rows.push(["Installs with", `npx skills add ${x.repo} --skill ${x.id} -g`]);
    }
    let wiring = "";
    if (x.sec === "mcp") {
      const tg = agentsPicked(), list = tg.length ? tg : C.agents.map((a) => a.id);
      wiring = `<p>The exact wiring${tg.length ? "" : " for each supported agent"}${dock && x.docker ? ". With the Docker gateway on, this server is enabled there and agents get one MCP_DOCKER entry instead" : ""}:</p>
      <pre tabindex="0">${esc(list.map((a) => `# ${ALL[a].name}\n${wire(a, x)}`).join("\n\n"))}</pre>`;
    }
    openSheet(`<h3 id="sheet-title" class="sheet-h">${ico(x)}${esc(x.name)}</h3><p>${esc(x.ds)}</p>
      <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === "Repository" ? v : esc(v)}</dd>`).join("")}</dl>${wiring}
      <div class="row"><button class="btn" type="button" data-close>Close</button><button class="btn pri" type="button" data-tog="${id}">${sel.has(id) ? "Remove" : "Add"}</button></div>`, true);
  }

  /* ---------- interactions ---------- */
  function toggle(id) { sel.has(id) ? sel.delete(id) : sel.add(id); render(); }

  document.addEventListener("click", (e) => {
    const t = e.target;
    const info = t.closest("[data-info]");
    if (info) return details(info.dataset.info);
    const it = t.closest(".item");
    if (it) { toggle(it.dataset.id); return; }
    if (t.closest("[data-close]") || t.id === "scrim") return closeSheet();
    const tg = t.closest("[data-tog]");
    if (tg) { closeSheet(); toggle(tg.dataset.tog); return; }
    const cb = t.closest("[data-cat]");
    if (cb) { fcat = cb.dataset.cat; return renderCatalog(); }
    const rb = t.closest("[data-repo]");
    if (rb) { frepo = frepo === rb.dataset.repo ? "" : rb.dataset.repo; return renderCatalog(); }
    if (t.closest("[data-all]")) { C.agents.forEach((a) => sel.delete(a.id)); return render(); }
    const ag = t.closest("[data-tgt]");
    if (ag) { const id = ag.dataset.tgt; sel.has(id) ? sel.delete(id) : sel.add(id); return render(); }
    const pk = t.closest(".pack");
    if (pk) { const p = C.packs[+pk.dataset.i]; p.ids.forEach((i) => sel.add(i)); if (p.docker) dock = true; render(); toast(`${p.name} kit added`); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); trapTab(e); });

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
    $("#packs").innerHTML = C.packs.map((p, i) => `<button class="pack" type="button" data-i="${i}"><b>${esc(p.name)}</b><span>${esc(p.ds)}</span></button>`).join("");
    $("#q").addEventListener("input", (e) => { q = e.target.value; renderCatalog(); });
    $("#clear").onclick = () => { sel.clear(); dock = false; renderCatalog(); };
    $("#dryflag").onclick = () => { dry = !dry; sync(); };
    $("#dock").onchange = (e) => { dock = e.target.checked; sync(); };
    $("#copy").onclick = () => copy(command(), "Command copied");
    $("#link").onclick = () => copy(location.href.split("#")[0] + "#" + code(), "Share link copied");
    $("#view").onclick = async () => {
      try {
        const s = await script();
        openSheet(`<h3 id="sheet-title">${esc(C.site.host)}</h3><p>The full script your line runs, with your picks baked in. Save it as <code>kitenm.sh</code> and run <code>bash kitenm.sh --dry-run</code> to preview. It works without this website.</p><pre tabindex="0">${esc(s)}</pre><div class="row"><button class="btn" type="button" data-close>Close</button><button class="btn pri" type="button" id="cs">Copy script</button></div>`);
        $("#cs").onclick = () => copy(s, "Script copied");
      } catch (err) { toast("Couldn't load the script"); }
    };
    $("#dl").onclick = async () => {
      try {
        const s = await script();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([s], { type: "text/x-shellscript" }));
        a.download = "kitenm.sh";
        document.body.appendChild(a); a.click(); a.remove();
        toast("Downloaded kitenm.sh");
      } catch (err) { toast("Couldn't build the script"); }
    };
    $("#theme").onclick = () => {
      const root = document.documentElement;
      const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      root.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("theme", root.dataset.theme); } catch (e) { /* private mode */ }
    };
    window.addEventListener("hashchange", () => { if (location.hash.slice(1) !== code()) load(); });
    load();
    window.Kitem = { command, wire, embed, code, script, get state() { return { sel: [...sel], dock, dry }; } };
  }

  fetch("catalog.json")
    .then((r) => r.json())
    .then(init)
    .catch(() => { $("#cat").innerHTML = '<p class="empty">Couldn\'t load the catalog. Reload the page, or run <code>curl -fsSL kitenm.sh | bash -s -- --list</code>.</p>'; });
})();
