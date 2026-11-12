// Where each harness keeps its user-level MCP servers and skills.
// The catalog (catalog/agents.json) already says how to find a harness and, for some, where its config is;
// this adds what only reading needs. Project-level config is out of scope for now.
import type { CatalogAgent } from "./types.ts";

export interface McpSource {
  /** Candidate files, first existing wins. $HOME is expanded. */
  files: string[];
  format: "json" | "toml";
  /** The key (or TOML table) holding the servers. */
  key: string;
}
export interface HarnessRead {
  mcp: McpSource;
  /** Folders this harness loads skills from, its own first. */
  skills: string[];
}

// The folder the open `skills` CLI installs into and links from; harnesses without a folder of their own read it.
export const SHARED_SKILLS = "$HOME/.agents/skills";

const NO_SERVERS: McpSource = { files: [], format: "json", key: "mcpServers" };

/** Whether Tool up! can add MCP servers to this agent; false for the ones it only gives skills to. */
export const takesServers = (agent: CatalogAgent): boolean => agent.method !== "skills";

const READ: Record<string, HarnessRead> = {
  "claude-code": {
    mcp: { files: ["$HOME/.claude.json"], format: "json", key: "mcpServers" },
    skills: ["$HOME/.claude/skills"],
  },
  codex: {
    mcp: { files: ["$HOME/.codex/config.toml"], format: "toml", key: "mcp_servers" },
    skills: ["$HOME/.codex/skills", SHARED_SKILLS],
  },
  gemini: {
    mcp: { files: ["$HOME/.gemini/settings.json"], format: "json", key: "mcpServers" },
    skills: ["$HOME/.gemini/skills", SHARED_SKILLS],
  },
  cursor: {
    mcp: { files: ["$HOME/.cursor/mcp.json"], format: "json", key: "mcpServers" },
    skills: ["$HOME/.cursor/skills", SHARED_SKILLS],
  },
  vscode: {
    mcp: { files: ["$HOME/Library/Application Support/Code/User/mcp.json", "$HOME/.config/Code/User/mcp.json"], format: "json", key: "servers" },
    skills: ["$HOME/.copilot/skills", SHARED_SKILLS],
  },
  windsurf: {
    mcp: { files: ["$HOME/.codeium/windsurf/mcp_config.json"], format: "json", key: "mcpServers" },
    skills: ["$HOME/.codeium/windsurf/skills", SHARED_SKILLS],
  },
  cline: {
    mcp: { files: ["$HOME/.cline/data/settings/cline_mcp_settings.json", "$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json", "$HOME/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json"], format: "json", key: "mcpServers" },
    skills: ["$HOME/.cline/skills", SHARED_SKILLS],
  },
  "qwen-code": {
    mcp: { files: ["$HOME/.qwen/settings.json"], format: "json", key: "mcpServers" },
    skills: ["$HOME/.qwen/skills", SHARED_SKILLS],
  },
  kiro: {
    mcp: { files: ["$HOME/.kiro/settings/mcp.json"], format: "json", key: "mcpServers" },
    skills: ["$HOME/.kiro/skills", SHARED_SKILLS],
  },
  // Skills only: these keep their servers in YAML (Goose, Hermes, DeepSeek Harness), behind their own command
  // (OpenClaw), or have none of their own (Pi), so no server file is read for them.
  "deepseek-harness": { mcp: NO_SERVERS, skills: ["$HOME/.dsh/skills", SHARED_SKILLS] },
  openclaw: { mcp: NO_SERVERS, skills: ["$HOME/.openclaw/skills"] },
  goose: { mcp: NO_SERVERS, skills: ["$HOME/.config/goose/skills", SHARED_SKILLS] },
  pi: { mcp: NO_SERVERS, skills: ["$HOME/.pi/agent/skills", SHARED_SKILLS] },
  hermes: { mcp: NO_SERVERS, skills: ["$HOME/.hermes/skills"] },
};

// Tool up!'s own store: one copy of each skill it installs, which every agent that has it turned on links to.
export const SKILL_STORE = "$HOME/.toolup/skills";

/** A harness's own skills folder: where a link or a copy goes so that this harness, and only this one, gets the skill. */
export const ownSkillsDir = (agent: CatalogAgent): string | null => agent.skillsDir || READ[agent.id]?.skills[0] || null;

/** How to read one harness, or null for one this version does not know. The catalog's own paths win where it has them. */
export function readPlan(agent: CatalogAgent): HarnessRead | null {
  const base = READ[agent.id];
  if (!base) return null;
  const mcp = agent.config?.length ? { ...base.mcp, files: agent.config, key: agent.serversKey || base.mcp.key } : base.mcp;
  const skills = agent.skillsDir && !base.skills.includes(agent.skillsDir) ? [agent.skillsDir, ...base.skills] : base.skills;
  return { mcp, skills };
}

export const expand = (path: string, home: string) => path.replaceAll("$HOME", home);
