post_status() { gh api -X POST "repos/$GH_REPO/statuses/$2" -f state="$1" -f context=autoland -f description="${3:0:139}" ${4:+-f target_url="$4"} > /dev/null || echo "::warning::couldn't post the autoland $1 status on ${2:0:10}"; }
fail_tip() { post_status failure "$1" "$2" "$RUN_URL"; }
refuse_member() {
  { echo "Autoland didn't land \`$1\` (${2:0:10}): $3"; echo; printf '%s\n' "$4" | head -60
    echo; echo "The branch stays; push a fix to it and it tries again."; } >> "$GITHUB_STEP_SUMMARY"
  fail_tip "$2" "$3"
  echo "::error title=Autoland didn't land::$1 (${2:0:10}): $3"
}
dispatch() { gh workflow run autoland.yml --ref "$WORKFLOW_REF" -f branch="$1" -f split="$([ "$1" = queue ] || echo yes)"; }
queue_pending() { for status in pending queued waiting; do gh run list --workflow autoland.yml --status "$status" --limit 100 --json displayTitle --jq 'any(.[]; .displayTitle == "Autoland queue")'; done | grep -q true; }
requeue_queue() { queue_pending || dispatch queue; }
