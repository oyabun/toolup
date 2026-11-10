/* The hero's heatmap: a regular grid of small rounded squares across the full width, like a contribution graph, in five levels of
   intensity from pale to deep, blue on the left and violet on the right. Intensity is highest along the top and fades away
   toward the paragraph, with an irregular edge. The levels drift slowly (cells step up and down a level, they don't flicker) and the
   cells near the pointer heat up. The headline, paragraph and selector sit in cells kept clear.
   Decoration only: aria-hidden, a still frame under prefers-reduced-motion, and the page works without it. */
(() => {
  const canvas = document.getElementById("field");
  const ctx = canvas && canvas.getContext && canvas.getContext("2d");
  if (!ctx) return;
  const host = canvas.parentElement;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };

  // five levels, pale to deep, in a blue scale and a violet scale; the grid blends from one to the other across the page
  const PALETTE = {
    light: { blue: ["#ece7fb", "#d3c9f4", "#b2a3ea", "#8f7cd6"], violet: ["#f4eafb", "#e3ccf2", "#cba5e4", "#ab7ccb"], orange: ["#fdefe6", "#f9d9c2", "#f1b994", "#df9764"], empty: [150, 90, 240, 0.09] },
    dark: { blue: ["#2e2848", "#483f76", "#6a5ba5", "#9b8cd6"], violet: ["#3a2a4a", "#5d3f7b", "#8858ad", "#bb92dc"], orange: ["#42302b", "#6c4b3a", "#a3704e", "#d6a279"], empty: [190, 130, 255, 0.07] },
  };
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  for (const th of Object.values(PALETTE)) { th.blue = th.blue.map(rgb); th.violet = th.violet.map(rgb); th.orange = th.orange.map(rgb); }

  let bleed = 0, fadeW = 1, W = 0, H = 0, cols = 0, rows = 0, cell = 12, gap = 3, step = 15, dpr = 1, keep = [], timer = 0, visible = true;
  const t0 = performance.now();
  const pointer = { x: -1e4, y: -1e4, on: false };

  // cheap value noise: hashed lattice, smoothly interpolated
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function resize() {
    // the field reaches a little past the text column on both sides, so its edges are not a ruled line at the column's edge
    const hr = host.getBoundingClientRect();
    bleed = Math.max(0, Math.min(110, Math.floor(Math.min(hr.left, document.documentElement.clientWidth - hr.right))));
    host.style.setProperty("--bleed", bleed + "px");
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = W * dpr; canvas.height = H * dpr;
    const base = W < 560 ? 9 : 12;
    gap = W < 560 ? 2.5 : 3;
    // choose the column count so the grid ends exactly on both edges of the column: full width, no ragged side
    cols = Math.max(8, Math.round((W + gap) / (base + gap)));
    step = (W + gap) / cols; cell = step - gap;
    rows = Math.ceil((H + gap) / step);
    fadeW = bleed + 90;   // from the canvas edge inwards, dots thin out and fade over this distance
    keep = [...host.querySelectorAll(".eyebrow, h1, .lede, .hero-pick, .hero-art")].map((el) => {
      const b = el.getBoundingClientRect();
      return { x0: b.left - r.left - 8, y0: b.top - r.top - 8, x1: b.right - r.left + 8, y1: b.bottom - r.top + 8 };
    });
  }

  function square(x, y, s, radius) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, s, s, radius); ctx.fill(); }
    else ctx.fillRect(x, y, s, s);
  }

  function draw(now) {
    const th = PALETTE[dark() ? "dark" : "light"];
    const time = reduce ? 0 : now - t0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const radius = Math.max(2, cell * 0.22);

    // where the heat ends differs per column: a slow, wide noise raises it into tongues and lowers it into bays
    const front = new Float32Array(cols);
    for (let x = 0; x < cols; x++) {
      const u = (x + 0.5) / cols, f = 0.62 * noise(u * 2.6 + time * 0.00011, 4.2) + 0.38 * noise(u * 5.7 + 9 - time * 0.00007, 1.7);
      front[x] = 0.2 + 0.7 * smooth(clamp((f - 0.2) / 0.6)) + 0.3 * smooth(clamp((u - 0.5) / 0.4));
    }

    for (let y = 0; y < rows; y++) {
      const v = (y * step + cell / 2) / H;
      for (let x = 0; x < cols; x++) {
        const u = (x + 0.5) / cols, px = x * step, py = y * step, cx = px + cell / 2, cy = py + cell / 2;
        // toward the left and right edges the grid dissolves: fewer cells survive, and those that do are fainter
        const hf = smooth(clamp(Math.min(px, W - px - cell) / fadeW));
        if (hash(x * 3 + 11, y * 5 + 7) > hf * 1.15) continue;
        // like a contribution graph: every cell has its own activity, so the five levels are mixed everywhere and the deepest
        // is rare. The envelope only decides how much of that activity shows, dense along the top and fading toward the text.
        const env = clamp(1.1 - Math.pow(v / front[x], 1.8));
        const act = 0.46 * hash(x, y) + 0.24 * noise(x * 0.14 + time * 0.00026, y * 0.14 - time * 0.00032) + 0.30 * noise(x * 0.9 - time * 0.0005, y * 0.9 + time * 0.0004);
        let p = env * (act * 1.45 - 0.1);
        if (pointer.on) p += 0.8 * Math.exp(-(((cx - pointer.x) ** 2) + ((cy - pointer.y) ** 2)) / (2 * (step * 5) ** 2));
        let gate = 1;
        for (const r of keep) {                                // the grid fades out within three cells of the text
          const dx = Math.max(r.x0 - cx, 0, cx - r.x1), dy = Math.max(r.y0 - cy, 0, cy - r.y1);
          gate = Math.min(gate, clamp(Math.hypot(dx, dy) / (step * 3)));
        }
        gate *= 0.3 + 0.7 * hf;
        if (gate <= 0.02) continue;
        // five discrete levels, like a contribution graph: 0 is the faint empty cell
        const level = p < 0.2 ? 0 : p < 0.4 ? 1 : p < 0.6 ? 2 : p < 0.8 ? 3 : 4;
        let col, alpha;
        if (level === 0) {
          // empty cells stay visible near the top, so the grid reads as a graph, and fade out lower down
          const e = th.empty; alpha = e[3] * clamp(1.15 - v / 0.6) * gate; if (alpha < 0.012) continue;
          ctx.fillStyle = `rgba(${e[0]},${e[1]},${e[2]},${alpha.toFixed(3)})`;
        } else {
          const i = level - 1, b = th.blue[i], vi = th.violet[i], k = smooth(u);
          col = [lerp(b[0], vi[0], k) | 0, lerp(b[1], vi[1], k) | 0, lerp(b[2], vi[2], k) | 0];
          // a few cells run warm, more of them toward the right, where the headline's gradient ends in orange; they step through the
          // same levels as the others, so they move with the rest
          if (hash(x * 11 + 3, y * 17 + 9) < 0.22 * smooth(clamp((u - 0.45) / 0.5))) col = th.orange[i];
          alpha = gate;
          ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha.toFixed(3)})`;
        }
        square(Math.round(px), Math.round(py), Math.round(cell), radius);
      }
    }
  }

  function frame(now) { draw(now); timer = setTimeout(() => requestAnimationFrame(frame), 90); }   // ~11fps: levels step, they don't glide
  function start() { resize(); if (reduce) draw(0); else requestAnimationFrame(frame); }

  host.addEventListener("pointermove", (e) => { const r = canvas.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.on = true; if (reduce) draw(0); });
  host.addEventListener("pointerleave", () => { pointer.on = false; if (reduce) draw(0); });
  new ResizeObserver(() => { resize(); draw(performance.now()); }).observe(host);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => draw(performance.now()));
  new MutationObserver(() => draw(performance.now())).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // no point drawing what nobody sees: pause when the tab is hidden or the hero has scrolled away
  const pause = () => { clearTimeout(timer); timer = 0; };
  const resume = () => { if (!timer && !reduce && visible && !document.hidden) requestAnimationFrame(frame); };
  document.addEventListener("visibilitychange", () => (document.hidden ? pause() : resume()));
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? resume() : pause(); }).observe(host);
  start();
})();

/* The divider before the FAQ: the same cells as the hero (rounded squares, five levels, blue to violet), three or four rows deep,
   denser at the top and thinning toward the sides. Drawn once, and again on resize or theme change; it never moves. */
(() => {
  const canvas = document.getElementById("faq-rule");
  const ctx = canvas && canvas.getContext && canvas.getContext("2d");
  if (!ctx) return;
  const dark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const P = {
    light: { blue: ["#ece7fb", "#d3c9f4", "#b2a3ea", "#8f7cd6"].map(rgb), violet: ["#f4eafb", "#e3ccf2", "#cba5e4", "#ab7ccb"].map(rgb), orange: ["#fdefe6", "#f9d9c2", "#f1b994", "#df9764"].map(rgb), empty: [150, 90, 240, 0.09] },
    dark: { blue: ["#2e2848", "#483f76", "#6a5ba5", "#9b8cd6"].map(rgb), violet: ["#3a2a4a", "#5d3f7b", "#8858ad", "#bb92dc"].map(rgb), orange: ["#42302b", "#6c4b3a", "#a3704e", "#d6a279"].map(rgb), empty: [190, 130, 255, 0.07] },
  };
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  const smooth = (t) => t * t * (3 - 2 * t), clamp = (v) => Math.min(1, Math.max(0, v)), lerp = (a, b, t) => a + (b - a) * t;
  function draw() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const base = W < 560 ? 9 : 12, gap = W < 560 ? 2.5 : 3;
    const cols = Math.max(8, Math.round((W + gap) / (base + gap))), step = (W + gap) / cols, cell = step - gap;
    const rows = Math.max(2, Math.min(4, Math.floor((H + gap) / step)));
    const th = P[dark() ? "dark" : "light"], radius = Math.max(2, cell * 0.22), fadeW = Math.min(150, W * 0.16);
    for (let y = 0; y < rows; y++) {
      const env = Math.pow(1 - y / rows, 1.25);                   // the first row is the busiest, the last the faintest
      for (let x = 0; x < cols; x++) {
        const px = x * step, py = (rows - 1 - y) * step;          // the busy row sits at the bottom, against the FAQ
        const hf = smooth(clamp(Math.min(px, W - px - cell) / fadeW));
        if (hash(x * 3 + 5, y * 7 + 2) > hf * 1.15 * (0.4 + 0.6 * env)) continue;
        const u = (x + 0.5) / cols, p = env * (hash(x, y + 40) * 1.45 - 0.1) + 0.04;
        const level = p < 0.2 ? 0 : p < 0.4 ? 1 : p < 0.6 ? 2 : p < 0.8 ? 3 : 4;
        if (level === 0) { const e = th.empty; ctx.fillStyle = `rgba(${e[0]},${e[1]},${e[2]},${(e[3] * hf).toFixed(3)})`; }
        else {
          const i = level - 1, b = th.blue[i], v = th.violet[i], k = smooth(u);
          let c = [lerp(b[0], v[0], k) | 0, lerp(b[1], v[1], k) | 0, lerp(b[2], v[2], k) | 0];
          if (hash(x * 11 + 3, y * 17 + 9) < 0.22 * smooth(clamp((u - 0.45) / 0.5))) c = th.orange[i];   // the same warm cells as the hero
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.35 + 0.65 * hf).toFixed(3)})`;
        }
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(Math.round(px), Math.round(py), Math.round(cell), Math.round(cell), radius); else ctx.rect(Math.round(px), Math.round(py), Math.round(cell), Math.round(cell));
        ctx.fill();
      }
    }
  }
  new ResizeObserver(draw).observe(canvas);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  draw();
})();
