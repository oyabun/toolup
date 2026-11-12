// The meadow, alive: the sea moves, each companion breathes or gestures, and the ones under the tree stand in its shade.
// The two engines (meadow-motion.ts) draw on canvases laid over the unchanged artwork. Those canvases are made once and
// put back into the scene after every repaint of the window, so a click elsewhere never restarts them.
import { createAgentMotion, createSeaMotion } from "./meadow-motion.ts";
import { SCENE } from "./meadow.ts";

/** How lively it is: the clock's speed, how far the companions move, how far the water moves, how dark the tree's shade is. */
export const LIVE = { speed: 1.4, motion: 2.4, water: 2.3, shade: 0.65 };
// the engines' motion profiles are named by the artwork's ids; these agents have another id here
const PROFILE: Record<string, string> = { codex: "codex-cli", gemini: "gemini-cli", vscode: "vscode-copilot", hermes: "hermes-agent" };

interface Renderer { ready: Promise<unknown>; render(time: number, state: { amount: number; playing: boolean }): boolean; reset(): unknown; destroy(): void }
interface Live { canvas: HTMLCanvasElement; shaded: HTMLCanvasElement; renderer: Renderer | null; ready: boolean }
const agents = new Map<string, Live>();
let sea: { canvas: HTMLCanvasElement; renderer: Renderer | null; ready: boolean } | null = null;
let raf = 0, prev: number | null = null, lastDraw = -Infinity, clock = 0;
let held = "", on = true;
const reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
const still = () => !on || !!reduced?.matches;
const scene = () => document.querySelector<HTMLElement>("#meadow");

/* ---- the tree's shade: one fixed field over the scene (soft ellipses under the tree, broken by patches of sun) ---- */
const smooth = (lo: number, hi: number, v: number) => { const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
function hash(x: number, y: number) {
  let v = Math.imul(x + 101, 374761393) + Math.imul(y + 173, 668265263);
  v = Math.imul(v ^ v >>> 13, 1274126177);
  return ((v ^ v >>> 16) >>> 0) / 4294967295;
}
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), tx = smooth(0, 1, x - ix), ty = smooth(0, 1, y - iy);
  const a = hash(ix, iy) * (1 - tx) + hash(ix + 1, iy) * tx, b = hash(ix, iy + 1) * (1 - tx) + hash(ix + 1, iy + 1) * tx;
  return a * (1 - ty) + b * ty;
}
const ellipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, weight: number) =>
  weight * (1 - smooth(0.45, 1.08, Math.hypot((x - cx) / rx, (y - cy) / ry)));
let masked = false;
function shadeMask() {
  if (masked) return;
  masked = true;
  try {
    const field = document.createElement("canvas");
    field.width = 360; field.height = Math.max(1, Math.round(360 * SCENE.height / SCENE.width));
    const ctx = field.getContext("2d")!, px = ctx.createImageData(field.width, field.height);
    for (let row = 0; row < field.height; row++) for (let col = 0; col < field.width; col++) {
      const x = (col + 0.5) / field.width * 100, y = (row + 0.5) / field.height * 100;
      const all = 1 - (1 - ellipse(x, y, 18, 63, 18, 17, 0.78)) * (1 - ellipse(x, y, 33, 67, 16, 10, 0.6)) * (1 - ellipse(x, y, 13, 57, 13, 14, 0.94));
      const ground = smooth(37, 45, y) * (1 - smooth(78, 85, y)), edge = 1 - smooth(48, 53, x);
      const sun = smooth(0.6, 0.83, noise(col / 6, row / 4)) * 0.31, dapple = 0.9 + 0.1 * noise(col / 2.5, row / 2.5);
      const o = (row * field.width + col) * 4;
      px.data[o] = px.data[o + 1] = px.data[o + 2] = 255;
      px.data[o + 3] = Math.round(255 * all * ground * edge * (1 - sun) * dapple);
    }
    ctx.putImageData(px, 0, 0);
    // drawn up to the scene's own size without smoothing, so the shade's edge is in the artwork's pixels
    const full = document.createElement("canvas");
    full.width = SCENE.width; full.height = SCENE.height;
    const fc = full.getContext("2d")!;
    fc.imageSmoothingEnabled = false;
    fc.drawImage(field, 0, 0, full.width, full.height);
    document.documentElement.style.setProperty("--meadow-shade", `url("${full.toDataURL("image/png")}")`);
    document.documentElement.style.setProperty("--meadow-shade-on", String(LIVE.shade));
  } catch { /* no canvas: the companions are simply not shaded */ }
}

const picture = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error(src)); i.src = src; });
const blank = (cls = "") => { const c = document.createElement("canvas"); c.className = cls; c.setAttribute("aria-hidden", "true"); return c; };

function startSea() {
  const mine: NonNullable<typeof sea> = sea = { canvas: blank("meadow-sea"), renderer: null, ready: false };
  mine.canvas.hidden = true;
  picture("./meadow/scene.webp").then((img) => {
    mine.renderer = createSeaMotion({ canvas: mine.canvas, sourceImage: img, scene: SCENE }) as Renderer;
    return mine.renderer.ready;
  }).then(() => { mine.ready = true; sync(); }).catch(() => { mine.renderer?.destroy(); mine.renderer = null; });   // the picture alone still shows
}
function startAgent(id: string) {
  const mine: Live = { canvas: blank(), shaded: blank(), renderer: null, ready: false };
  agents.set(id, mine);
  picture(`./meadow/${id}.webp`).then((img) => {
    const name = PROFILE[id] || id;
    mine.renderer = createAgentMotion({ agent: { id: name, alphaBounds: [0, 0, img.naturalWidth, img.naturalHeight] }, canvas: mine.canvas, shadedCanvas: mine.shaded, sourceImage: img, profile: name, logicalWidth: 192 }) as Renderer;
    return mine.renderer.ready;
  }).then(() => { mine.renderer!.reset(); mine.ready = true; attach(); sync(); }).catch(() => { mine.renderer?.destroy(); mine.renderer = null; });
}
/** Put the canvases into the scene that is on screen now: the sea over the background, each companion's two over its picture. */
function attach() {
  const sc = scene();
  if (!sc) return;
  if (sea && sea.canvas.parentElement !== sc) sc.querySelector(".meadow-bg")?.after(sea.canvas);
  sc.querySelectorAll<HTMLElement>("[data-meadow]").forEach((a) => {
    const live = agents.get(a.dataset.meadow!), shade = a.querySelector<HTMLElement>(".meadow-shade");
    if (!live?.ready || !shade || live.canvas.parentElement === a) return;
    a.insertBefore(live.canvas, shade); shade.appendChild(live.shaded); a.classList.add("live");
  });
}

function running() { return !still() && !document.hidden && !!scene(); }
function tick(now: number) {
  raf = 0;
  const sc = scene();
  if (!sc || !running()) { prev = null; return; }
  if (prev !== null) clock += Math.min(250, now - prev) * LIVE.speed;
  prev = now;
  if (now - lastDraw >= 125) {   // eight frames a second: it is pixel art, and it keeps the cost low
    lastDraw = now;
    const box = sc.getBoundingClientRect();
    if (box.bottom > 0 && box.top < innerHeight) {
      if (sea?.ready) sea.renderer!.render(clock, { amount: LIVE.water, playing: true });
      for (const [id, live] of agents) if (live.ready && id !== held && live.canvas.isConnected) live.renderer!.render(clock, { amount: LIVE.motion, playing: true });
    }
  }
  raf = requestAnimationFrame(tick);
}
function sync() {
  if (sea?.ready) { sea.canvas.hidden = still(); if (still()) sea.renderer!.reset(); }
  for (const [id, live] of agents) if (live.ready && (still() || id === held)) live.renderer!.reset();
  if (running()) { if (!raf) { prev = null; lastDraw = -Infinity; raf = requestAnimationFrame(tick); } }
  else { if (raf) cancelAnimationFrame(raf); raf = 0; prev = null; }
}
document.addEventListener("visibilitychange", sync);
reduced?.addEventListener?.("change", sync);

/** After the window is drawn: bring the scene to life. `hold` is the companion being arranged (it keeps still), `on` is the setting. */
export function mountMeadow(o: { hold: string; on: boolean }) {
  held = o.hold; on = o.on;
  const sc = scene();
  if (sc) {
    shadeMask();
    if (!sea) startSea();
    sc.querySelectorAll<HTMLElement>("[data-meadow]").forEach((a) => { if (!agents.has(a.dataset.meadow!)) startAgent(a.dataset.meadow!); });
    attach();
  }
  sync();
}
