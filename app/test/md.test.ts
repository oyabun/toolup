import { test } from "node:test";
import assert from "node:assert/strict";
import { mdLine } from "../core/md.ts";

test("a description's Markdown becomes bold, italic, code and line breaks", () => {
  assert.equal(mdLine("Use **this** for *that*, with `npm run x`."), "Use <b>this</b> for <i>that</i>, with <code>npm run x</code>.");
  assert.equal(mdLine("One\n- a\n- b"), "One<br>• a<br>• b");
  assert.equal(mdLine("## When\nAlways"), "<b>When</b><br>Always");
});

test("what is inside code is left alone, and plain stars and underscores are not styled", () => {
  assert.equal(mdLine("Run `a **b** *c*` now"), "Run <code>a **b** *c*</code> now");
  assert.equal(mdLine("2 * 3 * 4 and my_skill_name"), "2 * 3 * 4 and my_skill_name");
});

test("the text can never become markup of its own", () => {
  assert.equal(mdLine("<img src=x onerror=1> **b**"), "&lt;img src=x onerror=1&gt; <b>b</b>");
  assert.equal(mdLine("`<script>`"), "<code>&lt;script&gt;</code>");
});

test("links: a button that opens the address where asked for, only the text otherwise, and never a javascript: one", () => {
  assert.equal(mdLine("See [the docs](https://example.com/a?b=1&c=2)", true), 'See <button class="link" type="button" data-url="https://example.com/a?b=1&amp;c=2">the docs</button>');
  assert.equal(mdLine("See [the docs](https://example.com)"), "See the docs");
  assert.equal(mdLine("[x](javascript:alert(1))", true), "[x](javascript:alert(1))");
});

import { mdDoc } from "../core/md.ts";

test("a document: its front matter is dropped; headings, paragraphs, lists and code blocks come out as such", () => {
  const html = mdDoc("---\nname: x\n---\nIntro line\nsecond line.\n\nCore principles:\n- Finish the job.\n- Scale **ambition**.\n\n## Setup\n\n1. Run `x <dir>` once\n   and keep going.\n2. Load [the brief](reference/new-work.md).\n\n```sh\nnpm run <b>\n```\n");
  assert.equal(html, "<p>Intro line second line.</p><p>Core principles:</p><ul><li>Finish the job.</li><li>Scale <b>ambition</b>.</li></ul><h4>Setup</h4>"
    + "<ol><li>Run <code>x &lt;dir&gt;</code> once and keep going.</li><li>Load the brief.</li></ol><pre><code>npm run &lt;b&gt;</code></pre>");
});

test("a document: a list inside a list, a quote, a rule and a table", () => {
  assert.equal(mdDoc("- a\n  - b\n  - c\n- d"), "<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>");
  assert.equal(mdDoc("> take care\n> here\n\n---\n"), "<blockquote>take care here</blockquote><hr>");
  assert.equal(mdDoc("| A | B |\n|---|---|\n| 1 | `2` |"), '<div class="md-table"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td><code>2</code></td></tr></tbody></table></div>');
});

test("a document can never bring its own markup or a script link", () => {
  assert.equal(mdDoc("<script>alert(1)</script>\n\n[x](javascript:alert(1))"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>[x](javascript:alert(1))</p>");
});
