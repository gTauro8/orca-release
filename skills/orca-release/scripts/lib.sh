# Shared helpers for release scripts. Source it; bash 3.2 compatible.
# shellcheck shell=bash

# normalize_remote <url> -> host/path, lowercase, no scheme/credentials/port/.git/trailing slash
normalize_remote() {
  local u="$1"
  u="${u#*://}"                 # drop scheme
  u="${u#*@}"                   # drop credentials / ssh user
  # scp-like host:path (no scheme) or host:port/path
  u=$(printf '%s' "$u" | sed -E 's#^([^/:]+):[0-9]+/#\1/#; s#^([^/:]+):#\1/#')
  u="${u%/}"
  u="${u%.git}"
  u="${u%/}"
  printf '%s\n' "$u" | tr '[:upper:]' '[:lower:]'
}

# _frontmatter <file> -> the YAML frontmatter lines (between the first two ---)
_frontmatter() {
  awk 'NR==1 && $0!="---"{exit} NR==1{next} $0=="---"{exit} {print}' "$1"
}

# frontmatter_get <file> <key> -> scalar value of a top-level key ("" if absent)
frontmatter_get() {
  _frontmatter "$1" | awk -v k="$2" '
    index($0, k ":") == 1 {
      v = substr($0, length(k) + 2)
      sub(/^[ \t]+/, "", v); sub(/[ \t]+#.*$/, "", v); sub(/[ \t]+$/, "", v)
      if (v ~ /^".*"$/) v = substr(v, 2, length(v) - 2)
      print v; exit
    }'
}

# frontmatter_list <file> <key> -> items of an inline list `  key: ["a", "b"]`, one per line, ~ expanded
frontmatter_list() {
  _frontmatter "$1" | awk -v k="$2" '
    $0 ~ "^[ \t]+" k ":[ \t]*\\[" {
      s = $0; sub(/^[^\[]*\[/, "", s); sub(/\][^\]]*$/, "", s)
      n = split(s, parts, ",")
      for (i = 1; i <= n; i++) {
        p = parts[i]; gsub(/^[ \t]*"?|"?[ \t]*$/, "", p)
        if (p != "") print p
      }
      exit
    }' | sed "s#^~#$HOME#"
}

# step_kind "<step text>" -> command | manual
# command iff the whole text is one backtick span, optionally followed by an HTML comment.
step_kind() {
  if printf '%s' "$1" | grep -Eq '^`[^`]+`[[:space:]]*(<!--.*-->)?[[:space:]]*$'; then
    echo command
  else
    echo manual
  fi
}

# section_has <file> <section> -> exit 0 if "## <section>" exists
section_has() { grep -q "^## $2[[:space:]]*$" "$1"; }

# section_get <file> <section> <key> -> value of "- <key>: <value>" inside "## <section>"
# Comments ("<!-- -->", " # ...") removed; a value that is one backtick span loses its backticks.
section_get() {
  awk -v s="## $2" -v k="- $3:" '
    /^## / { inside = ($0 == s); next }
    inside && index($0, k) == 1 {
      v = substr($0, length(k) + 1)
      gsub(/<!--.*-->/, "", v); sub(/[ \t]+#.*$/, "", v)
      sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
      if (v ~ /^`[^`]+`$/) v = substr(v, 2, length(v) - 2)
      print v; exit
    }' "$1"
}

# section_raw <file> <section> <key> -> the value exactly as written (only outer whitespace trimmed)
section_raw() {
  awk -v s="## $2" -v k="- $3:" '
    /^## / { inside = ($0 == s); next }
    inside && index($0, k) == 1 { v = substr($0, length(k) + 1); sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v); print v; exit }' "$1"
}

# release_root -> the user's data folder (recipes/, reports/): ORCA_RELEASE_ROOT or ~/.config/orca-release/root
release_root() {
  if [ -n "${ORCA_RELEASE_ROOT:-}" ]; then echo "$ORCA_RELEASE_ROOT"; return; fi
  local f="$HOME/.config/orca-release/root"
  [ -f "$f" ] && cat "$f"
}
