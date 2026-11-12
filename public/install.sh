#!/bin/bash
# Tool up! — kit your AI agents: install MCP servers and skills into every agent on this machine.
#
#   curl -fsSL toolup.sh | bash -s -- github playwright grill-me tdd frontend-design
#
# Options: --to claude-code,cursor  only tool up these agents (default: every supported agent found)
#          --docker                 route eligible MCP servers through the Docker MCP Gateway
#          --dry-run                print every action without changing anything
#          --update                 re-install the chosen skills at their latest version
#          --list                   print the catalog ids
# Every step checks state first, so re-running only adds what is missing.
# Never takes or stores a token: remote servers sign you in (OAuth) the first time an agent uses them.
# Written for the bash 3.2 that ships with macOS. Everything runs inside main() so a partially
# downloaded script never executes.

set -uo pipefail

CATALOG_URL="${CATALOG_URL:-https://toolup.sh/catalog.tsv}"

# @@EMBED_START@@ (downloaded scripts carry their own catalog and selection here)
EMBEDDED=0
DEFAULT_IDS=""
DEFAULT_TO=""
DEFAULT_DOCKER=0
embedded_catalog() { :; }
# @@EMBED_END@@

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RESET=$'\033[0m'
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" RESET=""
fi
TAB=$'\t'
NL=$'\n'

say()  { printf '%s\n' "$*"; }
step() { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
skip() { printf '  %s•%s %s %s(already set)%s\n' "$DIM" "$RESET" "$*" "$DIM" "$RESET"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; WARNINGS=$((WARNINGS + 1)); }
plan() { printf '  %s→ %s%s\n' "$DIM" "$*" "$RESET"; }
die()  { printf '%sError:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

WARNINGS=0
FAILED=0
DRY_RUN=0
DOCKER=0
UPDATE=0
LIST=0
REMOVE=0
TO=""
IDS=""
CATALOG=""
AGENTS=""
PLANNED=" "        # runtimes a dry run pretends to have installed, so later steps read the same as a real run

usage() {
  say "Usage: toolup.sh [--to AGENT,...] [--docker] [--dry-run] [--update] [--list] ID..."
  say "       toolup.sh --remove --to AGENT,... SERVER...   take MCP servers out of those agents, by name"
  say "  ids are MCP servers and skills from the catalog; pick them at https://toolup.sh"
}

# ---------------------------------------------------------------- catalog

load_catalog() {
  if [ "$EMBEDDED" = 1 ]; then
    embedded_catalog
  else
    curl -fsSL --retry 3 "$CATALOG_URL" || die "could not download the catalog from $CATALOG_URL"
  fi
}

# Print the catalog row "kind<TAB>id<TAB>..." for an id (agents, servers and skills).
row() { awk -F'\t' -v k="$1" -v id="$2" '$1 == k && $2 == id { print; exit }' <<<"$CATALOG"; }
rows() { awk -F'\t' -v k="$1" '$1 == k { print $2 }' <<<"$CATALOG"; }
# Print field N of a row, counting the first one after the id as 1; the "-" placeholder reads as empty.
field() { awk -F'\t' -v n="$(($2 + 2))" '{ print ($n == "-" ? "" : $n) }' <<<"$1"; }
kind_of() { awk -F'\t' -v id="$1" '$1 != "agent" && $2 == id { print $1; exit }' <<<"$CATALOG"; }

# Replace a literal $HOME in catalog text with the real one, at run time.
expand() { local s="$1"; printf '%s' "${s//\$HOME/$HOME}"; }

# ---------------------------------------------------------------- running things

# Run a command, or print it in a dry run. Never lets a child read the script from stdin.
run() {
  if [ "$DRY_RUN" = 1 ]; then plan "$(quote "$@")"; return 0; fi
  if "$@" </dev/null >/dev/null 2>&1; then ok "$(quote "$@")"; else warn "failed: $(quote "$@")"; FAILED=$((FAILED + 1)); return 1; fi
}
run_sh() {
  if [ "$DRY_RUN" = 1 ]; then plan "$1"; return 0; fi
  if bash -c "$1" </dev/null >/dev/null 2>&1; then ok "$1"; else warn "failed: $1"; FAILED=$((FAILED + 1)); return 1; fi
}
# Show a command the way you would type it: plain words as they are, anything else in single quotes.
quote() {
  local out="" a
  for a in "$@"; do
    if [[ "$a" =~ ^[A-Za-z0-9_@%+=:,./-]+$ ]]; then out="$out $a"
    elif [[ "$a" != *"'"* ]]; then out="$out '$a'"
    else out="$out $(printf '%q' "$a")"; fi
  done
  printf '%s' "${out# }"
}

# ---------------------------------------------------------------- agents

# Agent table columns after "agent<TAB>id": name bin paths method skills skillsDir config serversKey urlKey httpExtra
# method "skills": the agent takes skills but its MCP servers are not wired from here (its config is not JSON, or it has none).
a_name()    { field "$1" 1; }
a_bin()     { field "$1" 2; }
a_paths()   { field "$1" 3; }
a_method()  { field "$1" 4; }
a_skills()  { field "$1" 5; }
a_sdir()    { field "$1" 6; }
a_config()  { field "$1" 7; }
a_skey()    { field "$1" 8; }
a_ukey()    { local u; u="$(field "$1" 9)"; printf '%s' "${u:-url}"; }
a_extra()   { field "$1" 10; }   # extra JSON members a remote server's entry needs for this agent

# Does this path show the agent is really here? An app does, and so does a folder with something of the agent's
# own in it. A folder that holds only "skills" does not: skill installers make those for agents never installed.
real_place() {
  [ -e "$1" ] || return 1
  [ -d "$1" ] || return 0
  case "$1" in *.app) return 0 ;; esac
  [ -n "$(ls -A "$1" 2>/dev/null | grep -v -x -e skills -e .DS_Store | head -1)" ]
}

agent_present() { # agent row
  local bin p
  bin="$(a_bin "$1")"
  if [ -n "$bin" ] && have "$bin"; then return 0; fi
  while IFS= read -r p; do
    [ -n "$p" ] && real_place "$(expand "$p")" && return 0
  done <<<"$(a_paths "$1" | tr '|' '\n')"
  return 1
}

detect_agents() { # sets AGENTS (ids of the agents to tool up that are present)
  local id r
  AGENTS=""
  step "Agents on this machine"
  for id in $(rows agent); do
    r="$(row agent "$id")"
    if [ -n "$TO" ] && [[ ",$TO," != *",$id,"* ]]; then continue; fi
    if agent_present "$r"; then ok "$(a_name "$r")"; AGENTS="$AGENTS $id"; else say "  ${DIM}– $(a_name "$r") not found${RESET}"; fi
  done
  AGENTS="${AGENTS# }"
  [ -n "$AGENTS" ] || warn "No supported agents found. Install one first (for the apps themselves see https://getem.sh), then run this again."
}

# ---------------------------------------------------------------- runtimes

node_ok() { # Node 22.20 or newer, for the skills CLI
  local v major minor
  v="$(node -v 2>/dev/null || true)"; v="${v#v}"
  major="${v%%.*}"; minor="${v#*.}"; minor="${minor%%.*}"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || return 1
  [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 20 ]; }
}

runtime_have() {
  case "$1" in
    node) have node ;;
    uv) have uvx ;;
    docker) have docker ;;
  esac || [[ "$PLANNED" == *" $1 "* ]]
}

ensure_runtime() {
  case "$1" in
    uv)
      if have uvx; then skip "uv"; else
        run_sh "curl -LsSf https://astral.sh/uv/install.sh | sh" && PLANNED="$PLANNED""uv "
      fi
      export PATH="$HOME/.local/bin:$PATH" ;;
    node)
      if have node; then skip "Node.js $(node -v 2>/dev/null)"
      elif have brew; then run brew install node && PLANNED="$PLANNED""node "
      else warn "Node.js is missing and Homebrew was not found. Install Node.js 22.20+ from https://nodejs.org"; fi ;;
    docker)
      if have docker; then skip "Docker"; else warn "Docker is missing. Install Docker Desktop (https://getem.sh has it) and enable the MCP Toolkit."; fi ;;
  esac
}

# ---------------------------------------------------------------- MCP wiring

# Server rows: mcp<TAB>id name transport target docker needs (a server is registered under its id)
s_trans()  { field "$1" 2; }
s_target() { field "$1" 3; }
s_docker() { field "$1" 4; }
s_needs()  { field "$1" 5; }

json_str() { local s="$1"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; printf '"%s"' "$s"; }

# JSON for one server entry. $1 transport, $2 target (already expanded), $3 URL key, $4 optional leading pairs.
server_json() {
  local t="$1" target="$2" ukey="$3" extra="${4:-}" out tok first=1 parts
  if [ "$t" = http ]; then
    out="{"; [ -n "$extra" ] && out="$out$extra,"
    printf '%s"%s":%s}' "$out" "$ukey" "$(json_str "$target")"
  else
    read -r -a parts <<<"$target"
    out="{"; [ -n "$extra" ] && out="$out$extra,"
    out="$out\"command\":$(json_str "${parts[0]}"),\"args\":["
    for tok in "${parts[@]:1}"; do [ "$first" = 1 ] || out="$out,"; out="$out$(json_str "$tok")"; first=0; done
    printf '%s]}' "$out"
  fi
}

# Does config file $1 hold server $2 under key $3?
json_has() {
  have python3 || return 1
  python3 - "$1" "$2" "$3" <<'PY' 2>/dev/null
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
sys.exit(0 if sys.argv[2] in (d.get(sys.argv[3]) or {}) else 1)
PY
}

first_config() { # agent row -> first existing config file, else the first one listed
  local f first=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    f="$(expand "$f")"; [ -n "$first" ] || first="$f"
    if [ -e "$f" ]; then printf '%s' "$f"; return; fi
  done <<<"$(a_config "$1" | tr '|' '\n')"
  printf '%s' "$first"
}

# Gemini's own `mcp list` prints nothing in an untrusted folder, so its settings file is the source of truth.
mcp_present() { # agent id, agent row, server name
  case "$(a_method "$2")" in
    claude) claude mcp get "$3" >/dev/null 2>&1 ;;
    codex) codex mcp get "$3" >/dev/null 2>&1 ;;
    json|vscode|gemini) json_has "$(first_config "$2")" "$3" "$(a_skey "$2")" ;;
    *) return 1 ;;
  esac
}

# Add one server to one agent. $1 agent row, $2 name, $3 transport, $4 target.
mcp_add() {
  local r="$1" name="$2" t="$3" target lead
  target="$(expand "$4")"
  local -a cmd
  read -r -a cmd <<<"$target"
  case "$(a_method "$r")" in
    claude)
      if [ "$t" = http ]; then run claude mcp add --scope user --transport http "$name" "$target"
      else run claude mcp add --scope user "$name" -- "${cmd[@]}"; fi ;;
    codex)
      if [ "$t" = http ]; then codex_add_http "$name" "$target"
      else run codex mcp add "$name" -- "${cmd[@]}"; fi ;;
    gemini)
      if [ "$t" = http ]; then run gemini mcp add -s user -t http "$name" "$target"
      else run gemini mcp add -s user "$name" "${cmd[@]}"; fi ;;
    vscode)
      lead="\"name\":$(json_str "$name")"
      [ "$t" = http ] && lead="$lead,\"type\":\"http\""
      run code --add-mcp "$(server_json "$t" "$target" url "$lead")" ;;
    json)
      lead=""; [ "$t" = http ] && lead="$(a_extra "$r")"
      json_merge "$(first_config "$r")" "$(a_skey "$r")" "$name" "$(server_json "$t" "$target" "$(a_ukey "$r")" "$lead")" ;;
  esac
}

# `codex mcp add --url` saves the server and then waits for a browser sign-in, which would hang a
# one-line install. Let it save, then stop it: Codex asks you to sign in on first use instead.
codex_add_http() {
  local name="$1" url="$2" pid i=0
  if [ "$DRY_RUN" = 1 ]; then plan "codex mcp add $name --url $url"; return 0; fi
  codex mcp add "$name" --url "$url" </dev/null >/dev/null 2>&1 &
  pid=$!
  while [ "$i" -lt 60 ]; do
    codex mcp get "$name" >/dev/null 2>&1 && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25; i=$((i + 1))
  done
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  if codex mcp get "$name" >/dev/null 2>&1; then ok "codex mcp add $name --url $url"
  else warn "failed: codex mcp add $name --url $url"; FAILED=$((FAILED + 1)); fi
}

# Merge one server into a JSON config without touching existing keys.
json_merge() { # file serversKey name json
  if [ "$DRY_RUN" = 1 ]; then plan "add $3 to $1 ($2)"; return 0; fi
  have python3 || { warn "python3 is needed to edit $1"; FAILED=$((FAILED + 1)); return 1; }
  mkdir -p "$(dirname "$1")"
  if python3 - "$1" "$2" "$3" "$4" <<'PY'
import json, sys
path, skey, name, entry = sys.argv[1:5]
try:
    with open(path) as f:
        data = json.load(f)
except FileNotFoundError:
    data = {}
if not isinstance(data, dict):
    sys.exit(2)
servers = data.setdefault(skey, {})
if name not in servers:
    servers[name] = json.loads(entry)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
PY
  then ok "$3 → $1"; else warn "could not edit $1 (is it valid JSON?)"; FAILED=$((FAILED + 1)); fi
}

# Take one server out of one agent, by the name that agent knows it by. $1 agent row, $2 name.
mcp_remove() {
  local r="$1" name="$2"
  case "$(a_method "$r")" in
    claude) run claude mcp remove --scope user "$name" ;;
    codex) run codex mcp remove "$name" ;;
    gemini) run gemini mcp remove -s user "$name" ;;
    vscode|json) json_drop "$(first_config "$r")" "$(a_skey "$r")" "$name" ;;
  esac
}

# Delete one server from a JSON config, leaving everything else as it is.
json_drop() { # file serversKey name
  if [ "$DRY_RUN" = 1 ]; then plan "remove $3 from $1 ($2)"; return 0; fi
  have python3 || { warn "python3 is needed to edit $1"; FAILED=$((FAILED + 1)); return 1; }
  if python3 - "$1" "$2" "$3" <<'PY'
import json, sys
path, skey, name = sys.argv[1:4]
with open(path) as f:
    data = json.load(f)
servers = data.get(skey) if isinstance(data, dict) else None
if isinstance(servers, dict) and name in servers:
    del servers[name]
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
PY
  then ok "$3 removed from $1"; else warn "could not edit $1 (is it valid JSON?)"; FAILED=$((FAILED + 1)); fi
}

# --remove: take the named servers out of the agents given with --to. Only what is there is touched.
remove_servers() { # server names in $1
  local a r name
  for a in $AGENTS; do
    r="$(row agent "$a")"
    step "Remove from $(a_name "$r")"
    if [ "$(a_method "$r")" = skills ]; then say "  ${DIM}– MCP servers are not managed from here for $(a_name "$r")${RESET}"; continue; fi
    for name in $1; do
      if mcp_present "$a" "$r" "$name"; then mcp_remove "$r" "$name"; else say "  ${DIM}• $name is not in $(a_name "$r")${RESET}"; fi
    done
  done
}

wire_agent() { # agent id, servers as "name<TAB>transport<TAB>target" lines in $2
  local id="$1" servers="$2" r name t target
  r="$(row agent "$id")"
  if [ "$(a_method "$r")" = skills ]; then say "  ${DIM}– $(a_name "$r"): MCP servers are not added from here yet (skills only)${RESET}"; return; fi
  step "MCP servers → $(a_name "$r")"
  while IFS="$TAB" read -r name t target; do
    [ -n "$name" ] || continue
    if mcp_present "$id" "$r" "$name"; then skip "$name → $(a_name "$r")"; else mcp_add "$r" "$name" "$t" "$target"; fi
  done <<<"$servers"
}

# ---------------------------------------------------------------- skills

skill_present() { # skill id, agent ids
  local sid="$1" a r d
  [ -e "$HOME/.agents/skills/$sid" ] || return 1
  for a in $2; do
    r="$(row agent "$a")"; d="$(a_sdir "$r")"
    [ -z "$d" ] || [ -e "$(expand "$d")/$sid" ] || return 1
  done
}

install_skills() { # skill ids in $1
  local sids="$1" repos repo sid r args missing a
  local -a flags
  step "Skills"
  flags=()
  for a in $AGENTS; do flags+=(-a "$(a_skills "$(row agent "$a")")"); done
  if [ "${#flags[@]}" -eq 0 ]; then warn "No agents found, so no skills were installed"; return; fi
  if ! runtime_have node; then warn "Node.js is needed for skills (npx)"; return; fi
  if have node && ! node_ok; then warn "Skills need Node.js 22.20 or newer (found $(node -v)). Upgrade it (brew upgrade node) and run this again."; return; fi
  repos="$(for sid in $sids; do field "$(row skill "$sid")" 1; done | awk '!seen[$0]++')"
  for repo in $repos; do
    missing=""
    for sid in $sids; do
      r="$(row skill "$sid")"
      [ "$(field "$r" 1)" = "$repo" ] || continue
      if [ "$UPDATE" = 0 ] && skill_present "$sid" "$AGENTS"; then skip "$sid"; else missing="$missing $sid"; fi
    done
    [ -n "$missing" ] || continue
    args=()
    for sid in $missing; do args+=(--skill "$sid"); done
    run npx -y skills add "$repo" -g -y "${flags[@]}" "${args[@]}"
  done
}

# ---------------------------------------------------------------- main

main() {
  local arg id kind need mcp_ids="" skill_ids="" unknown="" needs=" " r

  while [ "$#" -gt 0 ]; do
    arg="$1"; shift
    case "$arg" in
      --dry-run) DRY_RUN=1 ;;
      --docker) DOCKER=1 ;;
      --update) UPDATE=1 ;;
      --list) LIST=1 ;;
      --remove) REMOVE=1 ;;
      --to) [ "$#" -gt 0 ] || die "--to needs a list of agents"; TO="$1"; shift ;;
      --to=*) TO="${arg#--to=}" ;;
      -h|--help) usage; exit 0 ;;
      -*) usage >&2; die "unknown option $arg" ;;
      *) IDS="$IDS $arg" ;;
    esac
  done

  # A downloaded copy carries its own selection; ids or --to given on the command line replace it.
  if [ -z "$IDS" ] && [ -n "$DEFAULT_IDS" ]; then
    IDS="$DEFAULT_IDS"
    [ -n "$TO" ] || TO="$DEFAULT_TO"
    [ "$DOCKER" = 1 ] || DOCKER="$DEFAULT_DOCKER"
  fi

  CATALOG="$(load_catalog)" || exit 1
  if [ "$LIST" = 1 ]; then
    awk -F'\t' '$1 != "agent" { printf "%-34s %s\n", $2, $1 } $1 == "agent" { printf "%-34s agent (use with --to)\n", $2 }' <<<"$CATALOG"
    exit 0
  fi
  if [ -z "$IDS" ]; then usage >&2; exit 1; fi

  for id in ${TO//,/ }; do [ -n "$(row agent "$id")" ] || die "unknown agent '$id' (see --list)"; done
  if [ "$REMOVE" = 1 ]; then
    [ -n "$TO" ] || die "--remove needs --to with the agents to remove from"
    printf '%sTool up!%s — removing MCP servers%s\n' "$BOLD" "$RESET" "$([ "$DRY_RUN" = 1 ] && echo ' (dry run: nothing will change)')"
    detect_agents
    remove_servers "$IDS"
    step "Done"
    [ "$FAILED" = 0 ] || { say "  ${YELLOW}$FAILED step(s) failed, see above.${RESET}"; exit 1; }
    exit 0
  fi
  for id in $IDS; do
    kind="$(kind_of "$id")"
    case "$kind" in
      mcp) mcp_ids="$mcp_ids $id" ;;
      skill) skill_ids="$skill_ids $id" ;;
      *) unknown="$unknown $id" ;;
    esac
  done
  if [ -n "$unknown" ]; then
    for id in $unknown; do printf '  %s✗%s %s: not in the catalog (see --list)\n' "$RED" "$RESET" "$id" >&2; done
    exit 1
  fi

  printf '%sTool up!%s — tooling up your agents%s\n' "$BOLD" "$RESET" "$([ "$DRY_RUN" = 1 ] && echo ' (dry run: nothing will change)')"

  # Which servers go through the Docker gateway. Needs a working `docker mcp`.
  local gateway=0 direct="" dnames=""
  if [ "$DOCKER" = 1 ]; then
    for id in $mcp_ids; do [ -n "$(s_docker "$(row mcp "$id")")" ] && gateway=1; done
    if [ "$gateway" = 1 ] && ! { have docker && docker mcp --help >/dev/null 2>&1; }; then
      warn "Docker MCP Toolkit not available (Docker Desktop › Settings › Beta features). Wiring those servers directly instead."
      gateway=0
    fi
  fi
  for id in $mcp_ids; do
    r="$(row mcp "$id")"
    if [ "$gateway" = 1 ] && [ -n "$(s_docker "$r")" ]; then dnames="$dnames $(s_docker "$r")"; else direct="$direct $id"; fi
  done

  # Runtimes, only what the selection needs.
  for id in $direct; do for need in $(s_needs "$(row mcp "$id")" | tr ',' ' '); do needs="$needs$need "; done; done
  [ -n "$skill_ids" ] && needs="$needs""node "
  [ "$gateway" = 1 ] && needs="$needs""docker "
  if [ "$needs" != " " ]; then
    step "Runtimes"
    for need in node uv docker; do [[ "$needs" == *" $need "* ]] && ensure_runtime "$need"; done
  fi

  detect_agents

  if [ "$gateway" = 1 ]; then
    step "Docker MCP Gateway"
    local enabled missing_d=""
    enabled="$(docker mcp server ls 2>/dev/null || true)"
    for id in $dnames; do
      if grep -Eq "(^|[^A-Za-z0-9_-])$id([^A-Za-z0-9_-]|$)" <<<"$enabled"; then skip "$id"; else missing_d="$missing_d $id"; fi
    done
    # shellcheck disable=SC2086  # the names are plain ids
    [ -z "$missing_d" ] || run docker mcp server enable $missing_d
  fi

  if [ -n "$mcp_ids" ] && [ -n "$AGENTS" ]; then
    local servers="" a
    [ "$gateway" = 1 ] && servers="MCP_DOCKER${TAB}stdio${TAB}docker mcp gateway run${NL}"
    for id in $direct; do
      r="$(row mcp "$id")"
      servers="$servers$id${TAB}$(s_trans "$r")${TAB}$(s_target "$r")${NL}"
    done
    for a in $AGENTS; do wire_agent "$a" "$servers"; done
  fi

  [ -z "$skill_ids" ] || [ -z "$AGENTS" ] || install_skills "$skill_ids"

  step "Done"
  [ "$DRY_RUN" = 1 ] && say "  This was a dry run. Run again without --dry-run to apply it."
  say "  Servers marked oauth ask you to sign in the first time an agent uses them."
  say "  Re-run any time; it only adds what's missing. Use --update to refresh skills."
  say "  ${DIM}To remove: claude mcp remove <name> -s user · codex mcp remove <name> · gemini mcp remove -s user <name>${RESET}"
  say "  ${DIM}Cursor / VS Code: delete the entry from their mcp.json · skills: npx skills remove -g <id>${RESET}"
  [ "$FAILED" = 0 ] || { say "  ${YELLOW}$FAILED step(s) failed, see above.${RESET}"; exit 1; }
}

main "$@"
