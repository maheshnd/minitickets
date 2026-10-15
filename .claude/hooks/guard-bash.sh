#!/bin/bash
# guard-bash.sh: a PreToolUse hook that runs before EVERY shell command an agent sends.
#
# WHY: sessions run in bypassPermissions mode (no approval prompts). This guard is what keeps the
# risky commands impossible: anything that pushes, throws away work, changes AWS or the Pulumi
# stack, stops containers, kills processes by name, or touches ~/.aws / ~/.ssh.
#
# HOW Claude Code uses it: it sends the tool call as JSON on stdin. Exit 0 = allowed.
# Exit 2 = blocked; Claude Code cancels the command and shows our stderr line to the agent.
#
# Written for the macOS system bash (3.2): no associative arrays, no mapfile.
#
# Note: commands that touch .env files are NOT blocked here (they are needed for local setup),
# but agents must never print secrets or .env contents into the transcript or logs.

set -u

# 1. Where we are. CLAUDE_PROJECT_DIR is set by Claude Code; fall back to this file's location.
REPO="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
LOG="$REPO/.claude/hooks/blocked.log"
HOME_DIR="${HOME:-/nonexistent}"
CMD=""

# 2. block <reason>: log it, tell the agent in ONE line, and stop the command (exit 2).
block() {
  local when
  when="$(date '+%Y-%m-%d %H:%M:%S')"
  # One log line per block; newlines in the command become spaces so the log stays greppable.
  printf '%s\t%s\t%s\n' "$when" "$1" "$(printf '%s' "$CMD" | tr '\n' ' ')" >>"$LOG" 2>/dev/null
  echo "Blocked: $1 Do NOT work around this. Continue without it and list it under \"manual steps for me\" in your report." >&2
  exit 2
}

# 3. Read the hook JSON. Without jq we cannot see the command, so we fail CLOSED (block).
INPUT="$(cat)"
if ! command -v jq >/dev/null 2>&1; then
  CMD="(unknown)"
  block "the command guard needs jq and it is not installed (brew install jq)."
fi
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
START_CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)"
[ -z "$START_CWD" ] && START_CWD="$PWD"
# No command (for example a Monitor that watches a WebSocket): nothing to check.
[ -z "$CMD" ] && exit 0

# ---------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------

# 4. abspath <path> <cwd>: turn a path into a clean absolute path (~, $HOME, ., .. resolved).
#    Prints nothing when the path holds another variable ($DIR): we can't know where it points.
abspath() {
  local p="$1" base="$2" part res="" parts
  case "$p" in
    "~") p="$HOME_DIR" ;;
    "~/"*) p="$HOME_DIR/${p#\~/}" ;;
    '$HOME') p="$HOME_DIR" ;;
    '$HOME/'*) p="$HOME_DIR/${p#\$HOME/}" ;;
    '${HOME}') p="$HOME_DIR" ;;
    '${HOME}/'*) p="$HOME_DIR/${p#\$\{HOME\}/}" ;;
  esac
  case "$p" in *'$'*) return ;; esac
  case "$p" in /*) ;; *) p="$base/$p" ;; esac
  IFS='/' read -r -a parts <<<"$p"
  for part in ${parts[@]+"${parts[@]}"}; do
    case "$part" in
      "" | ".") ;;
      "..") res="${res%/*}" ;;
      *) res="$res/$part" ;;
    esac
  done
  printf '%s' "${res:-/}"
}

# 5. is_temp <abs path>: inside a temp folder (but not the temp folder itself). Deleting there is safe.
is_temp() {
  local t
  for t in /tmp /private/tmp /var/folders /private/var/folders "${TMPDIR%/}"; do
    [ -n "$t" ] && case "$1" in "$t"/?*) return 0 ;; esac
  done
  return 1
}

# 6. in_secret_dir <word>: does this word point into ~/.aws or ~/.ssh?
in_secret_dir() {
  local p
  p="$(abspath "$1" "$CWD")"
  [ -z "$p" ] && return 1
  case "$p" in
    "$HOME_DIR/.aws" | "$HOME_DIR/.aws/"* | "$HOME_DIR/.ssh" | "$HOME_DIR/.ssh/"*) return 0 ;;
  esac
  return 1
}

# ---------------------------------------------------------------------------------------------
# Whole-command checks (before splitting)
# ---------------------------------------------------------------------------------------------

# 7. Join "\ + newline" line continuations into one line.
JOINED="$(printf '%s\n' "$CMD" | sed -e ':a' -e '/\\$/N' -e 's/\\\n//' -e 'ta')"

# 8. Drop heredoc BODIES (commit messages, file contents) so text like "pulumi up" inside them
#    is not read as a command. Keep the body when the heredoc feeds a shell (bash <<EOF,
#    cat <<EOF | sh). Done before step 9, so an apostrophe in a body can't confuse the quotes.
STRIPPED="$(printf '%s\n' "$JOINED" | awk -v sq="'" '
  BEGIN { opener = "<<-?[ \t]*[\"" sq "]?[A-Za-z_][A-Za-z0-9_]*"; prefix = "^<<-?[ \t]*[\"" sq "]?" }
  skip { t = $0; sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t); if (t == marker) skip = 0; next }
  {
    print
    if (match($0, opener)) {
      before = substr($0, 1, RSTART - 1)
      if (substr($0, RSTART + 2, 1) == "<" || substr(before, length(before), 1) == "<") next
      m = substr($0, RSTART, RLENGTH); sub(prefix, "", m); marker = m
      if ($0 !~ /(^|[^A-Za-z0-9_.\/-])(ba|z|da|k)?sh([ \t]|$)/) skip = 1
    }
  }')"

# 9. Resolve quotes. Quoted text is DATA (a commit message, a grep pattern), so its ; | & ( ) < >
#    become spaces and can't start a fake command. It stays CODE (kept as is) after -c or eval
#    (bash -c "git push"), or when a double-quoted string runs $(...) or `...`.
#    Quotes and backslashes are then dropped, so \git push and "git" push read as git push.
FLAT="$(printf '%s' "$STRIPPED" | awk -v sq="'" '
  BEGIN { RS = "\001" }
  {
    s = $0; out = ""; i = 1; L = length(s)
    while (i <= L) {
      c = substr(s, i, 1)
      if (c == "\\") { out = out substr(s, i + 1, 1); i += 2; continue }
      if (c != sq && c != "\"") { out = out c; i++; continue }
      # Find the closing quote (inside "...", a backslash escapes the next character).
      j = i + 1
      while (j <= L && substr(s, j, 1) != c) { if (c == "\"" && substr(s, j, 1) == "\\") j++; j++ }
      q = substr(s, i + 1, j - i - 1)
      code = (out ~ /(^|[ \t])(-[A-Za-z]*c|eval)[ \t]+$/) || (c == "\"" && (q ~ /\$\(/ || index(q, "`") > 0))
      if (!code) gsub(/[;&|()`<>\n]/, " ", q)
      gsub(/\\/, "", q)
      out = out q; i = j + 1
    }
    printf "%s", out
  }')"

# 10. curl / wget piped into a shell or interpreter runs code from the internet unseen.
if printf '%s' "$FLAT" | tr '\n' ' ' | grep -Eq \
  '(curl|wget)[^|;&]*\|[[:space:]]*(sudo[[:space:]]+)?(env[[:space:]]+)?([^[:space:]]*/)?(ba|z|da|k|fi)?sh([[:space:]]|$)|(curl|wget)[^|;&]*\|[[:space:]]*([^[:space:]]*/)?(python3?|node|perl|ruby)([[:space:]]|$)|(ba|z|da)?sh[[:space:]]+(-c[[:space:]]+)?[<$]\((curl|wget)'; then
  block "piping curl/wget into a shell runs unreviewed code. Download the file, read it, and ask the owner."
fi

# 11. Split into simple commands at ; && || | & ( ) ` $( and newlines, and at "{ " groups.
#     Each piece is then checked on its own, so "cd infra && pulumi up" checks "pulumi up".
SEGMENTS="$(printf '%s\n' "$FLAT" | sed -e 's/{[[:space:]]/\
/g' | tr ';&|()`\n' '\n\n\n\n\n\n\n')"

# ---------------------------------------------------------------------------------------------
# Per-command checks
# ---------------------------------------------------------------------------------------------

CWD="$(abspath "$START_CWD" /)"

# 12. Each rule below looks at ONE simple command: $C is the program, ARGS the rest.
check_segment() {
  local words w C n i sub op svc dest a
  read -r -a words <<<"$1"
  [ "${#words[@]}" -eq 0 ] && return 0

  # 12a. Peel off wrappers that just run the next word: FOO=1, env, command, nohup, time,
  #      timeout, nice, xargs, watch, npx, pnpm exec / dlx, shell keywords, and bash/sh -c.
  while [ "${#words[@]}" -gt 0 ]; do
    w="${words[0]}"
    case "$w" in
      [A-Za-z_]*=*) words=("${words[@]:1}"); continue ;;
      if | then | else | elif | do | while | until | ! | "}" | time | command | builtin | exec | nohup | eval | --)
        words=("${words[@]:1}"); continue ;;
      sudo | */sudo | doas) block "sudo is never allowed for an agent." ;;
      env | */env | nice | watch | npx)
        words=("${words[@]:1}")
        while [ "${#words[@]}" -gt 0 ] && case "${words[0]}" in -*) true ;; *) false ;; esac; do
          case "${words[0]}" in -u | -n | -p | -S | -C) words=("${words[@]:1}") ;; esac
          [ "${#words[@]}" -gt 0 ] && words=("${words[@]:1}")
        done
        continue ;;
      timeout | */timeout)
        words=("${words[@]:1}")
        while [ "${#words[@]}" -gt 0 ] && case "${words[0]}" in -*) true ;; *) false ;; esac; do
          case "${words[0]}" in -s | -k) words=("${words[@]:1}") ;; esac
          [ "${#words[@]}" -gt 0 ] && words=("${words[@]:1}")
        done
        [ "${#words[@]}" -gt 0 ] && words=("${words[@]:1}") # the duration
        continue ;;
      xargs | */xargs)
        words=("${words[@]:1}")
        while [ "${#words[@]}" -gt 0 ] && case "${words[0]}" in -*) true ;; *) false ;; esac; do
          case "${words[0]}" in -I | -n | -P | -L | -s | -d | -E | -a) words=("${words[@]:1}") ;; esac
          [ "${#words[@]}" -gt 0 ] && words=("${words[@]:1}")
        done
        continue ;;
      pnpm | npm | yarn)
        case "${words[1]:-}" in exec | dlx | x) words=("${words[@]:2}"); continue ;; esac
        break ;;
      bash | sh | zsh | dash | ksh | */bash | */sh | */zsh | */dash | */ksh)
        # Only a shell given an inline script (-c, -lc, -ec ...) is a wrapper; "bash x.sh" is not.
        case "${words[1]:-}" in
          -*c*) words=("${words[@]:1}")
            while [ "${#words[@]}" -gt 0 ] && case "${words[0]}" in -*) true ;; *) false ;; esac; do
              words=("${words[@]:1}")
            done
            continue ;;
        esac
        break ;;
      *) break ;;
    esac
  done
  [ "${#words[@]}" -eq 0 ] && return 0

  C="${words[0]##*/}" # /usr/bin/git -> git
  n="${#words[@]}"

  # 12b. cd / pushd: remember the new folder, so "cd /tmp && rm -rf x" knows where x is.
  case "$C" in
    cd | pushd)
      if [ "$n" -lt 2 ]; then CWD="$HOME_DIR"
      elif [ "${words[1]}" != "-" ]; then a="$(abspath "${words[1]}" "$CWD")"; [ -n "$a" ] && CWD="$a"
      fi
      return 0 ;;
  esac

  # 12c. Writing into ~/.aws or ~/.ssh (keys, credentials, AWS profiles).
  if printf '%s' "$1" | grep -Eq ">>?[[:space:]]*(~|\\\$HOME|\\\$\{HOME\}|$HOME_DIR)/\.(aws|ssh)(/|[[:space:]]|$)"; then
    block "writing into ~/.aws or ~/.ssh is for the human."
  fi
  case "$C" in
    cp | mv | rsync | scp | install | ln)
      in_secret_dir "${words[$((n - 1))]}" && block "writing into ~/.aws or ~/.ssh is for the human." ;;
    tee | touch | rm | rmdir | mkdir | chmod | chown | truncate | sed | ssh-keygen | dd)
      for a in "${words[@]:1}"; do
        case "$a" in of=*) a="${a#of=}" ;; esac
        in_secret_dir "$a" && block "writing into ~/.aws or ~/.ssh is for the human."
      done ;;
  esac

  case "$C" in
    # 12d. git: anything that publishes or throws away work.
    git)
      i=1
      while [ "$i" -lt "$n" ]; do
        case "${words[$i]}" in
          -C | -c | --git-dir | --work-tree | --namespace) i=$((i + 2)) ;;
          -*) i=$((i + 1)) ;;
          *) break ;;
        esac
      done
      sub="${words[$i]:-}"
      case "$sub" in
        push) block "git push is for the human." ;;
        reset | stash | clean | rebase | restore | filter-branch | filter-repo)
          block "git $sub can throw away or rewrite work; that is for the human." ;;
        checkout)
          for a in "${words[@]:$((i + 1))}"; do
            case "$a" in --|.|-f|--force) block "git checkout $a throws away local changes; that is for the human." ;; esac
          done ;;
        commit)
          for a in "${words[@]:$((i + 1))}"; do
            [ "$a" = "--amend" ] && block "git commit --amend rewrites a commit; that is for the human."
          done ;;
      esac ;;

    # 12e. pulumi: only read commands (preview, stack output, config get, ...) are allowed.
    pulumi)
      i=1
      while [ "$i" -lt "$n" ]; do
        case "${words[$i]}" in
          -C | --cwd | -s | --stack) i=$((i + 2)) ;;
          -*) i=$((i + 1)) ;;
          *) break ;;
        esac
      done
      sub="${words[$i]:-}"; op="${words[$((i + 1))]:-}"
      case "$sub" in
        up | update | destroy | refresh | import | state | cancel)
          block "pulumi $sub changes the stack; the owner runs it." ;;
        config)
          case "$op" in set | set-all | rm | rm-all) block "pulumi config $op changes stack config; the owner runs it." ;; esac ;;
        stack)
          case "$op" in rm) block "pulumi stack rm deletes a stack; the owner runs it." ;; esac ;;
      esac ;;

    # 12f. aws: read-only calls only (describe-*, get-*, list-*, logs tail, s3 ls / download).
    aws)
      i=1
      while [ "$i" -lt "$n" ]; do
        case "${words[$i]}" in
          --profile | --region | --output | --endpoint-url | --query | --color | --ca-bundle | \
            --cli-read-timeout | --cli-connect-timeout | --cli-binary-format) i=$((i + 2)) ;;
          -*) i=$((i + 1)) ;;
          *) break ;;
        esac
      done
      svc="${words[$i]:-}"; op="${words[$((i + 1))]:-}"
      [ -z "$svc" ] && return 0
      case "$svc" in
        iam) block "aws iam commands are for the human." ;;
        configure)
          case "$op" in list | list-profiles | get | "") ;; *) block "aws configure $op writes ~/.aws; that is for the human." ;; esac ;;
        s3)
          case "$op" in
            ls | presign | "") ;;
            cp | sync)
              # The destination is the last word that is not an option.
              dest=""
              for a in "${words[@]:$((i + 2))}"; do case "$a" in -*) ;; *) dest="$a" ;; esac; done
              case "$dest" in s3://*) block "aws s3 $op TO s3:// changes a bucket; that is for the human." ;; esac ;;
            *) block "aws s3 $op changes a bucket; that is for the human." ;;
          esac ;;
        *)
          case "$svc/$op" in
            secretsmanager/get-secret-value) block "aws secretsmanager get-secret-value reads a secret." ;;
            ecr/get-login-password) block "aws ecr get-login-password prints a credential." ;;
            ssm/get-parameter | ssm/get-parameters | ssm/get-parameters-by-path)
              for a in "${words[@]:$((i + 2))}"; do
                [ "$a" = "--with-decryption" ] && block "aws ssm $op --with-decryption reads a secret."
              done ;;
          esac
          case "$op" in
            "" | help | wait | tail | describe-* | get-* | list-* | head-* | batch-get-* | lookup-* | \
              search-* | filter-* | query | scan | validate-* | estimate-* | simulate-*) ;;
            *) block "aws $svc $op can change AWS resources; only read-only aws calls are allowed." ;;
          esac ;;
      esac ;;

    # 12g. docker: never stop / remove containers or volumes (other projects share this Docker).
    docker | docker-compose)
      i=1
      [ "$C" = "docker" ] && [ "${words[1]:-}" = "compose" ] && i=2
      if [ "$C" = "docker-compose" ] || [ "$i" -eq 2 ]; then
        while [ "$i" -lt "$n" ]; do
          case "${words[$i]}" in
            -f | --file | -p | --project-name | --profile | --env-file | --project-directory) i=$((i + 2)) ;;
            -*) i=$((i + 1)) ;;
            *) break ;;
          esac
        done
        sub="${words[$i]:-}"
        case "$sub" in
          down | stop | rm | kill | restart | pause)
            block "docker compose $sub stops or removes containers; that is for the human." ;;
        esac
      else
        sub="${words[1]:-}"; op="${words[2]:-}"
        case "$sub" in
          rm | rmi | stop | kill | restart) block "docker $sub stops or removes containers/images; that is for the human." ;;
          system | volume | container | image | network | builder)
            case "$op" in
              rm | prune | stop | kill | restart) block "docker $sub $op removes or stops shared Docker resources; that is for the human." ;;
            esac ;;
        esac
      fi ;;

    # 12h. pnpm db:down stops the shared Postgres + Redis containers.
    pnpm)
      for a in "${words[@]:1}"; do
        [ "$a" = "db:down" ] && block "pnpm db:down stops the database containers; that is for the human."
      done ;;

    # 12i. Processes: only kill by PID number (or $! / $PID from a process you started).
    pkill | killall) block "$C kills by name and can hit the owner's dev servers. Use kill <pid> of a process you started." ;;
    kill)
      a=0
      for w in "${words[@]:1}"; do
        case "$w" in
          -l | -L) return 0 ;;
          -s | -n) ;;
          -*) ;;
          *[!0-9]*)
            case "$w" in
              '$!' | %[0-9]*) a=$((a + 1)) ;;
              '$'[A-Za-z_]* | '${'[A-Za-z_]*'}') a=$((a + 1)) ;;
              [A-Z]*) ;; # a signal name after -s, e.g. TERM
              *) block "kill only takes PID numbers (kill <pid>), never names, patterns or \$(...)." ;;
            esac ;;
          *) a=$((a + 1)) ;;
        esac
      done
      [ "$a" -eq 0 ] && block "kill needs explicit PID numbers (no xargs, no \$(...))." ;;

    # 12j. rm -r: only inside the repo (or a temp folder), never the repo itself, .git, / or ~.
    rm)
      local recursive=0 opts_done=0 t
      for a in "${words[@]:1}"; do
        [ "$opts_done" -eq 0 ] && case "$a" in
          --) opts_done=1; continue ;;
          --recursive) recursive=1; continue ;;
          --*) continue ;;
          -*[rR]*) recursive=1; continue ;;
          -*) continue ;;
        esac
      done
      [ "$recursive" -eq 0 ] && return 0
      opts_done=0
      for a in "${words[@]:1}"; do
        [ "$opts_done" -eq 0 ] && case "$a" in --) opts_done=1; continue ;; -*) continue ;; esac
        t="$(abspath "$a" "$CWD")"
        [ -z "$t" ] && block "rm -r with a variable path ($a): write the literal path so the guard can check it."
        # "repo/*" and "repo/." mean the whole repo.
        while :; do case "$t" in */\* | */.) t="${t%/*}" ;; *) break ;; esac; done
        case "$t" in
          "$REPO/.git" | "$REPO/.git/"*) block "rm -r on .git destroys the repo history." ;;
          "$REPO"/?*) ;;
          *) is_temp "$t" || block "rm -r outside the repo ($t) is for the human." ;;
        esac
      done ;;

    # 12k. chmod / chown -R on / , a top-level folder, or your home folder.
    chmod | chown)
      local rec=0
      for a in "${words[@]:1}"; do case "$a" in -*R*) rec=1 ;; esac; done
      if [ "$rec" -eq 1 ]; then
        for a in "${words[@]:1}"; do
          case "$a" in -*) continue ;; esac
          t="$(abspath "$a" "$CWD")"
          case "$t" in
            / | /[!/]* ) case "$t" in /*/*) ;; *) block "$C -R on $t changes the whole system." ;; esac ;;
          esac
          [ "$t" = "$HOME_DIR" ] && block "$C -R on your home folder is for the human."
        done
      fi ;;
  esac
  return 0
}

# 13. Run every simple command through the checks, in order (so "cd" is tracked).
while IFS= read -r seg; do
  check_segment "$seg"
done <<<"$SEGMENTS"

exit 0
