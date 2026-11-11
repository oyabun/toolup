// Asking GitHub for a skill's latest version, and reading the note left beside an installed skill.
import assert from "node:assert/strict";
import { test } from "node:test";
import { latestCommitUrl, parseLatestCommit, parseOrigin, repoUrl } from "../core/github.ts";

test("the addresses for a skill's folder", () => {
  assert.equal(latestCommitUrl("acme/skills", "skills/my skill"), "https://api.github.com/repos/acme/skills/commits?per_page=1&path=skills%2Fmy%20skill");
  assert.equal(latestCommitUrl("acme/one", ""), "https://api.github.com/repos/acme/one/commits?per_page=1");
  assert.equal(repoUrl("acme/skills"), "https://github.com/acme/skills");
  assert.equal(repoUrl("acme/skills", "skills/tdd"), "https://github.com/acme/skills/tree/HEAD/skills/tdd");
});

test("the latest commit, or GitHub's reason when there is none", () => {
  assert.deepEqual(parseLatestCommit([{ sha: "abc", commit: { committer: { date: "2026-10-01T10:00:00Z" } } }]), { sha: "abc", date: "2026-10-01T10:00:00Z" });
  assert.throws(() => parseLatestCommit({ message: "API rate limit exceeded" }), /rate limit/);
  assert.throws(() => parseLatestCommit([]));
});

test("the note beside a skill is trusted only when it names a real repo", () => {
  assert.deepEqual(parseOrigin('{"repo":"a/b","path":"x","sha":"s"}'), { repo: "a/b", path: "x", sha: "s" });
  assert.deepEqual(parseOrigin('{"repo":"a/b"}'), { repo: "a/b", path: null, sha: "" });
  assert.equal(parseOrigin('{"repo":"../etc"}'), null);
  assert.equal(parseOrigin("nope"), null);
  assert.equal(parseOrigin(null), null);
});
