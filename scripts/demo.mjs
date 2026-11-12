// Builds the desktop app's own interface into public/app/, where the landing shows it in a frame, running on sample
// data. The landing has no pictures of the app: what a visitor sees and clicks is this build, so it is never out of date.
// Vite comes from this folder's node_modules, or the app's, or VITE_FROM (a folder holding node_modules/vite).
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

export async function demo() {
  const entry = [process.env.VITE_FROM, root, join(root, "app")].filter(Boolean)
    .map((dir) => join(dir, "node_modules/vite/dist/node/index.js")).find(existsSync);
  if (!entry) {
    const why = "vite is not installed (run npm install), so public/app/ was not built";
    if (process.env.VERCEL || process.env.CI) throw new Error(why);   // never deploy a landing with an empty frame
    console.warn(`skipped the app demo: ${why}`);
    return false;
  }
  const { build } = await import(pathToFileURL(entry).href);
  await build({
    root: join(root, "app/ui"), base: "./", configFile: false, logLevel: "warn",
    build: { outDir: join(root, "public/app"), emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 2000 },
  });
  console.log("built: the app demo → public/app/");
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) await demo();
