#!/usr/bin/env bash
set -euo pipefail

: "${ENVIRONMENT:?ENVIRONMENT is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:?REGION is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${WEB_IMAGE:?WEB_IMAGE is required}"
: "${API_IMAGE:?API_IMAGE is required}"
: "${WORKER_IMAGE:?WORKER_IMAGE is required}"

tag="candidate-${GITHUB_SHA:0:12}"
services=(web api worker)
declare -A previous_revisions

for service in "${services[@]}"; do
  name="nook-${ENVIRONMENT}-${service}"
  previous_revisions["$service"]="$(gcloud run services describe "$name" \
    --project "$PROJECT_ID" --region "$REGION" \
    --format='value(status.traffic[0].revisionName)')"
done

rollback() {
  for service in "${services[@]}"; do
    revision="${previous_revisions[$service]}"
    if [[ -n "$revision" ]]; then
      gcloud run services update-traffic "nook-${ENVIRONMENT}-${service}" \
        --project "$PROJECT_ID" --region "$REGION" \
        --to-revisions "$revision=100" --quiet || true
    fi
  done
}
trap rollback ERR

for service in "${services[@]}"; do
  image_variable="${service^^}_IMAGE"
  image="${!image_variable}"
  gcloud run services update "nook-${ENVIRONMENT}-${service}" \
    --project "$PROJECT_ID" --region "$REGION" --image "$image" \
    --no-traffic --tag "$tag" --quiet
done

for service in web api; do
  path="/health"
  [[ "$service" == "web" ]] && path="/api/health"
  candidate_url="$(gcloud run services describe "nook-${ENVIRONMENT}-${service}" \
    --project "$PROJECT_ID" --region "$REGION" \
    --format="value(status.traffic[?tag=='$tag'].url)")"
  test -n "$candidate_url"
  curl --fail --silent --show-error --retry 5 --retry-all-errors \
    --max-time 10 "${candidate_url}${path}" >/dev/null
done

worker_ready="$(gcloud run services describe "nook-${ENVIRONMENT}-worker" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format="value(status.conditions[?type=='Ready'].status)")"
test "$worker_ready" = "True"

for service in "${services[@]}"; do
  gcloud run services update-traffic "nook-${ENVIRONMENT}-${service}" \
    --project "$PROJECT_ID" --region "$REGION" --to-tags "$tag=100" --quiet
done

trap - ERR
