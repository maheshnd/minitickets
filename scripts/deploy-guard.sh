#!/usr/bin/env bash
# The CD deploy guard: may THIS commit's infrastructure code be applied to AWS now?
# Run by .github/workflows/cd.yml (deploy job, step 28b), BEFORE any `pulumi` command, always in the
# version from main's NEWEST commit (an old commit may carry an old guard, or none).
# Exit 0 = go on, exit 1 = refuse (with a ::error:: line that GitHub shows on the run's page).
# Tested by scripts/deploy-guard.test.ts (a throw-away git repo, no AWS).
#
# WHY IT EXISTS (incident, 2026-10-15): a CD deploy of commit 6ea9575 waited for approval for days.
# When it was approved, it checked out 6ea9575 and ran `pulumi up` with that OLD infrastructure
# code. Pulumi makes AWS match the code it is given, so it DELETED 10 resources that newer commits
# had added. Recovery needed targeted local `pulumi up`s (docs/20-deploy-day.md, 3.11). The
# approval page showed WHICH commit, but nothing said "this one is old".
#
# The two rules:
#   1. SUPERSEDED (CD runs started by CI only): main already has a newer commit. Refuse; the
#      newest run is the one to approve.
#   2. OLDER THAN DEPLOYED (every run): the commit is an ANCESTOR of the commit CD last applied
#      (SSM /minitickets/dev/deployed-commit), so its infrastructure code is older than what is
#      live. Refuse, unless a manual run sets allow_older_infra (a deliberate infra rollback).
#   App rollbacks are not affected: a manual run with image_tag deploys an OLD image with main's
#   NEWEST infrastructure code, which is never older than the recorded commit.
#
# Input (environment variables, set by cd.yml):
#   CHECKED      the commit that was checked out (its infrastructure code would be applied)
#   MAIN_TIP     main's newest commit right now; EMPTY for a manual run (rule 1 is skipped)
#   RECORDED     the commit CD last applied (SSM), or "none" when nothing is recorded yet
#   ALLOW_OLDER  "true" only for a manual run with allow_older_infra (rule 2 becomes a warning)

# 1. Stop at the first error and on unset variables: a guard that fails must REFUSE, never pass.
# @concept: release-guard
set -euo pipefail

: "${CHECKED:?}" "${RECORDED:?}"
MAIN_TIP="${MAIN_TIP:-}"
ALLOW_OLDER="${ALLOW_OLDER:-false}"

# 2. refuse <message>: one ::error:: line, then exit 1 (the deploy stops before anything changes).
refuse() {
  echo "::error::$1"
  exit 1
}

# 3. Full 40-character ids, so "6ea9575" and its full id compare as the same commit.
CHECKED="$(git rev-parse --verify --quiet "$CHECKED^{commit}")" || refuse "Commit $CHECKED is not in the checked-out history."
SHORT="${CHECKED:0:7}"

# 4. RULE 1: superseded. Only for runs CI started (MAIN_TIP is set): a manual run deploys main's
#    newest commit by definition. Any difference refuses: main moved on (the normal case), or main
#    was rewritten so this commit is no longer on it.
if [ -n "$MAIN_TIP" ]; then
  MAIN_TIP="$(git rev-parse --verify --quiet "$MAIN_TIP^{commit}")" || refuse "main's newest commit $MAIN_TIP is not in the checked-out history."
  if [ "$CHECKED" != "$MAIN_TIP" ]; then
    if git merge-base --is-ancestor "$CHECKED" "$MAIN_TIP"; then
      refuse "Superseded: main already has a newer commit (${MAIN_TIP:0:7}) than this run's $SHORT. Deploy the newest run instead (or Actions -> CD -> Run workflow on main)."
    fi
    refuse "Commit $SHORT is not on main any more (main is ${MAIN_TIP:0:7}). Deploy the newest run instead."
  fi
fi

# 5. Nothing recorded yet (the first deploy with this guard): nothing to compare with, go on.
#    The deploy records its own commit at the end (cd.yml, "Record the deployed commit").
if [ "$RECORDED" = "none" ]; then
  echo "::notice::No deployed commit recorded yet: deploying $SHORT and recording it."
  exit 0
fi

# 6. older_than_recorded <reason>: RULE 2's answer. Refuse, unless the run asked for a deliberate
#    infra rollback (then only warn, so the run's page still shows it).
older_than_recorded() {
  if [ "$ALLOW_OLDER" = "true" ]; then
    echo "::warning::$1 allow_older_infra is set: deploying OLDER infrastructure code on purpose. Resources added after $SHORT will be DELETED."
    exit 0
  fi
  refuse "$1 Refusing: \`pulumi up\` with older code DELETES what newer commits added. For an app rollback use image_tag (it keeps main's newest infrastructure); for a deliberate infra rollback run the workflow by hand with allow_older_infra: true."
}

# 7. The recorded commit must be in our history, or we cannot compare (e.g. main was rewritten).
RECORDED_FULL="$(git rev-parse --verify --quiet "$RECORDED^{commit}")" ||
  older_than_recorded "The deployed commit ${RECORDED:0:7} (SSM) is not in this history, so it cannot be compared with $SHORT."

# 8. The same commit again (a redeploy, or an app rollback with no new commit since): fine.
if [ "$CHECKED" = "$RECORDED_FULL" ]; then
  echo "Commit $SHORT is the deployed commit: a redeploy."
  exit 0
fi

# 9. RULE 2: this commit is an ancestor of the deployed one = its code is OLDER than what is live.
if git merge-base --is-ancestor "$CHECKED" "$RECORDED_FULL"; then
  older_than_recorded "Commit $SHORT is OLDER than the deployed commit ${RECORDED_FULL:0:7}."
fi

# 10. The deployed commit is an ancestor of this one = this one is newer: the normal deploy.
if git merge-base --is-ancestor "$RECORDED_FULL" "$CHECKED"; then
  echo "Commit $SHORT is newer than the deployed commit ${RECORDED_FULL:0:7}: OK."
  exit 0
fi

# 11. Neither contains the other (two separate lines of history): unclear which is newer, so it is
#     treated like rule 2.
older_than_recorded "Commit $SHORT and the deployed commit ${RECORDED_FULL:0:7} are on separate lines of history."
