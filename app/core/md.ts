// The Markdown a skill is written in, as safe HTML. Everything is escaped first, so nothing in the text can become markup
// of its own; the only tags that come out are the ones made here.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** One run of text: `code`, **bold**, *italic*, [links](https://…). A link that is not http(s) keeps only its text. */
function inline(text: string, links: boolean): string {
  const code: string[] = [];
  // code first, set aside, so its stars and brackets are left alone
  const s = esc(text).replace(/`([^`\n]+)`/g, (_, c: string) => `\u0000${code.push(c) - 1}\u0000`)
    .replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (all: string, t: string, u: string) => (/^https?:\/\//.test(u) ? (links ? `<button class="link" type="button" data-url="${u}">${t}</button>` : t) : /^[a-z][a-z0-9+.-]*:/i.test(u) ? all : t))
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/gm, "$1<i>$2</i>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, n: string) => `<code>${code[+n]}</code>`);
}

/** A description: one short piece of text. List lines and line breaks are kept; `links` makes a link a button that opens it. */
export function mdLine(text: string, links = false): string {
  return text.trim().split(/\r?\n/)
    .map((l) => { const h = /^\s*#{1,6}\s+(.*)$/.exec(l); return h ? `<b>${inline(h[1], links)}</b>` : inline(l.replace(/^\s*[-*]\s+/, "• "), links); })
    .join("<br>").replace(/(<br>){3,}/g, "<br><br>");
}

/** A whole document (a SKILL.md): headings, paragraphs, lists, numbered lists, quotes, tables, rules and code blocks. */
export function mdDoc(text: string, links = true): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/^---\n[\s\S]*?\n---\n?/, "").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) out.push(`<p>${inline(para.join(" "), links)}</p>`); para = []; };
  const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {   // a code block: as written, until the same fence closes it
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence[1]); i++) body.push(lines[i]);
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const head = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (head) { flush(); out.push(`<h${Math.min(6, head[1].length + 2)}>${inline(head[2], links)}</h${Math.min(6, head[1].length + 2)}>`); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push("<hr>"); continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const body: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ""));
      i--;
      out.push(`<blockquote>${inline(body.join(" "), links)}</blockquote>`);
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] || "")) {   // a table: a row of names, a row of dashes, then the rows
      flush();
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim(), links));
      const top = cells(line), rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) rows.push(cells(lines[i]));
      i--;
      out.push(`<div class="md-table"><table><thead><tr>${top.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (item.test(line)) {   // a list: items one under the other; a deeper indent is a list inside the item above
      flush();
      const open: { indent: number; tag: string }[] = [];
      let html = "";
      for (; i < lines.length; i++) {
        const m = item.exec(lines[i]);
        if (!m) {
          if (lines[i].trim() && /^\s+/.test(lines[i]) && open.length) { html += ` ${inline(lines[i].trim(), links)}`; continue; }   // an item's text carried over a line
          if (!lines[i].trim() && item.test(lines[i + 1] || "")) continue;   // a blank line between two items
          break;
        }
        const indent = m[1].length, tag = /\d/.test(m[2]) ? "ol" : "ul";
        while (open.length && indent < open[open.length - 1].indent) html += `</li></${open.pop()!.tag}>`;
        const cur = open[open.length - 1];
        if (!cur || indent > cur.indent) { html += `<${tag}>`; open.push({ indent, tag }); }
        else if (cur.tag !== tag) { html += `</li></${cur.tag}><${tag}>`; cur.tag = tag; }
        else html += "</li>";
        html += `<li>${inline(m[3], links)}`;
      }
      i--;
      while (open.length) html += `</li></${open.pop()!.tag}>`;
      out.push(html);
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out.join("");
}
