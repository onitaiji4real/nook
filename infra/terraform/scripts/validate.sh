#!/usr/bin/env bash
set -euo pipefail

terraform_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

terraform fmt -check -recursive "$terraform_root"

for directory in \
  "$terraform_root/bootstrap" \
  "$terraform_root/modules/platform" \
  "$terraform_root/environments/dev" \
  "$terraform_root/environments/stg" \
  "$terraform_root/environments/prod"; do
  terraform -chdir="$directory" init -backend=false -input=false -lockfile=readonly
  terraform -chdir="$directory" validate
done

terraform -chdir="$terraform_root/modules/platform" test
node --test "$terraform_root/scripts/check-release-contract.test.mjs"
node "$terraform_root/scripts/check-release-contract.mjs"
node "$terraform_root/scripts/check-isolation.mjs"
