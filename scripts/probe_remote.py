#!/usr/bin/env python3
"""Asks each candidate's URL to introduce itself (an MCP `initialize`) and records how it wants you to sign in.

  200 + an MCP answer         -> "none"   works without signing in
  401 naming OAuth metadata   -> "oauth"  sign in with the browser on first use (nothing secret in our command)
  401 / 403 otherwise         -> "key"    wants an API key or token header: not for a keyless catalog
  anything else               -> "down"   no answer / not MCP

Writes `auth` and `probed` into catalog/remote-candidates.json. One request each, with a pause.
"""
import json, sys, time, urllib.error, urllib.request
from pathlib import Path

F = Path(__file__).resolve().parent.parent / "catalog" / "remote-candidates.json"
BODY = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "toolup-probe", "version": "0"}}}).encode()

def probe(url):
    req = urllib.request.Request(url, data=BODY, method="POST", headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "User-Agent": "toolup-catalog-script (personal project)"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            txt = r.read(4000).decode("utf8", "replace")
            return ("none", r.status) if "jsonrpc" in txt or "protocolVersion" in txt else ("down", r.status)
    except urllib.error.HTTPError as e:
        wa = (e.headers.get("WWW-Authenticate") or "").lower()
        if e.code in (401, 403):
            return ("oauth" if "resource_metadata" in wa or "bearer" in wa or "oauth" in wa else "key", e.code)
        return ("down", e.code)
    except Exception as e:
        return ("down", type(e).__name__)

d = json.loads(F.read_text())
for x in d:
    if not x.get("url"): x["auth"], x["probed"] = "down", "no url"; continue
    x["auth"], x["probed"] = probe(x["url"])
    print(f'{x["auth"]:6} {x["probed"]}  {x["slug"]}  {x["url"]}', flush=True)
    time.sleep(1)
F.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
