// A first look at a skill before it is installed: fixed rules over its text files, run on this computer.
// It reads, it never runs anything, and the same files always give the same findings. It cannot see what a
// script does when it runs, so it is a filter for the obvious, not a guarantee: a clean result is not "safe".

export type Severity = "high" | "medium" | "low";
export interface Finding {
  rule: string;
  /** What kind of risk: wiping things, sending things out, digging in, hiding what it does, or steering the agent. */
  category: "destructive" | "exfiltration" | "persistence" | "obfuscation" | "instructions";
  severity: Severity;
  /** In plain words, for the person deciding. */
  why: string;
  file: string;
  line: number;
  /** The line it was found on, shortened. */
  text: string;
}

interface Rule { id: string; category: Finding["category"]; severity: Severity; why: string; re: RegExp; /** Keeps its weight in prose and examples too. */ always?: boolean }

const SECRETS = String.raw`(?:~|\$HOME|\$\{HOME\})?/?\.(?:ssh|aws|gnupg|kube|netrc|npmrc|docker/config\.json)|id_(?:rsa|ed25519)|\.env\b|credentials(?:\.json)?\b|keychain`;
const RULES: Rule[] = [
  // wiping or breaking things
  { id: "rm-root", category: "destructive", severity: "high", why: "Deletes a whole home folder or disk.", re: /\brm\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR][a-zA-Z]*f?[a-zA-Z]*\s+(?:--no-preserve-root\s+)?(?:\/(?=[\s*`'");]|$)|~\/?(?=[\s*`'");]|$)|\$HOME\/?(?=[\s*`'");]|$)|\$\{HOME\}\/?(?=[\s*`'");]|$))/ },
  { id: "disk-write", category: "destructive", severity: "high", why: "Writes straight onto a disk or formats one.", re: /\b(?:mkfs(?:\.\w+)?\s|dd\s+[^\n]*\bof=\/dev\/(?:sd|disk|nvme|hd)|>\s*\/dev\/(?:sd|disk|nvme|hd)\w*)/ },
  { id: "fork-bomb", category: "destructive", severity: "high", why: "A fork bomb: it freezes the computer.", re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
  { id: "chmod-wide", category: "destructive", severity: "medium", why: "Opens up permissions on a whole folder tree.", re: /\bchmod\s+(?:-[a-zA-Z]+\s+)*-?R?\s*(?:777|a\+rwx)\s+(?:\/|~|\$HOME)/ },
  { id: "git-force", category: "destructive", severity: "low", why: "Rewrites or discards work in git.", re: /\bgit\s+(?:push\s+[^\n]*(?:--force\b|-f\b)|reset\s+--hard|clean\s+-[a-zA-Z]*f)/ },
  // sending things out
  { id: "pipe-to-shell", category: "exfiltration", severity: "high", why: "Downloads a script and runs it without anyone reading it.", re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|k)?sh\b/, always: true },
  { id: "send-secrets", category: "exfiltration", severity: "high", why: "Sends keys, passwords or private files to another computer.", re: new RegExp(String.raw`\b(?:curl|wget|nc|ncat|scp|rsync)\b[^\n]*(?:${SECRETS})`, "i"), always: true },
  { id: "read-secrets", category: "exfiltration", severity: "medium", why: "Reads keys or passwords kept on this computer.", re: new RegExp(String.raw`\b(?:cat|less|head|tail|cp|base64|open)\s+[^\n]*(?:${SECRETS})|security\s+find-(?:generic|internet)-password`, "i") },
  { id: "env-out", category: "exfiltration", severity: "high", why: "Sends this computer's environment (often full of keys) somewhere.", re: /\b(?:printenv|env|set)\b[^\n]*\|\s*(?:curl|wget|nc|ncat)\b/, always: true },
  { id: "reverse-shell", category: "exfiltration", severity: "high", why: "Opens a remote shell into this computer.", re: /\b(?:nc|ncat)\b[^\n]*\s-e\s|\/dev\/tcp\/[^\s/]+\/\d+|bash\s+-i\s+>&/, always: true },
  { id: "post-file", category: "exfiltration", severity: "medium", why: "Uploads a file from this computer.", re: /\bcurl\b[^\n]*(?:\s-T\s|\s--upload-file\s|\s-F\s+['"]?\w+=@|\s(?:-d|--data(?:-binary)?)\s+@)/ },
  // digging in
  { id: "sudo", category: "persistence", severity: "medium", why: "Asks for administrator rights.", re: /(?:^|[\s;&|(`])sudo\s+\S/ },
  { id: "startup", category: "persistence", severity: "high", why: "Sets something up to run by itself later, or at every login.", re: /\bcrontab\s+(?:-[a-z]\s+)*\S|\blaunchctl\s+(?:load|bootstrap)\b|Library\/LaunchAgents|\/etc\/cron\.|systemctl\s+(?:--user\s+)?enable\b/ },
  { id: "shell-rc", category: "persistence", severity: "high", why: "Changes what your terminal runs every time it opens.", re: />>?\s*(?:~|\$HOME|\$\{HOME\})\/\.(?:zshrc|bashrc|bash_profile|profile|zprofile|config\/fish\/config\.fish)\b/ },
  { id: "ssh-keys", category: "persistence", severity: "high", why: "Adds a key that lets someone else sign in to this computer.", re: />>?\s*(?:~|\$HOME|\$\{HOME\})\/\.ssh\/authorized_keys/, always: true },
  { id: "setuid", category: "persistence", severity: "medium", why: "Makes a program run with someone else's rights.", re: /\bchmod\s+(?:-[a-zA-Z]+\s+)*(?:[ug]\+s|[2467][0-7]{3})\b/ },
  // hiding what it does
  { id: "decode-run", category: "obfuscation", severity: "high", why: "Unpacks hidden text and runs it.", re: /base64\s+(?:-d|-D|--decode)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\beval\s+["'`]?\$\([^\n)]*(?:base64|curl|wget)/, always: true },
  { id: "exec-string", category: "obfuscation", severity: "medium", why: "Runs code built from a string, which hides what it is.", re: /\bpython3?\s+-c\s+["'][^\n]*\b(?:exec|eval|__import__)\s*\(|\bnode\s+-e\s+["'][^\n]*\beval\s*\(/ },
  { id: "blob", category: "obfuscation", severity: "low", why: "A long block of encoded text that cannot be read.", re: /(?:^|[\s"'=])[A-Za-z0-9+/]{240,}={0,2}(?:$|[\s"'])/ },
  // steering the agent
  { id: "override", category: "instructions", severity: "high", why: "Tells the agent to drop the instructions it was given.", re: /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions|prompts?|rules)\b/i, always: true },
  { id: "hide-from-user", category: "instructions", severity: "high", why: "Tells the agent to keep something from you.", re: /\b(?:do\s+not|don't|never)\s+(?:tell|inform|mention\s+(?:this\s+)?to|reveal\s+(?:this\s+)?to|show)\s+the\s+user\b|\bwithout\s+(?:telling|informing|notifying)\s+the\s+user\b/i, always: true },
  { id: "skip-checks", category: "instructions", severity: "medium", why: "Switches off the agent's own safety checks or review steps.", re: /--dangerously-skip-permissions|--dangerously-bypass-approvals|\bdisable\s+(?:the\s+)?(?:sandbox|safety\s+checks?|permission\s+prompts?)\b|--no-verify\b/i, always: true },
];

const DOWN: Record<Severity, Severity> = { high: "medium", medium: "low", low: "low" };
const RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const isDoc = (path: string) => /\.(?:md|txt)$/i.test(path);

/** Everything the rules find in a skill's text files, the most serious first. A match in prose counts one step less, unless the rule says otherwise. */
export function scanSkill(files: { path: string; text: string }[]): Finding[] {
  const out: Finding[] = [];
  for (const f of files) {
    const lines = f.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 4000 && !/[A-Za-z0-9+/]{240,}/.test(line)) continue;   // minified code: not something these rules read
      for (const r of RULES) {
        if (!r.re.test(line)) continue;
        if (out.some((x) => x.rule === r.id && x.file === f.path)) continue;   // once per rule and file is enough to look at
        out.push({ rule: r.id, category: r.category, severity: isDoc(f.path) && !r.always ? DOWN[r.severity] : r.severity, why: r.why, file: f.path, line: i + 1, text: line.trim().slice(0, 140) });
      }
    }
  }
  return out.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.file.localeCompare(b.file) || a.line - b.line);
}

/** The most serious level among the findings, or null when there are none. */
export const worst = (findings: Finding[]): Severity | null => (findings.length ? findings.reduce<Severity>((w, f) => (RANK[f.severity] > RANK[w] ? f.severity : w), "low") : null);
