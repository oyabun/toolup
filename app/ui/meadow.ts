// The meadow at the top of Installed: where each agent's companion sits by default (x and y are the point its feet touch,
// as a percentage of the scene; w is its width as a percentage of the scene's width; ratio is its height over its width).
// Made from the artwork's own manifest by the capture script; the pictures are in public/meadow/.
export const SCENE = { width: 2172, height: 724, alt: "A peaceful pixel-art coastal meadow with an open violet toolbox, skills and MCP tools." };
export interface Spot { x: number; y: number; w: number }
export const MEADOW: Record<string, Spot & { ratio: number; pose: string }> = {
  "claude-code": { x: 29, y: 76.5, w: 10.5, ratio: 0.6538, pose: "Reclining on its back with four short legs relaxed forward." },
  "codex": { x: 39, y: 76, w: 8, ratio: 0.8635, pose: "Leaning back on one arm with ankles crossed." },
  "gemini": { x: 48.5, y: 78, w: 7, ratio: 0.8192, pose: "Lying on its side, propped on an elbow with legs bent." },
  "kiro": { x: 12.5, y: 74, w: 5, ratio: 0.6769, pose: "Curled sideways in a sleepy resting pose." },
  "cursor": { x: 6, y: 94, w: 5.5, ratio: 0.7962, pose: "Seated with knees raised and one hand pointing upward-right." },
  "vscode": { x: 44, y: 96, w: 8, ratio: 0.6750, pose: "Lying on its belly with chin in hands and feet raised." },
  "windsurf": { x: 53.7, y: 95, w: 7, ratio: 0.6192, pose: "Stretching backward with arms spread." },
  "cline": { x: 6, y: 73, w: 4, ratio: 1.2846, pose: "Kneeling with one hand grounded and the other giving a small wave." },
  "qwen-code": { x: 18, y: 68, w: 4, ratio: 1.1981, pose: "Seated cross-legged in a meditative pose." },
  "deepseek-harness": { x: 76, y: 74, w: 13, ratio: 0.5192, pose: "Buoyant swimming pose with tail raised and small attached ripples." },
  "openclaw": { x: 61.8, y: 96.5, w: 7.5, ratio: 0.7442, pose: "Reclining with one claw near its head and the other across its belly." },
  "goose": { x: 71.7, y: 96, w: 4.2, ratio: 0.9135, pose: "Sitting with its neck curved back while preening a raised wing." },
  "pi": { x: 6, y: 52, w: 4, ratio: 0.8885, pose: "Seated with one leg extended, leaning to the side." },
  "hermes": { x: 39, y: 53, w: 4.2, ratio: 1.1250, pose: "Seated sideways with legs extended left and a staff across its lap." },
};
