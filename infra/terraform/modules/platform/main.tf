locals {
  name = "nook-${var.environment}"
  required_services = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "identitytoolkit.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
    "cloudtasks.googleapis.com",
    "cloudscheduler.googleapis.com"
  ])
  runtime_services = toset(["web", "api", "worker"])
  health_paths = {
    web    = "/api/health"
    api    = "/health"
    worker = "/health"
  }
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "applications" {
  project       = var.project_id
  location      = var.region
  repository_id = "nook-applications"
  format        = "DOCKER"
  description   = "Immutable application images for Nook"

  depends_on = [google_project_service.required]
}

resource "google_compute_network" "platform" {
  project                 = var.project_id
  name                    = "${local.name}-network"
  auto_create_subnetworks = false

  depends_on = [google_project_service.required]
}

resource "google_compute_subnetwork" "serverless" {
  project                  = var.project_id
  name                     = "${local.name}-serverless"
  region                   = var.region
  network                  = google_compute_network.platform.id
  ip_cidr_range            = "10.20.0.0/24"
  private_ip_google_access = true
}

resource "google_compute_global_address" "service_range" {
  project       = var.project_id
  name          = "${local.name}-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.platform.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.platform.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.service_range.name]

  depends_on = [google_project_service.required]
}

resource "google_sql_database_instance" "postgres" {
  project          = var.project_id
  name             = "${local.name}-postgres"
  region           = var.region
  database_version = "POSTGRES_16"

  deletion_protection = var.database_deletion_protection

  settings {
    tier              = var.database_tier
    availability_type = var.database_availability_type
    disk_type         = "PD_SSD"
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "18:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.platform.id
      enable_private_path_for_google_cloud_services = true
      ssl_mode                                      = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day          = 7
      hour         = 19
      update_track = "stable"
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "application" {
  project  = var.project_id
  name     = "nook"
  instance = google_sql_database_instance.postgres.name
}

resource "google_storage_bucket" "media" {
  project                     = var.project_id
  name                        = "${var.project_id}-nook-media"
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  soft_delete_policy {
    retention_duration_seconds = var.media_soft_delete_seconds
  }

  dynamic "cors" {
    for_each = length(var.media_cors_origins) > 0 ? [1] : []
    content {
      origin          = var.media_cors_origins
      method          = ["GET", "HEAD", "PUT"]
      response_header = ["Content-Type", "ETag"]
      max_age_seconds = 3600
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_cloud_tasks_queue" "default" {
  project  = var.project_id
  name     = "${local.name}-default"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 20
    max_dispatches_per_second = 10
  }

  retry_config {
    max_attempts       = 10
    max_retry_duration = "3600s"
    min_backoff        = "5s"
    max_backoff        = "300s"
    max_doublings      = 5
  }

  depends_on = [google_project_service.required]
}

resource "google_identity_platform_config" "default" {
  project = var.project_id

  sign_in {
    email {
      enabled           = false
      password_required = false
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "runtime" {
  for_each = toset(["database-url", "line-channel-secret"])

  project   = var.project_id
  secret_id = "nook-${each.value}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "runtime" {
  for_each = local.runtime_services

  project      = var.project_id
  account_id   = "nook-${each.key}-${var.environment}"
  display_name = "Nook ${each.key} runtime (${var.environment})"
}

resource "google_service_account" "automation_invoker" {
  project      = var.project_id
  account_id   = "nook-automation-${var.environment}"
  display_name = "Nook Tasks and Scheduler invoker (${var.environment})"
}

resource "google_service_account" "github_deployer" {
  project      = var.project_id
  account_id   = "nook-deploy-${var.environment}"
  display_name = "Nook GitHub deployer (${var.environment})"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "nook-github-${var.environment}"
  display_name              = "Nook GitHub ${var.environment}"
  description               = "Keyless GitHub Actions identities for ${var.github_repository}"

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub Actions"
  description                        = "Restricted to ${var.github_repository} and the ${var.environment} GitHub Environment"

  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.actor"            = "assertion.actor"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
    "attribute.ref"              = "assertion.ref"
  }

  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.environment == '${var.environment}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_workload_identity_user" {
  service_account_id = google_service_account.github_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

resource "google_project_iam_member" "github_deployer_roles" {
  for_each = toset([
    "roles/artifactregistry.writer",
    "roles/run.admin",
    "roles/serviceusage.serviceUsageConsumer"
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_service_account_iam_member" "github_runtime_service_account_user" {
  for_each = local.runtime_services

  service_account_id = google_service_account.runtime[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_project_iam_member" "cloud_sql_client" {
  for_each = toset(["api", "worker"])

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_project_iam_member" "cloud_sql_instance_user" {
  for_each = toset(["api", "worker"])

  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each = {
    api_database    = { service = "api", secret = "database-url" }
    api_line        = { service = "api", secret = "line-channel-secret" }
    worker_database = { service = "worker", secret = "database-url" }
  }

  project   = var.project_id
  secret_id = google_secret_manager_secret.runtime[each.value.secret].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.service].email}"
}

resource "google_storage_bucket_iam_member" "media_object_admin" {
  for_each = toset(["api", "worker"])

  bucket = google_storage_bucket.media.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_project_iam_member" "task_enqueuer" {
  for_each = toset(["api", "worker"])

  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_cloud_run_v2_service" "application" {
  for_each = var.deploy_runtime ? local.runtime_services : toset([])

  project  = var.project_id
  name     = "${local.name}-${each.key}"
  location = var.region
  ingress  = each.key == "worker" ? "INGRESS_TRAFFIC_INTERNAL_ONLY" : "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime[each.key].email
    timeout         = each.key == "worker" ? "300s" : "60s"

    scaling {
      min_instance_count = 0
      max_instance_count = each.key == "web" ? 10 : 5
    }

    vpc_access {
      network_interfaces {
        network    = google_compute_network.platform.name
        subnetwork = google_compute_subnetwork.serverless.name
      }
      egress = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.container_images[each.key]

      ports {
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = var.environment == "prod" ? "production" : var.environment
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_REGION"
        value = var.region
      }

      dynamic "env" {
        for_each = contains(["api", "worker"], each.key) ? [1] : []
        content {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime["database-url"].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = each.key == "api" ? [1] : []
        content {
          name = "LINE_CHANNEL_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime["line-channel-secret"].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 1
        period_seconds        = 3
        failure_threshold     = 20

        tcp_socket {
          port = 8080
        }
      }

      liveness_probe {
        initial_delay_seconds = 5
        timeout_seconds       = 2
        period_seconds        = 10
        failure_threshold     = 3

        http_get {
          path = local.health_paths[each.key]
          port = 8080
        }
      }
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = var.deploy_runtime ? toset(["web", "api"]) : toset([])

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.application[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "worker_automation" {
  count = var.deploy_runtime ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.application["worker"].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.automation_invoker.email}"
}

resource "google_cloud_scheduler_job" "notification_dispatcher" {
  count = var.deploy_runtime ? 1 : 0

  project          = var.project_id
  region           = var.region
  name             = "${local.name}-notification-dispatcher"
  description      = "Dispatch due notification jobs to Cloud Tasks"
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "60s"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "5s"
    max_backoff_duration = "60s"
    max_doublings        = 3
  }

  http_target {
    uri         = "${google_cloud_run_v2_service.application["worker"].uri}/internal/notifications/dispatch"
    http_method = "POST"

    oidc_token {
      service_account_email = google_service_account.automation_invoker.email
      audience              = google_cloud_run_v2_service.application["worker"].uri
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.worker_automation]
}

resource "google_monitoring_alert_policy" "cloud_run_5xx" {
  project      = var.project_id
  display_name = "Nook ${var.environment} Cloud Run 5xx"
  combiner     = "OR"
  severity     = "ERROR"
  enabled      = true

  notification_channels = var.monitoring_notification_channels

  documentation {
    content   = "Cloud Run returned 5xx responses. Owner: platform-oncall. Runbook: ${var.alert_runbook_url}"
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Cloud Run 5xx rate"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type=\"cloud_run_revision\"",
        "metric.type=\"run.googleapis.com/request_count\"",
        "metric.label.response_code_class=\"5xx\""
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 0.05
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  user_labels = {
    application = "nook"
    environment = var.environment
    owner       = "platform-oncall"
  }

  depends_on = [google_project_service.required]
}
