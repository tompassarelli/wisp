#!/bin/sh
# Stand-in for private-desktop.sh start: like dbus-run-session's bus, a holder escapes the process group and keeps the desktop's output open; its command runs outside the capacity scope, as in its own systemd scope, and stopping the desktop SIGKILLs it, as bwrap --die-with-parent does.
[ "$1" = start ] || exit 2
shift
while [ $# -gt 0 ] && [ "$1" != -- ]; do shift; done
mkdir -p "$WISP_TEST_DESKTOPS"
run=$(mktemp -d "$WISP_TEST_DESKTOPS/run.XXXXXX")
touch "$run/lifecycle-owned" "$run/active"
echo "Run: $run"
if [ "${WISP_TEST_HOLDER:-}" = quiet ]; then env -u WISP_TEST_MARK setsid sleep 45 >/dev/null 2>&1 & else env -u WISP_TEST_MARK setsid sleep 45 & fi
echo $! >> "$WISP_TEST_DESKTOPS/holders"
agent=""
if [ "$1" = -- ]; then
  while [ $# -gt 0 ] && [ "${1%pairAgent.ts}" = "$1" ]; do shift; done
  shift
  PRIVATE_DESKTOP_RUN=$run env -u WISP_TEST_SCOPE "$WISP_TEST_BUN" "$(dirname "$0")/agent.ts" "$@" &
  agent=$!
else
  sleep 600 &
fi
trap '[ -n "$agent" ] && kill -KILL "$agent"; rm -rf "$run"; exit 0' TERM INT
wait
