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
  readiness_paths = {
    web    = "/api/readiness"
    api    = "/ready"
    worker = "/ready"
  }
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

data "google_project" "current" {
  count = var.project_budget == null ? 0 : 1

  project_id = var.project_id
}

resource "google_billing_budget" "project" {
  count = var.project_budget == null ? 0 : 1

  billing_account = var.project_budget.billing_account_id
  display_name    = "Nook ${var.environment} monthly budget"

  budget_filter {
    projects               = ["projects/${data.google_project.current[0].number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = var.project_budget.currency_code
      units         = tostring(var.project_budget.monthly_amount_units)
    }
  }

  dynamic "threshold_rules" {
    for_each = var.project_budget.threshold_percentages
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  all_updates_rule {
    monitoring_notification_channels = var.monitoring_notification_channels
    disable_default_iam_recipients   = false
    enable_project_level_recipients  = false
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
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
      method          = ["GET", "HEAD", "POST"]
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

resource "google_cloud_tasks_queue" "notifications" {
  project  = var.project_id
  name     = "${local.name}-notifications"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 10
    max_dispatches_per_second = 5
  }

  retry_config {
    max_attempts       = 100
    max_retry_duration = "86400s"
    min_backoff        = "5s"
    max_backoff        = "900s"
    max_doublings      = 8
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
  for_each = toset([
    "database-url",
    "line-messaging-channel-secret",
    "line-messaging-channel-access-token"
  ])

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
  for_each = merge(
    {
      api_database    = { service = "api", secret = "database-url" }
      worker_database = { service = "worker", secret = "database-url" }
    },
    var.enable_line_notifications ? {
      api_line_webhook = {
        service = "api"
        secret  = "line-messaging-channel-secret"
      }
      worker_line_push = {
        service = "worker"
        secret  = "line-messaging-channel-access-token"
      }
    } : {}
  )

  project   = var.project_id
  secret_id = google_secret_manager_secret.runtime[each.value.secret].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.service].email}"
}

resource "google_service_account_iam_member" "api_custom_token_signer" {
  service_account_id = google_service_account.runtime["api"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.runtime["api"].email}"
}

resource "google_service_account_iam_member" "runtime_automation_service_account_user" {
  for_each = merge(
    var.enable_media_pipeline ? { api = true } : {},
    var.enable_line_notifications ? { worker = true } : {}
  )

  service_account_id = google_service_account.automation_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_storage_bucket_iam_member" "media_object_admin" {
  for_each = toset(["api", "worker"])

  bucket = google_storage_bucket.media.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_cloud_tasks_queue_iam_member" "media_enqueuer" {
  count = var.enable_media_pipeline ? 1 : 0

  project  = google_cloud_tasks_queue.default.project
  location = google_cloud_tasks_queue.default.location
  name     = google_cloud_tasks_queue.default.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.runtime["api"].email}"
}

resource "google_cloud_tasks_queue_iam_member" "notification_enqueuer" {
  count = var.enable_line_notifications ? 1 : 0

  project  = google_cloud_tasks_queue.notifications.project
  location = google_cloud_tasks_queue.notifications.location
  name     = google_cloud_tasks_queue.notifications.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.runtime["worker"].email}"
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
        for_each = contains(["api", "worker"], each.key) ? {
          MEDIA_STORAGE_MODE                 = var.enable_media_pipeline ? "gcp" : "disabled"
          MEDIA_BUCKET                       = google_storage_bucket.media.name
          MEDIA_TASK_QUEUE                   = google_cloud_tasks_queue.default.name
          MEDIA_WORKER_URL                   = var.enable_media_pipeline ? var.media_worker_url : ""
          MEDIA_TASK_INVOKER_SERVICE_ACCOUNT = google_service_account.automation_invoker.email
        } : {}
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = contains(["api", "worker"], each.key) ? [1] : []
        content {
          name  = "NOTIFICATION_MODE"
          value = var.enable_line_notifications ? "line_push" : "disabled"
        }
      }

      dynamic "env" {
        for_each = contains(["api", "worker"], each.key) ? [1] : []
        content {
          name  = "CRM_PROJECTION_MODE"
          value = "disabled"
        }
      }

      dynamic "env" {
        for_each = each.key == "api" ? [1] : []
        content {
          name  = "CRM_TAGS_MODE"
          value = "disabled"
        }
      }

      dynamic "env" {
        for_each = each.key == "api" ? [1] : []
        content {
          name  = "MARKETING_CONSENT_GRANT_ENABLED"
          value = "false"
        }
      }

      dynamic "env" {
        for_each = each.key == "worker" ? {
          NOTIFICATION_TASK_QUEUE                   = google_cloud_tasks_queue.notifications.name
          NOTIFICATION_WORKER_URL                   = var.enable_line_notifications ? var.notification_worker_url : ""
          NOTIFICATION_TASK_INVOKER_SERVICE_ACCOUNT = google_service_account.automation_invoker.email
          PUBLIC_WEB_BASE_URL                       = var.enable_line_notifications ? var.public_web_base_url : ""
          LINE_MESSAGING_MONTHLY_CAP                = var.enable_line_notifications ? tostring(var.line_messaging_monthly_cap) : ""
        } : {}
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = each.key == "api" ? [1] : []
        content {
          name  = "AUTH_ADAPTER_MODE"
          value = "firebase"
        }
      }

      dynamic "env" {
        for_each = each.key == "api" ? {
          AUTH_LINE_EXCHANGE_GLOBAL_LIMIT    = tostring(var.line_auth_rate_limit.global_limit)
          AUTH_LINE_EXCHANGE_TOKEN_LIMIT     = tostring(var.line_auth_rate_limit.token_limit)
          AUTH_LINE_EXCHANGE_WINDOW_SECONDS  = tostring(var.line_auth_rate_limit.window_seconds)
          AUTH_RATE_LIMIT_BUCKET_TTL_SECONDS = tostring(var.line_auth_rate_limit.bucket_ttl_seconds)
        } : {}
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = each.key == "api" ? [1] : []
        content {
          name  = "API_CORS_ALLOWED_ORIGINS"
          value = join(",", var.api_cors_allowed_origins)
        }
      }

      dynamic "env" {
        for_each = each.key == "api" ? [1] : []
        content {
          name  = "LINE_CHANNEL_ID"
          value = var.line_channel_id
        }
      }

      dynamic "env" {
        for_each = each.key == "api" ? [1] : []
        content {
          name  = "IDENTITY_PLATFORM_PROJECT_ID"
          value = var.project_id
        }
      }

      dynamic "env" {
        for_each = each.key == "api" ? [1] : []
        content {
          name  = "IDENTITY_PLATFORM_SERVICE_ACCOUNT_ID"
          value = google_service_account.runtime["api"].email
        }
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
        for_each = each.key == "api" && var.enable_line_notifications ? [1] : []
        content {
          name = "LINE_MESSAGING_CHANNEL_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime["line-messaging-channel-secret"].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = each.key == "worker" && var.enable_line_notifications ? [1] : []
        content {
          name = "LINE_MESSAGING_CHANNEL_ACCESS_TOKEN"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime["line-messaging-channel-access-token"].secret_id
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

        http_get {
          path = local.readiness_paths[each.key]
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

  # Terraform bootstraps the first revision; CI/CD owns later image revisions.
  # Keep this path narrow so Terraform continues to reconcile runtime config.
  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_job" "migration" {
  count = var.deploy_runtime ? 1 : 0

  project  = var.project_id
  name     = "nook-migrate-${var.environment}"
  location = var.region

  template {
    template {
      service_account = google_service_account.runtime["api"].email
      timeout         = "900s"
      max_retries     = 0

      vpc_access {
        network_interfaces {
          network    = google_compute_network.platform.name
          subnetwork = google_compute_subnetwork.serverless.name
        }
        egress = "PRIVATE_RANGES_ONLY"
      }

      containers {
        image   = var.container_images["api"]
        command = ["/nodejs/bin/node"]
        args = [
          "node_modules/prisma/build/index.js",
          "migrate",
          "deploy",
          "--schema",
          "node_modules/@nook/database/prisma/schema.prisma",
        ]

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime["database-url"].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  # The release workflow updates this image before running each migration.
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image]
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
  count = var.deploy_runtime && var.enable_notification_dispatcher ? 1 : 0

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
    headers = {
      "x-cloudscheduler" = "true"
    }

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
  combiner     = "AND_WITH_MATCHING_RESOURCE"
  severity     = "ERROR"
  enabled      = true

  notification_channels = var.monitoring_notification_channels

  documentation {
    content   = "Cloud Run 5xx ratio exceeded 2% for 5 minutes while traffic stayed above 1 request/minute. Owner: platform-oncall. Runbook: ${var.alert_runbook_url}"
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Cloud Run 5xx ratio above 2%"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type=\"cloud_run_revision\"",
        "metric.type=\"run.googleapis.com/request_count\"",
        "metric.label.response_code_class=\"5xx\""
      ])
      denominator_filter = join(" AND ", [
        "resource.type=\"cloud_run_revision\"",
        "metric.type=\"run.googleapis.com/request_count\""
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 0.02
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }

      denominator_aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }

      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"
    }
  }

  conditions {
    display_name = "Cloud Run traffic above 1 request/minute"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type=\"cloud_run_revision\"",
        "metric.type=\"run.googleapis.com/request_count\""
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 1 / 60
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }

      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"
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

resource "google_monitoring_dashboard" "service_health" {
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "Nook ${var.environment} service health"
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          x      = 0
          y      = 0
          width  = 12
          height = 2
          widget = {
            title = "Owner and response"
            text = {
              format  = "MARKDOWN"
              content = "Owner: platform-oncall | Runbook: ${var.alert_runbook_url}"
            }
          }
        },
        {
          x      = 0
          y      = 2
          width  = 6
          height = 4
          widget = {
            title = "Cloud Run request rate"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_RATE"
                    }
                  }
                }
              }]
              yAxis = { label = "requests/s", scale = "LINEAR" }
            }
          }
        },
        {
          x      = 6
          y      = 2
          width  = 6
          height = 4
          widget = {
            title = "Cloud Run 5xx rate"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.label.\"response_code_class\"=\"5xx\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_RATE"
                    }
                  }
                }
              }]
              yAxis = { label = "5xx/s", scale = "LINEAR" }
            }
          }
        }
      ]
    }
  })

  depends_on = [google_project_service.required]
}
