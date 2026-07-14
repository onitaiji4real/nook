mock_provider "google" {}

variables {
  project_id        = "nook-test-dev"
  environment       = "dev"
  region            = "asia-east1"
  github_repository = "onitaiji4real/nook"
}

run "foundation_without_runtime" {
  command = plan

  assert {
    condition     = length(google_cloud_run_v2_service.application) == 0
    error_message = "deploy_runtime=false must not create Cloud Run services."
  }

  assert {
    condition     = google_storage_bucket.media.public_access_prevention == "enforced"
    error_message = "The media bucket must enforce public access prevention."
  }

  assert {
    condition     = google_sql_database_instance.postgres.settings[0].ip_configuration[0].ssl_mode == "ENCRYPTED_ONLY"
    error_message = "Cloud SQL must reject unencrypted database connections."
  }

  assert {
    condition     = google_iam_workload_identity_pool_provider.github.attribute_condition == "assertion.repository == 'onitaiji4real/nook' && assertion.environment == 'dev'"
    error_message = "GitHub WIF must be restricted by repository and environment."
  }

}

run "rejects_mutable_or_incomplete_runtime_images" {
  command = plan

  variables {
    deploy_runtime = true
    container_images = {
      web = "asia-east1-docker.pkg.dev/nook-test-dev/nook-applications/web:latest"
    }
  }

  expect_failures = [var.container_images]
}

run "runtime_uses_private_worker_and_immutable_images" {
  command = plan

  variables {
    deploy_runtime = true
    container_images = {
      web    = "asia-east1-docker.pkg.dev/nook-test-dev/nook-applications/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      api    = "asia-east1-docker.pkg.dev/nook-test-dev/nook-applications/api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      worker = "asia-east1-docker.pkg.dev/nook-test-dev/nook-applications/worker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }
  }

  assert {
    condition     = google_cloud_run_v2_service.application["worker"].ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY"
    error_message = "Worker ingress must remain internal only."
  }

  assert {
    condition     = length(google_cloud_run_v2_service_iam_member.public) == 2
    error_message = "Only web and API may receive public invoker bindings."
  }

  assert {
    condition     = alltrue([for image in values(var.container_images) : can(regex("@sha256:[0-9a-f]{64}$", image))])
    error_message = "All runtime images must be pinned by digest."
  }
}
