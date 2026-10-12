#!/usr/bin/env bash
# Runs the database migrations on AWS as a one-off ECS task, waits for it, and reports.
# Run from anywhere:  pnpm infra:migrate
# Needs the data AND compute layers on (the cluster and task definition are part of compute).
# Explained in docs/17-infra-ecs-api.md.

# 1. WHAT: stop at the first error, on unset variables, and in failed pipes.
#    WHY: a half-finished run must never look like a success.
set -euo pipefail

# 2. WHAT: work from the repo root, wherever the script was started.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 3. WHAT: use the same AWS profile and region as Pulumi, unless the caller already set them.
#    WHY: the task must run in the account Pulumi created everything in (same as push-images.sh).
cd "$ROOT/infra"
export AWS_PROFILE="${AWS_PROFILE:-$(pulumi config get aws:profile 2>/dev/null || true)}"
export AWS_REGION="${AWS_REGION:-$(pulumi config get aws:region 2>/dev/null || echo us-east-1)}"
if [ -z "$AWS_PROFILE" ]; then unset AWS_PROFILE; fi

# 4. WHAT: check the compute layer is on. Its cluster name is null (or missing) when it is off.
#    "|| true": a missing output must reach our clear message below, not stop the script.
CLUSTER="$(pulumi stack output clusterName 2>/dev/null || true)"
if [ -z "$CLUSTER" ] || [ "$CLUSTER" = "null" ]; then
  echo "ERROR: the compute layer is off (no cluster). Turn on data and compute first:" >&2
  echo "  cd infra && pulumi config set computeEnabled true && pulumi up" >&2
  exit 1
fi

# 5. WHAT: read the rest from the Pulumi stack outputs.
#    WHY: Pulumi is the single source of truth; nothing is typed here by hand.
#    publicSubnetIds is a JSON list; tr turns ["a","b"] into a,b for the AWS CLI.
TASK_DEF="$(pulumi stack output apiTaskDefinitionArn)"
LOG_GROUP="$(pulumi stack output apiLogGroup)"
SUBNETS="$(pulumi stack output publicSubnetIds --json | tr -d '[]" \n')"
API_SG="$(pulumi stack output apiSgId)"
cd "$ROOT"

# @concept: fargate-spot
# 6. WHAT: start ONE task from the api task definition, but replace its command with the
#    migration runner. Same image, same secrets, same subnets and security group as the api.
#    WHY the same task definition: the migration must use exactly the code (and SQL files) of
#    the image that is deployed, and it needs the same DB_* settings and network access.
#    --launch-type FARGATE (not Spot): a migration must not be interrupted halfway. It runs
#    for seconds, so the price difference is nothing.
#    --started-by: a label, so this task is easy to spot in the console.
echo "Starting the migration task in cluster $CLUSTER ..."
TASK_ARN="$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$TASK_DEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$API_SG],assignPublicIp=ENABLED}" \
  --overrides '{"containerOverrides":[{"name":"api","command":["node","dist/migrate.js"]}]}' \
  --started-by migrate \
  --query 'tasks[0].taskArn' --output text)"

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
  echo "ERROR: ECS did not start the task. Run the same command without --query to see 'failures'." >&2
  exit 1
fi
TASK_ID="${TASK_ARN##*/}"
echo "Task $TASK_ID started. Waiting for it to stop (usually under 2 minutes) ..."

# 7. WHAT: wait until the task has stopped. The AWS CLI checks every 6 seconds, for up to 10 minutes.
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"

# 8. WHAT: read how the container ended: its exit code, and ECS's reason for stopping the task.
#    WHY: exit code 0 = migrations applied. No exit code at all = the container never ran
#    (for example, the image could not be pulled or a secret could not be read); the
#    stoppedReason then says why.
EXIT_CODE="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
STOPPED_REASON="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].stoppedReason' --output text)"

# 9. WHAT: print the last 20 log lines of this task.
#    WHY: the awslogs stream name is <prefix>/<container>/<task id> (see task.ts), so we can
#    find exactly this run's output. If the container never started, there is no stream.
echo
echo "Last log lines (stream api/api/$TASK_ID):"
aws logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "api/api/$TASK_ID" \
  --limit 20 --query 'events[].[message]' --output text \
  || echo "  (no logs: the container probably never started)"

echo
echo "Stopped reason: $STOPPED_REASON"
echo "Exit code:      $EXIT_CODE"

# 10. WHAT: exit with the container's exit code (1 if there was none).
#     WHY: so `pnpm infra:migrate` itself fails when the migration failed.
if [ "$EXIT_CODE" = "0" ]; then
  echo "Migrations applied."
  exit 0
fi
echo "ERROR: migration failed. Read the log lines above." >&2
exit 1
