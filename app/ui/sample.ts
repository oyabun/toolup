// A made-up machine, shown when the interface is opened in a plain browser (npm run ui:dev) instead of the app.
import type { Inventory, Item, Placement } from "../core/types.ts";

const at = (source: string, name: string, linked = false): Placement => ({ name, source, linked, linkTo: linked ? `~/.agents/skills/${name}` : null });
const mcp = (key: string, name: string, catalogId: string | null, target: string, hasSecrets: boolean, where: Record<string, string>, transport: Item["transport"] = "http"): Item => ({
  kind: "mcp", key, name, catalogId, description: null, transport, target, hasSecrets, store: null, origin: null,
  in: Object.fromEntries(Object.entries(where).map(([h, n]) => [h, at(`~/${h}/config`, n)])),
});
const skill = (id: string, name: string, catalogId: string | null, description: string, hs: string[]): Item => ({
  kind: "skill", key: `skill:${id}`, name, catalogId, description, transport: null, target: null, hasSecrets: false, store: null, origin: catalogId ? { repo: "example/skills", path: id, sha: "abc" } : null,
  in: Object.fromEntries(hs.map((h) => [h, at(h === "claude-code" ? `~/.claude/skills/${id}` : `~/.agents/skills/${id}`, id, h === "claude-code" && hs.length > 1)])),
});

export const sample: Inventory = {
  harnesses: [
    { id: "claude-code", name: "Claude Code", present: true, mcpFile: "~/.claude.json", problems: [] },
    { id: "codex", name: "Codex CLI", present: true, mcpFile: "~/.codex/config.toml", problems: [] },
    { id: "gemini", name: "Gemini CLI", present: true, mcpFile: "~/.gemini/settings.json", problems: [] },
    { id: "cursor", name: "Cursor", present: true, mcpFile: "~/.cursor/mcp.json", problems: [] },
    { id: "vscode", name: "VS Code + Copilot", present: false, mcpFile: null, problems: [] },
  ],
  plugins: [{ id: "productivity@knowledge-work-plugins", name: "productivity", market: "knowledge-work-plugins", version: "1.2.0", path: "", agents: ["claude-code", "codex"] }],
  items: [
    mcp("url:https://api.githubcopilot.com/mcp", "GitHub", "github", "https://api.githubcopilot.com/mcp", false, { "claude-code": "github", codex: "gh", cursor: "GitHub" }),
    mcp("url:https://mcp.sentry.dev/mcp", "Sentry", "sentry", "https://mcp.sentry.dev/mcp", false, { "claude-code": "sentry" }),
    mcp("url:https://mcp.linear.app/mcp", "Linear", "linear", "https://mcp.linear.app/mcp", false, { "claude-code": "linear", codex: "linear", cursor: "linear" }),
    mcp("url:https://mcp.notion.com/mcp", "Notion", "notion", "https://mcp.notion.com/mcp", false, { cursor: "notion" }),
    mcp("cmd:node /opt/tools/server.js", "internal-db", null, "node /opt/tools/server.js --api-key •••", true, { "claude-code": "internal-db" }, "stdio"),
    mcp("cmd:npx @modelcontextprotocol/server-filesystem /tmp", "files", null, "npx -y @modelcontextprotocol/server-filesystem /tmp", false, { codex: "files", cursor: "filesystem" }, "stdio"),
    skill("tdd", "TDD", "tdd", "Write the failing test first, then the code.", ["claude-code", "codex", "gemini", "cursor"]),
    skill("frontend-design", "Frontend Design", "frontend-design", "Distinctive, production-grade interfaces.", ["claude-code"]),
    skill("grill-me", "Grill Me", "grill-me", "Get questioned about a plan until it holds up.", ["claude-code", "codex", "gemini", "cursor"]),
    skill("release-notes", "release-notes", null, "House style for our release notes.", ["claude-code"]),
  ],
};
