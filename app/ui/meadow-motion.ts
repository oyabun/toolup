// @ts-nocheck
// The meadow's two motion engines, exactly as they come in the artwork's own file (agent-meadow.html): one bends each
// companion's picture a little (a breath, a wave of a hand) and one moves the sea. Neither changes the artwork. They are
// kept as written, with one change marked "Tool up!": the sea's waves travel from right to left instead of rocking in
// place. meadow-live.ts is what drives them.
/* eslint-disable */
  /* Agent meadow: grounded pixel-art deformation, no asset rewriting.
 *
 * Browser: window.createAgentMotion({agent, canvas, shadedCanvas, sourceImage})
 * Node: require(...).createAgentMotion({... , createCanvas})
 *
 * Both output canvases occupy the existing alpha-bounds wrapper, with
 * position:absolute; inset:0; width:100%; height:100%; image-rendering:pixelated.
 * Keep the shaded canvas inside the existing CSS-filtered/world-masked overlay.
 * No extra gutter or change to the scene anchor is needed.
 *
 * Scheduling, visibility, reduced motion and freezing a selected sprite belong
 * to the caller. render(..., {playing:false}) resets; skip render calls to freeze.
 * Movement amount accepts 0..3 (default 1.8); periods are unchanged.
 */
(function (host) {
  "use strict";

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const smooth = (low, high, value) => {
    const t = clamp((value - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const breath = (region, pivot, amplitude, seconds) =>
    ({ type: "breath", region, pivot, amplitude, seconds, active: 1 });
  const rotate = (region, pivot, amplitude, seconds, active = .68) =>
    ({ type: "rotate", region, pivot, amplitude, seconds, active });

  const PROFILES = {
    "claude-code": {
      motions: [
        breath([.16, 0, .84, .69], [.50, .71], .009, 4.6),
        rotate([.75, .05, .96, .40], [.78, .40], 1.4, 6.1)
      ],
      fixed: [[.40, .80, .66, 1], [.82, .75, 1, .94]]
    },
    "codex-cli": {
      motions: [breath([.08, 0, .75, .76], [.39, .79], .008, 5.2)],
      fixed: [[0, .75, .18, .88], [.73, .78, 1, 1], [.25, .80, .60, .91]]
    },
    "gemini-cli": {
      motions: [breath([0, 0, .81, .73], [.42, .66], .010, 4)],
      fixed: [[.13, .73, .37, .87], [.82, .76, 1, .94], [.54, .94, .62, 1]]
    },
    "kiro": {
      motions: [
        breath([.30, 0, 1, .82], [.62, .84], .011, 5.8),
        rotate([0, .44, .38, .88], [.33, .73], 1.5, 7.2, .82)
      ],
      fixed: [[.22, .88, .72, 1], [.79, .79, .99, .92]]
    },
    "cursor": {
      motions: [rotate([.70, .03, 1, .52], [.73, .48], 2, 5.4)],
      fixed: [[0, .78, .21, .95], [.39, .74, .82, 1]]
    },
    "vscode-copilot": {
      motions: [
        rotate([0, .20, .28, .78], [.23, .77], 2.6, 3.8, .86),
        rotate([.66, .46, 1, .78], [.83, .78], .7, 6, .72)
      ],
      fixed: [[.45, .84, .78, 1], [.83, .84, 1, .99]]
    },
    "windsurf": {
      motions: [
        breath([.05, 0, .94, .82], [.45, .89], .008, 4.7),
        rotate([.73, .17, 1, .58], [.74, .59], 1.5, 6.3)
      ],
      fixed: [[0, .72, .15, 1], [.36, .86, .54, 1]]
    },
    "cline": {
      motions: [
        rotate([0, .48, .40, .75], [.35, .70], 3, 4.9, .62),
        rotate([.78, 0, .98, .22], [.80, .22], 1.8, 6.5, .76)
      ],
      fixed: [[.20, .84, .45, .99], [.49, .91, .71, 1], [.73, .83, .94, .97]]
    },
    "qwen-code": {
      motions: [breath([.02, 0, .99, .80], [.50, .84], .008, 6.2)],
      fixed: [[.11, .83, .89, 1], [.08, .79, .26, .87], [.77, .79, .94, .87]]
    },
    "deepseek-harness": {
      motions: [
        rotate([.65, 0, 1, .72], [.72, .68], 2.4, 4.2, 1),
        rotate([.38, .57, .58, .90], [.40, .63], 2, 5.6, .8)
      ],
      // The cyan waterline and attached ripple marks stay fixed.
      fixed: [[.12, .91, .69, 1]]
    },
    "openclaw": {
      motions: [
        rotate([.14, 0, .56, .45], [.29, .41], 1.6, 5.3, .72),
        rotate([0, .37, .24, .79], [.21, .77], 2, 6.8, .60)
      ],
      fixed: [[.24, .82, 1, 1]]
    },
    "goose": {
      motions: [
        rotate([.20, 0, .70, .55], [.35, .56], 1.3, 4.9, .76),
        rotate([.47, .28, 1, .77], [.49, .68], 1.4, 6.1, .64)
      ],
      fixed: [[.12, .85, .73, 1]]
    },
    "pi": {
      motions: [rotate([0, 0, .96, .46], [.48, .44], .7, 5.7, .90)],
      fixed: [[0, .75, .24, .92], [.35, .78, 1, 1]]
    },
    "hermes-agent": {
      motions: [
        rotate([.27, 0, .90, .46], [.65, .47], .8, 5.6, .74),
        rotate([.27, .06, .50, .24], [.49, .23], 2.2, 7.1, .60)
      ],
      fixed: [[0, .86, .70, 1], [.80, .79, 1, .91]]
    }
  };
  const FALLBACK = {
    motions: [breath([.08, .05, .92, .78], [.5, .84], .009, 5.4)],
    fixed: [[.12, .91, .88, 1]]
  };

  function seedFor(id) {
    let hash = 2166136261;
    for (let index = 0; index < id.length; index++) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  function resolveProfile(value, id) {
    const named = typeof value === "string" ? value : value && value.base || id;
    const result = clone(PROFILES[named] || FALLBACK);
    if (value && typeof value === "object") {
      for (const key of ["motions", "fixed", "speed", "gain", "phase"]) {
        if (Object.prototype.hasOwnProperty.call(value, key)) result[key] = clone(value[key]);
      }
    }
    result.name = named;
    result.speed = clamp(finite(result.speed, 1), .05, 4);
    result.gain = clamp(finite(result.gain, 1), 0, 3);
    result.phase = finite(result.phase, seedFor(id));
    result.motions = Array.isArray(result.motions) ? result.motions : [];
    result.fixed = Array.isArray(result.fixed) ? result.fixed : [];
    return result;
  }

  function makeCanvas(options, width, height) {
    let canvas;
    if (typeof options.createCanvas === "function") canvas = options.createCanvas(width, height);
    else if (host.document && typeof host.document.createElement === "function") canvas = host.document.createElement("canvas");
    else if (typeof host.OffscreenCanvas === "function") canvas = new host.OffscreenCanvas(width, height);
    else throw new Error("A canvas factory is required outside the browser.");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function imageReady(image) {
    if (!image) return Promise.reject(new TypeError("sourceImage is required."));
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width > 0 && height > 0 && image.complete !== false) return Promise.resolve(image);
    if (typeof image.decode === "function") {
      return image.decode().then(() => image);
    }
    if (typeof image.addEventListener !== "function") {
      return width > 0 && height > 0
        ? Promise.resolve(image)
        : Promise.reject(new Error("The supplied image is not decoded."));
    }
    return new Promise((resolve, reject) => {
      function cleanup() {
        image.removeEventListener("load", loaded);
        image.removeEventListener("error", failed);
      }
      function loaded() { cleanup(); resolve(image); }
      function failed() { cleanup(); reject(new Error("Could not load the agent sprite.")); }
      image.addEventListener("load", loaded, { once: true });
      image.addEventListener("error", failed, { once: true });
      if (image.complete && !(image.naturalWidth > 0)) failed();
    });
  }

  function regionWeight(u, v, region) {
    if (!region || region.length !== 4) return 0;
    const [left, top, right, bottom] = region;
    if (u < left || u > right || v < top || v > bottom) return 0;
    const featherX = Math.min(.055, Math.max(.012, (right - left) * .12));
    const featherY = Math.min(.055, Math.max(.012, (bottom - top) * .12));
    const x = smooth(left, left + featherX, u) * (1 - smooth(right - featherX, right, u));
    const y = smooth(top, top + featherY, v) * (1 - smooth(bottom - featherY, bottom, v));
    return x * y;
  }

  function fixedWeight(u, v, regions) {
    let locked = 0;
    for (const region of regions) {
      const dx = Math.max(region[0] - u, 0, u - region[2]);
      const dy = Math.max(region[1] - v, 0, v - region[3]);
      locked = Math.max(locked, 1 - smooth(0, .025, Math.sqrt(dx * dx + dy * dy)));
    }
    return locked;
  }

  function oscillator(time, motion, phase) {
    const seconds = Math.max(.3, finite(motion.seconds, 5));
    const cycle = ((time / 1000 / seconds + phase) % 1 + 1) % 1;
    if (motion.type === "breath") return Math.sin(cycle * TAU);
    const active = clamp(finite(motion.active, .68), .15, 1);
    if (active >= .999) return Math.sin(cycle * TAU);
    if (cycle >= active) return 0;
    const t = cycle / active;
    // A gesture has a quiet start/end and then a real resting interval.
    return Math.sin(t * TAU) * Math.pow(Math.sin(t * Math.PI), 2) * 1.54;
  }

  function prepareMotions(profile, time, amount, width, height) {
    return profile.motions.map((motion, index) => {
      const region = motion.region || [0, 0, 1, 1];
      const pivot = motion.pivot || [.5, .8];
      const wave = oscillator(time * profile.speed, motion, profile.phase + index * .217 + finite(motion.phase, 0));
      const power = wave * amount * profile.gain;
      if (motion.type === "breath") {
        // At 192 logical pixels, the original fractional amplitudes can vanish.
        // A bounded pixel-space amplitude gives 1–2 px at the default 70%.
        const sensitivity = Math.abs(finite(motion.amplitude, .009)) / .009;
        const pixels = clamp(finite(motion.pixelAmplitude, 2.8 * sensitivity), .25, 4);
        return { type: "breath", region, pivot, pixels: pixels * power };
      }
      const requested = Math.abs(finite(motion.amplitude, 1)) * DEG;
      let radius = 0;
      for (const x of [region[0], region[2]]) {
        for (const y of [region[1], region[3]]) {
          radius = Math.max(radius, Math.hypot((x - pivot[0]) * width, (y - pivot[1]) * height));
        }
      }
      const visibleAngle = Math.min(5 * DEG, Math.max(requested, 2 / Math.max(radius, 1)));
      const sign = finite(motion.amplitude, 1) < 0 ? -1 : 1;
      const angle = visibleAngle * power * sign;
      return { type: "rotate", region, pivot, cosine: Math.cos(angle), sine: Math.sin(angle) };
    });
  }

  function createAgentMotion(options) {
    options = options || {};
    const agent = options.agent;
    if (!agent || !Array.isArray(agent.alphaBounds)) throw new TypeError("agent.alphaBounds is required.");
    const canvas = options.canvas;
    if (!canvas || typeof canvas.getContext !== "function") throw new TypeError("canvas is required.");
    const shadedCanvas = options.shadedCanvas || null;
    const sourceImage = options.sourceImage;
    const bounds = agent.alphaBounds.slice();
    const sourceWidth = bounds[2] - bounds[0];
    const sourceHeight = bounds[3] - bounds[1];
    if (!(sourceWidth > 0 && sourceHeight > 0)) throw new RangeError("Agent alpha bounds are empty.");

    const width = Math.round(clamp(finite(options.logicalWidth, 192), 96, 384));
    const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
    canvas.width = width;
    canvas.height = height;
    if (shadedCanvas) {
      shadedCanvas.width = width;
      shadedCanvas.height = height;
    }
    const context = canvas.getContext("2d", { alpha: true });
    const shadedContext = shadedCanvas && shadedCanvas.getContext("2d", { alpha: true });
    if (!context || shadedCanvas && !shadedContext) throw new Error("A 2D canvas context is required.");
    context.imageSmoothingEnabled = false;
    if (shadedContext) shadedContext.imageSmoothingEnabled = false;
    const texture = makeCanvas(options, width, height);
    const textureContext = texture.getContext("2d", { alpha: true });
    textureContext.imageSmoothingEnabled = false;
    let profile = resolveProfile(options.profile, agent.id || "agent");
    let loaded = false;
    let destroyed = false;
    let lastSignature = "";
    let pending = null;
    let lastError = null;
    let sourceData = null;
    let sourcePixels = null;
    let outputData = context.createImageData(width, height);
    let outputPixels = new Uint32Array(outputData.data.buffer, outputData.data.byteOffset, width * height);
    let ownership = new Uint8Array(width * height);
    let staticPixels = new Uint8Array(width * height);

    const columns = Math.round(clamp(finite(options.meshColumns, 10), 6, 16));
    const rows = Math.round(clamp(columns * height / width, 6, 14));
    const maximumStep = Math.max(1, Math.floor(Math.min(width / columns, height / rows) * .35));
    const vertices = [];
    const triangles = [];
    const triangleAreas = [];
    let lastMeshScale = 1;
    let minimumAreaRatio = 1;
    for (let row = 0; row <= rows; row++) {
      for (let column = 0; column <= columns; column++) {
        const u = column / columns;
        const v = row / rows;
        vertices.push({ u, v, x: Math.round(u * width), y: Math.round(v * height) });
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const a = row * (columns + 1) + column;
        const b = a + 1;
        const c = a + columns + 1;
        const d = c + 1;
        triangles.push([a, b, c], [b, d, c]);
      }
    }
    for (const indices of triangles) {
      const a = vertices[indices[0]], b = vertices[indices[1]], c = vertices[indices[2]];
      triangleAreas.push((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    }

    function copyShadedFrame(frame) {
      if (!shadedContext) return;
      shadedContext.setTransform(1, 0, 0, 1, 0, 0);
      // Identical input bytes for both surfaces, with no intermediate compositing.
      shadedContext.putImageData(frame, 0, 0);
    }

    function rebuildStaticPixels() {
      for (let y = 0; y < height; y++) {
        const v = (y + .5) / height;
        for (let x = 0; x < width; x++) {
          const u = (x + .5) / width;
          const edge = x === 0 || x === width - 1 || y === 0 || v >= .98;
          const fixed = profile.fixed.some(region =>
            u >= region[0] && u <= region[2] && v >= region[1] && v <= region[3]);
          const active = profile.motions.some(motion => {
            const region = motion.region || [0, 0, 1, 1];
            return u >= region[0] && u <= region[2] && v >= region[1] && v <= region[3];
          });
          // Pixel-level locks supplement the mesh vertex locks. A fixed contact
          // area remains exact even when a triangle straddles its boundary.
          staticPixels[y * width + x] = edge || fixed || !active ? 1 : 0;
        }
      }
    }

    function drawOriginal() {
      if (!loaded || destroyed) return false;
      if (lastSignature === "static") return false;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.putImageData(sourceData, 0, 0);
      copyShadedFrame(sourceData);
      lastSignature = "static";
      return true;
    }

    function deformVertices(time, amount) {
      const motions = prepareMotions(profile, time, amount, width, height);
      return vertices.map(vertex => {
        const { u, v } = vertex;
        let dx = 0, dy = 0;
        for (const motion of motions) {
          const weight = regionWeight(u, v, motion.region);
          if (weight <= 0) continue;
          const px = motion.pivot[0], py = motion.pivot[1];
          if (motion.type === "breath") {
            const spanY = Math.max(.05, Math.abs(py - motion.region[1]), Math.abs(py - motion.region[3]));
            const spanX = Math.max(.05, Math.abs(px - motion.region[0]), Math.abs(px - motion.region[2]));
            dx += (u - px) / spanX * motion.pixels * .26 * weight;
            dy += (v - py) / spanY * motion.pixels * weight;
          } else {
            const x = (u - px) * width, y = (v - py) * height;
            dx += (x * motion.cosine - y * motion.sine - x) * weight;
            dy += (x * motion.sine + y * motion.cosine - y) * weight;
          }
        }
        const boundary = smooth(0, .065, u) * smooth(0, .065, 1 - u) *
          smooth(0, .045, v) * smooth(0, .06, 1 - v);
        const floor = 1 - smooth(.88, .98, v);
        const free = boundary * floor * (1 - fixedWeight(u, v, profile.fixed));
        // Integral logical pixels avoid a soft, continually resampled wobble.
        const moveX = Math.round(clamp(dx * free, -maximumStep, maximumStep));
        const moveY = Math.round(clamp(dy * free, -maximumStep, maximumStep));
        return { x: clamp(vertex.x + moveX, 0, width), y: clamp(vertex.y + moveY, 0, height) };
      });
    }

    function preserveMeshOrientation(candidate) {
      // Stronger amounts may otherwise collapse a cell near a fixed region.
      // Keep every triangle positively oriented, with at least 20% source area.
      let scale = 1;
      for (let attempt = 0; attempt < 10; attempt++) {
        const trial = scale === 1 ? candidate : candidate.map((point, index) => ({
          x: vertices[index].x + Math.round((point.x - vertices[index].x) * scale),
          y: vertices[index].y + Math.round((point.y - vertices[index].y) * scale)
        }));
        let minimum = Infinity;
        for (let index = 0; index < triangles.length; index++) {
          const indices = triangles[index];
          const a = trial[indices[0]], b = trial[indices[1]], c = trial[indices[2]];
          const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
          minimum = Math.min(minimum, area / triangleAreas[index]);
        }
        if (minimum >= .20) {
          lastMeshScale = scale;
          minimumAreaRatio = minimum;
          return trial;
        }
        scale *= .70;
      }
      lastMeshScale = 0;
      minimumAreaRatio = 1;
      return vertices.map(point => ({ x: point.x, y: point.y }));
    }

    function drawTriangle(indices, displaced) {
      const s0 = vertices[indices[0]], s1 = vertices[indices[1]], s2 = vertices[indices[2]];
      const d0 = displaced[indices[0]], d1 = displaced[indices[1]], d2 = displaced[indices[2]];
      const ux = d1.x - d0.x, uy = d1.y - d0.y;
      const vx = d2.x - d0.x, vy = d2.y - d0.y;
      const determinant = ux * vy - uy * vx;
      if (Math.abs(determinant) < .001) return;
      const left = Math.max(0, Math.ceil(Math.min(d0.x, d1.x, d2.x) - .5));
      const right = Math.min(width - 1, Math.floor(Math.max(d0.x, d1.x, d2.x) - .5));
      const top = Math.max(0, Math.ceil(Math.min(d0.y, d1.y, d2.y) - .5));
      const bottom = Math.min(height - 1, Math.floor(Math.max(d0.y, d1.y, d2.y) - .5));
      if (left > right || top > bottom) return;
      const inverse = 1 / determinant;
      const w1StepX = vy * inverse, w1StepY = -vx * inverse;
      const w2StepX = -uy * inverse, w2StepY = ux * inverse;
      const sx1 = s1.x - s0.x, sy1 = s1.y - s0.y;
      const sx2 = s2.x - s0.x, sy2 = s2.y - s0.y;
      const sampleStepX = w1StepX * sx1 + w2StepX * sx2;
      const sampleStepY = w1StepX * sy1 + w2StepX * sy2;
      const firstX = left + .5 - d0.x;
      const firstY = top + .5 - d0.y;
      const firstW1 = (firstX * vy - firstY * vx) * inverse;
      const firstW2 = (ux * firstY - uy * firstX) * inverse;
      const epsilon = 1e-7;
      for (let y = top; y <= bottom; y++) {
        const row = y - top;
        let w1 = firstW1 + row * w1StepY;
        let w2 = firstW2 + row * w2StepY;
        let sourceX = s0.x + w1 * sx1 + w2 * sx2;
        let sourceY = s0.y + w1 * sy1 + w2 * sy2;
        let destination = y * width + left;
        for (let x = left; x <= right; x++, destination++) {
          if (!ownership[destination] && w1 >= -epsilon && w2 >= -epsilon && w1 + w2 <= 1 + epsilon) {
            // Pixel-center inverse mapping + nearest-neighbor sampling. There
            // is no antialiased triangle coverage and no alpha blending.
            let sampleX = Math.floor(sourceX);
            let sampleY = Math.floor(sourceY);
            sampleX = sampleX < 0 ? 0 : sampleX >= width ? width - 1 : sampleX;
            sampleY = sampleY < 0 ? 0 : sampleY >= height ? height - 1 : sampleY;
            outputPixels[destination] = sourcePixels[sampleY * width + sampleX];
            ownership[destination] = 1;
          }
          w1 += w1StepX;
          w2 += w2StepX;
          sourceX += sampleStepX;
          sourceY += sampleStepY;
        }
      }
    }

    function render(timeMs, state) {
      if (destroyed) return false;
      state = state || {};
      if (!loaded) {
        pending = { time: timeMs, state: Object.assign({}, state) };
        return false;
      }
      const amount = clamp(finite(state.amount, 1.8), 0, 3);
      if (state.playing === false || amount === 0) return drawOriginal();
      const displaced = preserveMeshOrientation(deformVertices(finite(timeMs, 0), amount));
      const signature = displaced.map(point => point.x + "," + point.y).join(";");
      if (signature === lastSignature) return false;
      const unchanged = displaced.every((point, index) => point.x === vertices[index].x && point.y === vertices[index].y);
      if (unchanged) return drawOriginal();
      // Start from the exact cached original. Locked pixels stay byte-identical;
      // every free destination pixel is assigned to at most one triangle.
      outputPixels.set(sourcePixels);
      ownership.set(staticPixels);
      for (const triangle of triangles) drawTriangle(triangle, displaced);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.putImageData(outputData, 0, 0);
      copyShadedFrame(outputData);
      lastSignature = signature;
      return true;
    }

    function reset() {
      pending = null;
      return drawOriginal();
    }

    function setProfile(value) {
      profile = resolveProfile(value, agent.id || "agent");
      rebuildStaticPixels();
      lastSignature = "";
      return clone(profile);
    }

    function destroy() {
      destroyed = true;
      pending = null;
      texture.width = 0;
      texture.height = 0;
      sourceData = null;
      sourcePixels = null;
      outputData = null;
      outputPixels = null;
      ownership = null;
      staticPixels = null;
      // Output canvases retain the last frame; the caller owns their DOM lifetime.
    }

    const api = {
      ready: null,
      render,
      reset,
      setProfile,
      destroy,
      width,
      height,
      get loaded() { return loaded; },
      get error() { return lastError; },
      get profile() { return clone(profile); },
      get diagnostics() {
        return { maximumStep, lastMeshScale, minimumAreaRatio, columns, rows };
      }
    };
    api.ready = imageReady(sourceImage).then(() => {
      if (destroyed) return api;
      textureContext.clearRect(0, 0, width, height);
      textureContext.imageSmoothingEnabled = false;
      textureContext.drawImage(sourceImage, bounds[0], bounds[1], sourceWidth, sourceHeight, 0, 0, width, height);
      // The only source pixel read. Animation frames reuse this immutable cache.
      sourceData = textureContext.getImageData(0, 0, width, height);
      sourcePixels = new Uint32Array(sourceData.data.buffer, sourceData.data.byteOffset, width * height);
      rebuildStaticPixels();
      loaded = true;
      drawOriginal();
      if (pending) {
        const request = pending;
        pending = null;
        render(request.time, request.state);
      }
      return api;
    }).catch(error => {
      lastError = error;
      throw error;
    });
    return api;
  }

  host.createAgentMotion = createAgentMotion;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createAgentMotion, profiles: clone(PROFILES) };
  }
}(typeof globalThis !== "undefined" ? globalThis : window));

  /* Agent meadow: an authored, water-only pixel motion overlay.
 * Canvas: absolute inset:0; width:100%; height:100%; pointer-events:none;
 * image-rendering:pixelated. Put above the unchanged background, below sprites.
 * Caller owns the clock, 8fps cap, visibility, pause and reduced-motion handling.
 * Movement amount accepts 0..3 (default 1.8); glint intensity stops increasing at 1.
 */
(function (host) {
  "use strict";
  const REFERENCE_WIDTH = 2172;
  const REFERENCE_HEIGHT = 724;
  const TAU = Math.PI * 2;
  const WATER_POLYGON = [
    [1215, 360], [2172, 360], [2172, 724], [2045, 724],
    [1930, 708], [1810, 688], [1700, 665], [1595, 643],
    [1550, 619], [1510, 591], [1420, 568], [1395, 557],
    [1415, 546], [1415, 531], [1370, 523], [1355, 502],
    [1305, 492], [1242, 481], [1217, 462], [1165, 451],
    [1110, 435], [1045, 415], [980, 400], [920, 389],
    [894, 383], [1040, 379], [1145, 365]
  ];
  // Detached rock/foam and two shore plants protruding into the water polygon.
  const EXCLUSIONS = [
    [1558, 584, 1720, 657],
    [1005, 390, 1065, 429],
    [1125, 425, 1158, 453]
  ];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  function smooth(low, high, value) {
    const t = clamp((value - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function imageReady(image) {
    if (!image) return Promise.reject(new TypeError("sourceImage is required."));
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width > 0 && height > 0 && image.complete !== false) return Promise.resolve(image);
    if (typeof image.decode === "function") return image.decode().then(() => image);
    if (typeof image.addEventListener !== "function") {
      return width > 0 && height > 0 ? Promise.resolve(image) : Promise.reject(new Error("Scene image is not decoded."));
    }
    return new Promise((resolve, reject) => {
      function cleanup() { image.removeEventListener("load", loaded); image.removeEventListener("error", failed); }
      function loaded() { cleanup(); resolve(image); }
      function failed() { cleanup(); reject(new Error("Could not load the meadow background.")); }
      image.addEventListener("load", loaded, { once: true });
      image.addEventListener("error", failed, { once: true });
      if (image.complete && !(image.naturalWidth > 0)) failed();
    });
  }
  function makeCanvas(options, width, height) {
    let result;
    if (typeof options.createCanvas === "function") result = options.createCanvas(width, height);
    else if (host.document && host.document.createElement) result = host.document.createElement("canvas");
    else if (typeof host.OffscreenCanvas === "function") result = new host.OffscreenCanvas(width, height);
    else throw new Error("A createCanvas function is required outside a browser.");
    result.width = width;
    result.height = height;
    return result;
  }
  function createSeaMotion(options) {
    options = options || {};
    const canvas = options.canvas;
    const sourceImage = options.sourceImage;
    const scene = options.scene || {};
    if (!canvas || typeof canvas.getContext !== "function") throw new TypeError("canvas is required.");
    const width = Math.round(finite(scene.width, REFERENCE_WIDTH));
    const height = Math.round(finite(scene.height, REFERENCE_HEIGHT));
    if (!(width > 0 && height > 0)) throw new RangeError("Scene dimensions must be positive.");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("A 2D canvas context is required.");
    context.imageSmoothingEnabled = false;
    const length = width * height;
    const sx = width / REFERENCE_WIDTH, sy = height / REFERENCE_HEIGHT;
    const polygon = WATER_POLYGON.map(point => [point[0] * sx, point[1] * sy]);
    const exclusions = EXCLUSIONS.map(rect => [rect[0] * sx, rect[1] * sy, rect[2] * sx, rect[3] * sy]);
    let sourceData = null;
    let sourcePixels = null;
    let frame = context.createImageData(width, height);
    let pixels = new Uint32Array(frame.data.buffer, frame.data.byteOffset, length);
    let water = new Uint8Array(length);
    let weights = new Uint8Array(length);
    let runs = [];
    let glints = [];
    let palette = null;
    const bandSize = Math.max(2, Math.round(4 * sy));
    const bandCount = Math.ceil(height / bandSize);
    let shifts = new Int16Array(bandCount * 17);
    // Tool up!: the waves travel. Each band's shift is a wave along x that moves from right to left (toward the shore),
    // kept as one value for every 4 px column of every band and worked out again each frame.
    const waveCell = 4;
    const waveCols = Math.ceil(width / waveCell) + 1;
    let waveShift = new Float32Array(bandCount * waveCols);
    let loaded = false;
    let destroyed = false;
    let cleared = true;
    let pending = null;
    let lastSignature = "";
    let lastError = null;
    let waterPixels = 0;
    let activePixels = 0;
    let renderedFrames = 0;

    function makeGeometryMask() {
      const mask = new Uint8Array(length);
      const minY = Math.max(0, Math.floor(Math.min(...polygon.map(point => point[1]))));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(...polygon.map(point => point[1]))));
      for (let y = minY; y <= maxY; y++) {
        const scanY = y + .5;
        const crossings = [];
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const a = polygon[j], b = polygon[i];
          if ((a[1] <= scanY && b[1] > scanY) || (b[1] <= scanY && a[1] > scanY)) {
            crossings.push(a[0] + (scanY - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
          }
        }
        crossings.sort((a, b) => a - b);
        for (let i = 0; i + 1 < crossings.length; i += 2) {
          const left = Math.max(1, Math.ceil(crossings[i] - .5));
          const right = Math.min(width - 2, Math.floor(crossings[i + 1] - .5));
          if (right >= left && y > 0 && y < height - 1) mask.fill(1, y * width + left, y * width + right + 1);
        }
      }
      for (const rect of exclusions) {
        const left = clamp(Math.floor(rect[0]), 0, width), right = clamp(Math.ceil(rect[2]), 0, width);
        const top = clamp(Math.floor(rect[1]), 0, height), bottom = clamp(Math.ceil(rect[3]), 0, height);
        for (let y = top; y < bottom; y++) mask.fill(0, y * width + left, y * width + right);
      }
      return mask;
    }

    function prepareWater() {
      const geometry = makeGeometryMask();
      const blueWater = new Uint8Array(length);
      const rgba = sourceData.data;
      for (let i = 0; i < length; i++) {
        if (!geometry[i]) continue;
        const j = i * 4, r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
        // Cool blue/turquoise water. Geometry and exclusions protect the shore.
        if (rgba[j + 3] >= 245 && g >= 100 && b >= 130 && g - r >= 18 && b - r >= 28 && b >= g - 38) {
          blueWater[i] = 1;
          water[i] = 1;
        }
      }
      const neighborStep = Math.max(3, Math.round(6 * sx));
      for (let i = 0; i < length; i++) {
        if (!geometry[i] || water[i]) continue;
        const j = i * 4, r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
        if (!(rgba[j + 3] >= 245 && r >= 155 && g >= 175 && b >= 145)) continue;
        const x = i % width, y = (i / width) | 0;
        let neighbors = 0;
        for (const dy of [-neighborStep, 0, neighborStep]) {
          for (const dx of [-neighborStep, 0, neighborStep]) {
            if (!(dx || dy)) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) neighbors += blueWater[ny * width + nx];
          }
        }
        // Preserve the existing warm sun-reflection streaks inside known water.
        const reflection = x >= 1240 * sx && x <= 1370 * sx && y >= 360 * sy && y <= 450 * sy;
        if (neighbors >= 4 || reflection) water[i] = 1;
      }

      const distance = new Uint16Array(length);
      for (let i = 0; i < length; i++) distance[i] = water[i] ? 255 : 0;
      for (let y = 1; y < height - 1; y++) {
        let i = y * width + 1;
        for (let x = 1; x < width - 1; x++, i++) {
          if (!water[i]) continue;
          distance[i] = Math.min(distance[i], distance[i - 1] + 1, distance[i - width] + 1,
            distance[i - width - 1] + 1, distance[i - width + 1] + 1);
        }
      }
      for (let y = height - 2; y > 0; y--) {
        let i = y * width + width - 2;
        for (let x = width - 2; x > 0; x--, i--) {
          if (!water[i]) continue;
          distance[i] = Math.min(distance[i], distance[i + 1] + 1, distance[i + width] + 1,
            distance[i + width - 1] + 1, distance[i + width + 1] + 1);
        }
      }
      const pin = Math.max(3, Math.round(3 * sx));
      const feather = Math.max(pin + 6, Math.round(18 * sx));
      let aquaDistance = Infinity, creamDistance = Infinity;
      let aquaPixel = 0, creamPixel = 0;
      for (let y = 0; y < height; y++) {
        let start = -1;
        for (let x = 0; x <= width; x++) {
          const i = y * width + x;
          const eligible = x < width && water[i];
          if (eligible) {
            waterPixels++;
            weights[i] = Math.round(smooth(pin, feather, distance[i]) * 16);
            if (weights[i] > 0) activePixels++;
            if (start < 0) start = x;
            const j = i * 4, r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
            const da = (r - 180) ** 2 + (g - 235) ** 2 + (b - 225) ** 2;
            const dc = (r - 249) ** 2 + (g - 242) ** 2 + (b - 215) ** 2;
            if (da < aquaDistance) { aquaDistance = da; aquaPixel = sourcePixels[i]; }
            if (dc < creamDistance) { creamDistance = dc; creamPixel = sourcePixels[i]; }
          } else if (start >= 0) {
            runs.push({ y, left: start, right: x, band: Math.floor(y / bandSize) });
            start = -1;
          }
        }
      }
      palette = [aquaPixel, creamPixel];
      let seed = 0x4d454144;
      function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
      for (let attempt = 0; attempt < 160 && glints.length < 14; attempt++) {
        const x = Math.round((.56 + random() * .42) * width / 2) * 2;
        const y = Math.round((.53 + random() * .43) * height / 2) * 2;
        const i = y * width + x;
        if (x < 10 || x >= width - 10 || y < 5 || y >= height - 5 || !water[i] || distance[i] < feather + 8) continue;
        if (rgba[i * 4] > 180) continue;
        glints.push({
          x, y,
          period: 10000 + random() * 9000,
          duration: 1000 + random() * 600,
          phase: random(),
          width: Math.max(4, Math.round((5 + random() * 4) * sx)),
          height: Math.max(1, Math.round(2 * sy))
        });
      }
    }

    function prepareShifts(timeMs, amount) {
      let signature = "";
      for (let band = 0; band < bandCount; band++) {
        const y = (band + .5) * bandSize / height;
        const depth = smooth(.50, .99, y);
        // nearer water (lower in the scene) has longer, slower waves; sin(kx + wt) moves toward smaller x: right to left
        const length = (70 + depth * 150) * sx, seconds = 3400 + depth * 1800;
        const reach = (5 + depth * 2) * sx * amount / 16;
        const row = band * waveCols;
        for (let col = 0; col < waveCols; col++) {
          const x = col * waveCell;
          const wave = Math.sin((x / length + timeMs / seconds) * TAU + band * .61) * .72 +
            Math.sin((x / (length * 2.3) + timeMs / (seconds * 1.7)) * TAU - band * .29 + 1.4) * .28;
          waveShift[row + col] = reach * wave;
        }
      }
      signature = String(Math.round(timeMs / 40));
      return signature;
    }

    function glintLevels(timeMs, amount) {
      const glintAmount = clamp(amount, 0, 1);
      return glints.map(glint => {
        const phase = ((timeMs + glint.phase * glint.period) % glint.period + glint.period) % glint.period;
        if (phase >= glint.duration) return 0;
        const pulse = Math.sin(phase / glint.duration * Math.PI) ** 2;
        return clamp(Math.floor(pulse * glintAmount * 4), 0, 3);
      });
    }

    function paintGlints(levels) {
      let count = 0;
      for (let i = 0; i < glints.length && count < 3; i++) {
        const level = levels[i];
        if (!level) continue;
        const glint = glints[i];
        const glintWidth = Math.max(3, Math.round(glint.width * (.45 + level * .18)));
        const left = glint.x - Math.floor(glintWidth / 2);
        const color = palette[level >= 2 ? 1 : 0];
        for (let y = glint.y; y < glint.y + glint.height; y++) {
          for (let x = left; x < left + glintWidth; x++) {
            const index = y * width + x;
            if (water[index] && weights[index] >= 12) {
              const end = x === left || x === left + glintWidth - 1;
              pixels[index] = end ? palette[0] : color;
            }
          }
        }
        count++;
      }
    }

    function reset() {
      pending = null;
      if (destroyed || cleared) return false;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      pixels.fill(0);
      lastSignature = "";
      cleared = true;
      return true;
    }

    function render(timeMs, state) {
      if (destroyed) return false;
      state = state || {};
      if (!loaded) { pending = { time: timeMs, state: Object.assign({}, state) }; return false; }
      const amount = clamp(finite(state.amount, 1.8), 0, 3);
      if (state.playing === false || amount === 0) return reset();
      const time = finite(timeMs, 0);
      const levels = glintLevels(time, amount);
      const signature = prepareShifts(time, amount) + "|" + levels.join(",");
      if (!cleared && signature === lastSignature) return false;
      for (const run of runs) {
        const row = run.y * width;
        const bandOffset = run.band * waveCols;
        for (let x = run.left; x < run.right; x++) {
          const index = row + x;
          const displacement = Math.round(waveShift[bandOffset + (x >> 2)] * weights[index]);
          const sampleX = x + displacement;
          const sample = row + sampleX;
          // Both destination and sample must remain inside the authored water.
          // Explicit X bounds prevent larger shifts from wrapping to another row.
          pixels[index] = displacement && sampleX >= 0 && sampleX < width && water[sample]
            ? sourcePixels[sample] : sourcePixels[index];
        }
      }
      paintGlints(levels);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.putImageData(frame, 0, 0);
      lastSignature = signature;
      cleared = false;
      renderedFrames++;
      return true;
    }

    function destroy() {
      if (destroyed) return;
      reset();
      destroyed = true;
      pending = null;
      sourceData = null;
      sourcePixels = null;
      frame = null;
      pixels = null;
      water = null;
      weights = null;
      shifts = null;
      waveShift = null;
      runs = [];
      glints = [];
    }

    const api = {
      ready: null, render, reset, destroy, width, height,
      get loaded() { return loaded; },
      get error() { return lastError; },
      get diagnostics() {
        return { width, height, waterPixels, activePixels, runCount: runs.length, glintCount: glints.length, renderedFrames };
      },
      // Copies intended for read-only QA/debugging, never used in the frame loop.
      getMask() { return water ? water.slice() : null; },
      getWeights() { return weights ? weights.slice() : null; }
    };
    api.ready = imageReady(sourceImage).then(() => {
      if (destroyed) return api;
      const readCanvas = makeCanvas(options, width, height);
      const readContext = readCanvas.getContext("2d", { alpha: true });
      readContext.imageSmoothingEnabled = false;
      readContext.drawImage(sourceImage, 0, 0, width, height);
      sourceData = readContext.getImageData(0, 0, width, height);
      sourcePixels = new Uint32Array(sourceData.data.buffer, sourceData.data.byteOffset, length);
      readCanvas.width = 0;
      readCanvas.height = 0;
      prepareWater();
      loaded = true;
      if (pending) {
        const request = pending;
        pending = null;
        render(request.time, request.state);
      }
      return api;
    }).catch(error => { lastError = error; throw error; });
    return api;
  }
  host.createSeaMotion = createSeaMotion;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      createSeaMotion,
      WATER_POLYGON: WATER_POLYGON.map(point => point.slice()),
      EXCLUSIONS: EXCLUSIONS.map(rect => rect.slice()),
      REFERENCE_WIDTH, REFERENCE_HEIGHT
    };
  }
}(typeof globalThis !== "undefined" ? globalThis : window));

export const createAgentMotion = globalThis.createAgentMotion;
export const createSeaMotion = globalThis.createSeaMotion;
