#!/bin/sh
# Stand-in for private-desktop.sh start: like dbus-run-session's bus, a holder escapes the process group and keeps the desktop's output open, and stopping the desktop SIGKILLs its command, as bwrap --die-with-parent does.
[ "$1" = start ] || exit 2
shift
while [ $# -gt 0 ] && [ "$1" != -- ]; do shift; done
mkdir -p "$WISP_TEST_DESKTOPS"
run=$(mktemp -d "$WISP_TEST_DESKTOPS/run.XXXXXX")
touch "$run/lifecycle-owned" "$run/active"
echo "Run: $run"
env -u WISP_TEST_MARK setsid sleep 45 &
echo $! >> "$WISP_TEST_DESKTOPS/holders"
agent=""
if [ "$1" = -- ]; then
  while [ $# -gt 0 ] && [ "${1%pairAgent.ts}" = "$1" ]; do shift; done
  shift
  PRIVATE_DESKTOP_RUN=$run "$WISP_TEST_BUN" "$(dirname "$0")/agent.ts" "$@" &
  agent=$!
else
  sleep 600 &
fi
trap '[ -n "$agent" ] && kill -KILL "$agent"; rm -rf "$run"; exit 0' TERM INT
wait
