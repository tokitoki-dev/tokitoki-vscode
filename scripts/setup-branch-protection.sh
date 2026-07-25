#!/bin/sh

# Applies the main-branch protection this repository relies on. Idempotent;
# run by a repository admin (`gh auth login` first).
#
# main only accepts merges from dev: direct pushes are rejected because every
# change must arrive by pull request, and the Guard workflow fails any pull
# request whose source branch is not dev. Both CI and Guard are required
# checks, so a red build cannot merge either.

set -eu

REPO="${1:-tokitoki-dev/tokitoki-vscode}"

gh api --method PUT "repos/$REPO/branches/main/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build", "merge-source"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo "Branch protection applied to $REPO main."
