// The one question asked of GitHub: what is the latest commit that touched a skill's folder?
// Comparing it with the one recorded at install time says whether there is a newer version.

/** Where a skill came from, as recorded beside it when Tool up! installed it. */
export interface Origin {
  repo: string;
  /** The skill's folder inside the repo ("" when the repo is the skill); null when it was not recorded. */
  path: string | null;
  /** The latest commit of that folder when it was installed; "" when it could not be asked. */
  sha: string;
}

const part = /^[A-Za-z0-9_.-]+$/;
export const isRepo = (r: string) => { const p = r.split("/"); return p.length === 2 && p.every((x) => part.test(x) && x !== "." && x !== ".."); };

export const repoUrl = (repo: string, path = "") => `https://github.com/${repo}${path ? `/tree/HEAD/${path.split("/").map(encodeURIComponent).join("/")}` : ""}`;
export const latestCommitUrl = (repo: string, path: string) => `https://api.github.com/repos/${repo}/commits?per_page=1${path ? `&path=${encodeURIComponent(path)}` : ""}`;

/** The commit id and date out of GitHub's answer; throws when the answer is not a list of commits. */
export function parseLatestCommit(json: unknown): { sha: string; date: string } {
  const first = Array.isArray(json) ? json[0] : null;
  const sha = first && typeof first.sha === "string" ? first.sha : "";
  if (!sha) throw new Error(json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : "GitHub did not say which version is the latest.");
  return { sha, date: String(first.commit?.committer?.date || first.commit?.author?.date || "") };
}

/** Read the note Tool up! leaves beside a skill. Anything unexpected means "not recorded". */
export function parseOrigin(text: string | null): Origin | null {
  if (!text) return null;
  try {
    const d = JSON.parse(text);
    return typeof d?.repo === "string" && isRepo(d.repo) ? { repo: d.repo, path: typeof d.path === "string" ? d.path : null, sha: typeof d.sha === "string" ? d.sha : "" } : null;
  } catch { return null; }
}
