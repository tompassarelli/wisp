post_status() { gh api -X POST "repos/$GH_REPO/statuses/$2" -f state="$1" -f context=autoland -f description="${3:0:139}" ${4:+-f target_url="$4"} > /dev/null || echo "::warning::couldn't post the autoland $1 status on ${2:0:10}"; }
report_member() {
  { echo "Autoland didn't land \`$2\` (${3:0:10}): $4"; echo; printf '%s\n' "$5" | head -60; echo; echo "$6"; } >> "$GITHUB_STEP_SUMMARY"
  post_status "$1" "$3" "$4" "$RUN_URL"
  echo "::error title=Autoland didn't land::$2 (${3:0:10}): $4"
}
refuse_member() { report_member failure "$@" "The branch stays; push a fix to it and it tries again."; }
hold_member() { report_member error "$@" "The branch stays queued: this run reached no verdict on it, so the next queue run takes it again."; }
dispatch() { gh workflow run autoland.yml --ref "$WORKFLOW_REF" -f branch="$1" -f split="$([ "$1" = queue ] || echo yes)"; }
sweep_scratch() {
  git ls-remote origin 'refs/heads/farm/autoland-*' | while read -r _ ref; do
    branch=${ref#refs/heads/}
    run=${branch#farm/autoland-}
    [[ $run =~ ^[0-9]+$ ]] && [ "$(gh run view "$run" --json status --jq .status 2>/dev/null)" = completed ] || continue
    git push -q origin --delete "$branch" && echo "deleted $branch, which finished run $run left behind" >> "$GITHUB_STEP_SUMMARY"
  done
}
