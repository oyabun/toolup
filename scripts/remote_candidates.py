#!/usr/bin/env python3
"""Reads mcpservers.org's remote-servers directory and writes catalog/remote-candidates.json, a list to edit by hand.

Polite by design: one honest User-Agent, a pause between requests, only the pages robots.txt allows, and detail pages
only for the recognisable brands (the "Destacados" strip plus entries that carry a brand logo), not all ~5,500 servers.
Re-running keeps what you edited (cats, include, note) and only refreshes the fetched fields.

    python3 scripts/remote_candidates.py            # fetch and merge
    python3 scripts/remote_candidates.py --add slug1,slug2   # also read these entries (slugs as in the site's URLs)
    python3 scripts/remote_candidates.py page.html  # parse a page you saved from your browser instead of fetching it
"""
import html, json, re, sys, time, urllib.error, urllib.request
from pathlib import Path

BASE = "https://mcpservers.org"
UA = "toolup-catalog-script (personal project; reads the public remote-servers list)"
OUT = Path(__file__).resolve().parent.parent / "catalog" / "remote-candidates.json"

def get(path):
    """One request; on 429 / 5xx it waits (Retry-After if given, else growing) and tries again, then gives up."""
    for wait in (0, 30, 90, 240):
        time.sleep(wait)
        try:
            req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf8")
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504): raise
            wait_hdr = e.headers.get("Retry-After")
            print(f"  {e.code} on {path}; backing off" + (f" (server asks {wait_hdr}s)" if wait_hdr else ""), flush=True)
            if wait_hdr and wait_hdr.isdigit(): time.sleep(min(int(wait_hdr), 300))
    raise SystemExit("The site keeps saying no; stopping. Re-run later: what was fetched is saved and is not fetched again.")

def listing(page):
    pat = re.compile(r'<a rel="noopener noreferrer" href="/es/servers/([^"]+)"[^>]*>(?:<img src="([^"]*)" alt="[^"]*"[^>]*/>)?<div class="min-w-0 flex-1"><div class="[^"]*">(.*?)</div><div class="[^"]*">(.*?)</div></div>')
    seen, out = set(), []
    for m in pat.finditer(page):
        if m.group(1) in seen: continue
        seen.add(m.group(1))
        out.append({"slug": m.group(1), "name": html.unescape(m.group(3)), "logo": m.group(2) or ""})
    i, j = page.find("Destacados"), page.find("Más servidores MCP remotos")
    featured = set(re.findall(r'href="/es/servers/([^"]+)"', page[i:j])) if 0 <= i < j else set()
    return out, featured

def detail(slug):
    s = get(f"/servers/{slug}")                       # the English page
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t)); t = re.sub(r"\n\s*\n+", "\n", t)
    url = re.search(r"add-mcp '(https?://[^']+)'", t)
    ds = re.search(r"\n(?:official|oficial)\n(.+)\n", t) or re.search(r"\n([^\n]{60,})\n(?:View on|Hosted MCP)", t)
    return {"url": url.group(1) if url else "", "official": bool(re.search(r"\n(official|oficial)\n", t)),
            "ds": ds.group(1).strip() if ds else ""}

def main():
    args = sys.argv[1:]
    extra = set(args.pop(args.index("--add") + 1).split(",")) if "--add" in args else set()
    if "--add" in args: args.remove("--add")
    online = not args
    page = Path(args[0]).read_text(encoding="utf8") if args else get("/es/remote-mcp-servers")
    items, featured = listing(page)
    picks = [x for x in items if x["slug"] in featured or "svgl.app" in x["logo"] or x["slug"] in extra]
    old = {x["slug"]: x for x in json.loads(OUT.read_text())} if OUT.exists() else {}
    print(f"{len(items)} servers listed, {len(picks)} recognisable brands to read")
    out = []
    for x in picks:
        keep = old.get(x["slug"], {})
        fetch = online and not keep.get("url")      # already have it: don't ask again
        d = detail(x["slug"]) if fetch else {}
        if fetch: time.sleep(3)
        out.append({"slug": x["slug"], "name": x["name"], "ds": d.get("ds") or keep.get("ds", ""), "url": d.get("url") or keep.get("url", ""),
                    "official": d.get("official", keep.get("official", False)), "featured": x["slug"] in featured,
                    "cats": keep.get("cats", []), "include": keep.get("include", False), "note": keep.get("note", "")})
        print(" ", x["slug"], out[-1]["url"] or "(no url)", flush=True)
        OUT.write_text(json.dumps(out + [old[k] for k in old if k not in {o["slug"] for o in out}], indent=2, ensure_ascii=False) + "\n")
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")

main()
