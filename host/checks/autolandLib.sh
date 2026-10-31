post_status() { gh api -X POST "repos/$GH_REPO/statuses/$2" -f state="$1" -f context=autoland -f description="${3:0:139}" ${4:+-f target_url="$4"} > /dev/null || echo "::warning::couldn't post the autoland $1 status on ${2:0:10}"; }
fail_tip() { post_status failure "$1" "$2" "$RUN_URL"; }
refuse_member() {
  { echo "Autoland didn't land \`$1\` (${2:0:10}): $3"; echo; printf '%s\n' "$4" | head -60
    echo; echo "The branch stays; push a fix to it and it tries again."; } >> "$GITHUB_STEP_SUMMARY"
  fail_tip "$2" "$3"
  echo "::error title=Autoland didn't land::$1 (${2:0:10}): $3"
}
dispatch() { gh workflow run autoland.yml --ref "$WORKFLOW_REF" -f branch="$1" -f split="$([ "$1" = queue ] || echo yes)"; }
sweep_scratch() {
  git ls-remote origin 'refs/heads/farm/autoland-*' | while read -r _ ref; do
    branch=${ref#refs/heads/}
    run=${branch#farm/autoland-}
    [[ $run =~ ^[0-9]+$ ]] && [ "$(gh run view "$run" --json status --jq .status 2>/dev/null)" = completed ] || continue
    git push -q origin --delete "$branch" && echo "deleted $branch, which finished run $run left behind" >> "$GITHUB_STEP_SUMMARY"
  done
}
