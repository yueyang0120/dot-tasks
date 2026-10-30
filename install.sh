#!/usr/bin/env bash
# One-command local demo. Account connection is handled by SETUP.md.
# Keep the entry point last so an interrupted download cannot run half a script.
dot_tasks_install() (
  set -euo pipefail
  local repo='https://github.com/yueyang0120/dot-tasks.git'
  local target="${DOT_TASKS_DIR:-${HOME:?HOME is required}/dot-tasks}"
  local mode='' start=1 port=5173 origin root

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dir|--port)
        [ "$#" -ge 2 ] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
        if [ "$1" = --dir ]; then target="$2"; else port="$2"; fi
        shift 2 ;;
      --empty) mode='--empty'; shift ;;
      --no-start) start=0; shift ;;
      --help)
        printf '%s\n' 'Usage: bash install.sh [--dir PATH] [--empty] [--no-start] [--port PORT]' \
          'Requires Git and Node.js 22.13+. Starts a local demo; use SETUP.md to connect your DOT.'
        exit 0 ;;
      *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
    esac
  done

  for program in git node npm; do
    command -v "$program" >/dev/null 2>&1 || {
      printf 'Install %s first, then run this command again. Node.js: https://nodejs.org/\n' "$program" >&2
      exit 1
    }
  done
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<13)){console.error("DOT Tasks needs Node.js 22.13 or newer.");process.exit(1)}'
  node -e 'if(!/^\d+$/.test(process.argv[1])||Number(process.argv[1])<1||Number(process.argv[1])>65535){console.error("Port must be 1–65535.");process.exit(2)}' "$port"
  [ -n "$target" ] && [[ "$target" != -* ]] || { printf 'Choose a nonempty directory path.\n' >&2; exit 2; }
  [ ! -L "$target" ] || { printf 'Choose a directory that is not a symbolic link.\n' >&2; exit 1; }

  if [ -e "$target" ]; then
    [ -d "$target/.git" ] || { printf 'Directory already exists; choose another with --dir. Nothing was overwritten.\n' >&2; exit 1; }
    root="$(git -C "$target" rev-parse --show-toplevel)"
    [ "$root" = "$(cd "$target" && pwd -P)" ] || { printf 'This is not the root of a standalone checkout.\n' >&2; exit 1; }
    origin="$(git -C "$target" remote get-url origin)"
    case "$origin" in
      "$repo"|https://github.com/yueyang0120/dot-tasks|git@github.com:yueyang0120/dot-tasks.git) ;;
      *) printf 'That directory belongs to another repository. Choose another with --dir.\n' >&2; exit 1 ;;
    esac
    printf 'Using your existing DOT Tasks checkout; source files will not be updated.\n'
  else
    git clone --depth 1 -- "$repo" "$target"
  fi

  cd "$target"
  node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(".openai/hosting.json","utf8"));if(m.project_id){console.error("This checkout is a deployed Site. Use a separate directory for the local demo.");process.exit(1)}'
  if [ -n "$mode" ]; then npm run setup -- "$mode"; else npm run setup; fi
  if [ "$start" -eq 0 ]; then
    printf '\nInstalled in %s. Start it with:\n' "$(pwd -P)"
    printf 'cd %q && npm run dev -- --port %q\n' "$(pwd -P)" "$port"
    exit 0
  fi
  exec npm run dev -- --port "$port"
)

dot_tasks_install "$@"
