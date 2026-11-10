#!/bin/bash
# Runs the real installer twice in a clean container with the real claude, codex and gemini CLIs.
# Passes when run 1 installs everything and run 2 changes nothing. Used by .github/workflows/e2e.yml.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
SH=public/install.sh
IDS="github context7 linear sentry grill-me tdd"
fails=0
check() { if eval "$2"; then echo "  PASS $1"; else echo "  FAIL $1"; fails=$((fails + 1)); fi; }

state() { # everything the install is supposed to change, as one hash
  {
    for f in "$HOME/.codex/config.toml" "$HOME/.gemini/settings.json" "$HOME/.cursor/mcp.json"; do [ -f "$f" ] && sha256sum "$f"; done
    # Claude creates ~/.claude.json itself on first launch, so compare only the servers in it
    python3 -c 'import json,os; p=os.path.expanduser("~/.claude.json"); d=json.load(open(p)) if os.path.exists(p) else {}; print("claude:", json.dumps(d.get("mcpServers",{}),sort_keys=True))'
    (cd "$HOME/.agents/skills" 2>/dev/null && find . | sort)
    (cd "$HOME/.claude/skills" 2>/dev/null && find . | sort)
  } | sha256sum
}

echo "== agents"
for c in claude codex gemini; do echo "  $c $($c --version 2>&1 | head -1)"; done

echo "== dry run"
before=$(state)
bash $SH --dry-run $IDS > /tmp/dry.out 2>&1; check "dry run exits 0" "[ $? -eq 0 ]"
check "the dry run changed nothing" "[ \"$before\" = \"$(state)\" ]"

echo "== run 1"
bash $SH $IDS 2>&1 | tee /tmp/run1.out; check "run 1 exits 0" "[ ${PIPESTATUS[0]} -eq 0 ]"
check "run 1 reports no warnings or failures" "! grep -qE '^  !|failed' /tmp/run1.out"
cli='^(claude|codex|gemini|npx|curl) '
check "dry run printed what run 1 did" "diff <(grep -E '→' /tmp/dry.out | sed 's/^ *→ //' | grep -E '$cli') <(grep -E '✓' /tmp/run1.out | sed 's/^ *✓ //' | grep -E '$cli') >/dev/null"

echo "== what is installed"
for s in github context7 linear sentry; do
  check "claude has $s" "claude mcp get $s >/dev/null 2>&1"
  check "codex has $s" "codex mcp get $s >/dev/null 2>&1"
  check "gemini has $s" "python3 -c 'import json,os,sys; sys.exit(0 if \"$s\" in json.load(open(os.path.expanduser(\"~/.gemini/settings.json\")))[\"mcpServers\"] else 1)'"
  check "cursor has $s" "python3 -c 'import json,os,sys; sys.exit(0 if \"$s\" in json.load(open(os.path.expanduser(\"~/.cursor/mcp.json\")))[\"mcpServers\"] else 1)'"
done
for s in grill-me tdd; do
  check "skill $s is in ~/.agents/skills (Codex, Gemini, Cursor, Copilot read it)" "[ -f \$HOME/.agents/skills/$s/SKILL.md ]"
  check "skill $s is linked into Claude Code" "[ -e \$HOME/.claude/skills/$s/SKILL.md ]"
done

after1=$(state)
echo "== run 2 (must change nothing)"
bash $SH $IDS 2>&1 | tee /tmp/run2.out; check "run 2 exits 0" "[ ${PIPESTATUS[0]} -eq 0 ]"
check "run 2 did nothing: no step reported done" "! grep -E '✓ (claude|codex|gemini|npx|curl|add )' /tmp/run2.out"
check "run 2 left every config and skill as it was" "[ \"$after1\" = \"$(state)\" ]"
check "run 2 skipped what exists" "grep -q 'already set' /tmp/run2.out"

echo
[ "$fails" -eq 0 ] && echo "e2e: all checks passed" || { echo "e2e: $fails check(s) failed"; exit 1; }
