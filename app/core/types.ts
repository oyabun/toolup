// What the scan returns. Nothing in an Inventory is a secret: values of env vars, headers and
// token-looking arguments never leave the scanner, only their names and the fact that they exist.

/** How the core touches the machine. The desktop shell and the tests each bring their own. */
export interface Host {
  /** The user's home directory, absolute. */
  home: string;
  /** A file's text, or null when it does not exist or cannot be read. */
  readText(path: string): Promise<string | null>;
  /** A directory's entries, or null when it does not exist. */
  list(path: string): Promise<DirEntry[] | null>;
  exists(path: string): Promise<boolean>;
  /** Whether a command is installed (on PATH, or in the usual places a GUI app's PATH misses). */
  onPath(bin: string): Promise<boolean>;
}
export interface DirEntry {
  name: string;
  dir: boolean;
  /** For a symlink, where it really points; otherwise null. */
  link: string | null;
}

/** The parts of the Tool up! catalog (public/catalog.json) the scan needs. */
export interface Catalog {
  agents: CatalogAgent[];
  mcp: { id: string; name: string; url?: string }[];
  skills: { id: string; name: string; repo: string }[];
}
export interface CatalogAgent {
  id: string;
  name: string;
  bin?: string | null;
  paths?: string[];
  config?: string[];
  serversKey?: string;
  skillsDir?: string;
}

export type Kind = "mcp" | "skill";
export type Transport = "http" | "sse" | "stdio" | "unknown";

export interface HarnessReport {
  id: string;
  name: string;
  /** Installed on this machine. */
  present: boolean;
  /** The file its MCP servers were read from, when there is one. */
  mcpFile: string | null;
  /** Things the user should know: a config that would not parse, and the like. */
  problems: string[];
}

export interface Item {
  kind: Kind;
  /** Stable identity across harnesses: the same server under two names is one item. */
  key: string;
  name: string;
  /** Its id in the Tool up! catalog, or null for something the user added themselves. */
  catalogId: string | null;
  description: string | null;
  /** Servers only. */
  transport: Transport | null;
  /** Servers: the URL (no query, no credentials) or the command line, with secrets masked. Skills: null. */
  target: string | null;
  /** It carries private values (env vars, headers, tokens), so copying it elsewhere needs the user's say-so. */
  hasSecrets: boolean;
  /** Where it is installed, by harness id. */
  in: Record<string, Placement>;
  /** Skills: the GitHub repo it came from and the version installed, when that is known. */
  origin: import("./github.ts").Origin | null;
  /** Skills: its folder in Tool up!'s store, when it is kept there (it may be turned on for no agent at all). */
  store: string | null;
}
export interface Placement {
  /** The name it goes by in that harness. */
  name: string;
  /** The config file or skill folder it was found in. */
  source: string;
  /** Skills: the folder is a link to a shared copy rather than its own. */
  linked: boolean;
  /** Skills: for a link, the folder it really points to. */
  linkTo: string | null;
}

export interface Inventory {
  harnesses: HarnessReport[];
  items: Item[];
  /** Plugins Claude Code has installed (the only agent with plugins this version reads). */
  plugins: import("./plugins.ts").InstalledPlugin[];
}
