// Where to get each agent: its maker's own download page. The link says the visit came from Tool up!.
const PAGES: Record<string, string> = {
  "claude-code": "https://claude.com/product/claude-code",
  codex: "https://learn.chatgpt.com/docs/codex/cli",
  gemini: "https://geminicli.com/",
  cursor: "https://cursor.com/download",
  vscode: "https://code.visualstudio.com/download",
  windsurf: "https://windsurf.com/download",
  cline: "https://cline.bot/",
  "qwen-code": "https://github.com/QwenLM/qwen-code",
  "deepseek-harness": "https://github.com/deepseek-ai/deepseek-harness",
  openclaw: "https://openclaw.ai/",
  goose: "https://block.github.io/goose/",
  kiro: "https://kiro.dev/downloads/",
  pi: "https://github.com/badlogic/pi-mono",
  hermes: "https://hermes-agent.nousresearch.com/",
};

/** The download page for an agent, tagged with UTM parameters, or null for one we have no page for. */
export function getAgentUrl(id: string): string | null {
  if (!PAGES[id]) return null;
  const u = new URL(PAGES[id]);
  u.searchParams.set("utm_source", "toolup");
  u.searchParams.set("utm_medium", "app");
  u.searchParams.set("utm_campaign", "get-agent");
  u.searchParams.set("utm_content", id);
  return u.toString();
}
