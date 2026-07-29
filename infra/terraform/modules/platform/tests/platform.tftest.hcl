mock_provider "google" {}

variables {
  project_id         = "nook-test-dev"
  environment        = "dev"
  region             = "asia-east1"
  github_repository  = "onitaiji4real/nook"
  media_cors_origins = ["https://app.example.test"]
}

run "foundation_without_runtime" {
  command = plan

  assert {
    condition     = length(google_cloud_run_v2_service.application) == 0
    error_message = "deploy_runtime=false must not create Cloud Run services."
  }

  assert {
    condition     = length(google_cloud_scheduler_job.notification_dispatcher) == 0
    error_message = "The notification dispatcher must remain absent by default."
  }

  assert {
    condition     = google_cloud_tasks_queue.notifications.retry_config[0].max_attempts == 100 && google_cloud_tasks_queue.notifications.retry_config[0].max_retry_duration == "86400s"
    error_message = "The dedicated notification queue must preserve the 100-attempt, 24-hour retry contract."
  }

  assert {
    condition     = contains(keys(google_secret_manager_secret.runtime), "line-messaging-channel-secret") && contains(keys(google_secret_manager_secret.runtime), "line-messaging-channel-access-token")
    error_message = "Terraform must create LINE secret containers without creating secret versions."
  }

  assert {
    condition     = toset(keys(google_secret_manager_secret_iam_member.runtime_access)) == toset(["api_database", "worker_database"])
    error_message = "Disabled notifications must not grant runtime access to LINE secrets."
  }

  assert {
    condition     = length(google_service_account_iam_member.runtime_automation_service_account_user) == 0 && length(google_cloud_tasks_queue_iam_member.media_enqueuer) == 0 && length(google_cloud_tasks_queue_iam_member.notification_enqueuer) == 0
    error_message = "Disabled task producers must not retain actAs or queue enqueue permissions."
  }

  assert {
    condition     = google_storage_bucket.media.public_access_prevention == "enforced"
    error_message = "The media bucket must enforce public access prevention."
  }

  assert {
    condition     = contains(google_storage_bucket.media.cors[0].method, "POST")
    error_message = "Signed POST uploads require an explicit bucket CORS POST method."
  }

  assert {
    condition     = google_sql_database_instance.postgres.settings[0].ip_configuration[0].ssl_mode == "ENCRYPTED_ONLY"
    error_message = "Cloud SQL must reject unencrypted database connections."
  }

  assert {
    condition     = google_iam_workload_identity_pool_provider.github.attribute_condition == "assertion.repository == 'onitaiji4real/nook' && assertion.environment == 'dev'"
    error_message = "GitHub WIF must be restricted by repository and environment."
  }

  assert {
    condition     = length(google_billing_budget.project) == 0
    error_message = "A Cloud Billing budget must not be created without owner-approved inputs."
  }

}

run "rejects_invalid_project_budget" {
  command = plan

  variables {
    project_budget = {
      billing_account_id   = "not-a-billing-account"
      currency_code        = "twd"
      monthly_amount_units = 0
    }
  }

  expect_failures = [var.project_budget]
}

run "creates_owner_approved_project_budget" {
  command = plan

  variables {
    monitoring_notification_channels = ["projects/nook-test-dev/notificationChannels/123456"]
    project_budget = {
      billing_account_id    = "ABCDEF-123456-7890AB"
      currency_code         = "TWD"
      monthly_amount_units  = 10000
      threshold_percentages = [0.5, 0.8, 1.0]
    }
  }

  override_data {
    target = data.google_project.current
    values = {
      number = "123456789012"
    }
  }

  assert {
    condition     = length(google_billing_budget.project) == 1
    error_message = "Owner-approved inputs must create exactly one project-scoped budget."
  }

  assert {
    condition     = google_billing_budget.project[0].budget_filter[0].projects == toset(["projects/123456789012"])
    error_message = "The budget must include only the current environment project."
  }

  assert {
    condition     = google_billing_budget.project[0].amount[0].specified_amount[0].currency_code == "TWD" && google_billing_budget.project[0].amount[0].specified_amount[0].units == "10000"
    error_message = "The budget must preserve the owner-approved currency and whole-unit monthly amount."
  }

  assert {
    condition     = [for rule in google_billing_budget.project[0].threshold_rules : rule.threshold_percent] == [0.5, 0.8, 1.0]
    error_message = "The budget must preserve all approved current-spend thresholds."
  }

  assert {
    condition     = google_billing_budget.project[0].all_updates_rule[0].disable_default_iam_recipients == false
    error_message = "Budget alerts must keep billing IAM recipients enabled."
  }

  assert {
    condition     = toset(google_billing_budget.project[0].all_updates_rule[0].monitoring_notification_channels) == toset(["projects/nook-test-dev/notificationChannels/123456"])
    error_message = "Budget alerts must include approved Monitoring channels."
  }
}

run "rejects_mutable_or_incomplete_runtime_images" {
  command = plan

  variables {
    deploy_runtime  = true
    line_channel_id = "1234567890"
    container_images = {
      web = "asia-east1-docker.pkg.dev/nook-test-dev/nook-applications/web:latest"
    }
  }

  expect_failures = [var.container_images]
}

run "rejects_media_pipeline_without_runtime" {
  command = plan

  variables {
    enable_media_pipeline = true
    media_worker_url      = "https://worker.example.test"
  }

  expect_failures = [var.enable_media_pipeline]
}

run "runtime_uses_private_worker_and_immutable_images" {
  command = plan

  variables {
    deploy_runtime           = true
    line_channel_id          = "1234567890"
    api_cors_allowed_origins = ["http://localhost:3000"]
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
    condition     = length(google_cloud_scheduler_job.notification_dispatcher) == 0
    error_message = "Runtime provisioning must not implicitly enable an unimplemented dispatcher."
  }

  assert {
    condition = alltrue([
      for service in ["api", "worker"] : anytrue([
        for item in google_cloud_run_v2_service.application[service].template[0].containers[0].env :
        item.name == "CRM_PROJECTION_MODE" && try(item.value, null) == "disabled"
      ])
    ])
    error_message = "CRM projection must remain disabled for every deployed service by default."
  }

  assert {
    condition = anytrue([
      for item in google_cloud_run_v2_service.application["api"].template[0].containers[0].env :
      item.name == "CRM_TAGS_MODE" && try(item.value, null) == "disabled"
    ])
    error_message = "Customer tags must remain disabled until the taxonomy activation gate is approved."
  }

  assert {
    condition = anytrue([
      for item in google_cloud_run_v2_service.application["api"].template[0].containers[0].env :
      item.name == "CRM_NOTES_MODE" && try(item.value, null) == "disabled"
    ])
    error_message = "Customer notes must remain disabled until the KMS activation gate is approved."
  }

  assert {
    condition = anytrue([
      for item in google_cloud_run_v2_service.application["web"].template[0].containers[0].env :
      item.name == "WEB_CRM_NOTES_WRITES_ENABLED" && try(item.value, null) == "false"
    ])
    error_message = "Customer note browser writes must remain disabled until the KMS activation gate is approved."
  }

  assert {
    condition = anytrue([
      for item in google_cloud_run_v2_service.application["api"].template[0].containers[0].env :
      item.name == "MARKETING_CONSENT_GRANT_ENABLED" && try(item.value, null) == "false"
    ])
    error_message = "Marketing consent grant must remain disabled until the legal activation gate is approved."
  }

  assert {
    condition     = alltrue([for image in values(var.container_images) : can(regex("@sha256:[0-9a-f]{64}$", image))])
    error_message = "All runtime images must be pinned by digest."
  }

  assert {
    condition     = google_monitoring_alert_policy.cloud_run_5xx.combiner == "AND_WITH_MATCHING_RESOURCE"
    error_message = "5xx ratio and traffic floor must match the same Cloud Run service."
  }

  assert {
    condition = anytrue([
      for condition in google_monitoring_alert_policy.cloud_run_5xx.conditions :
      try(
        condition.condition_threshold[0].threshold_value == 0.02 &&
        strcontains(condition.condition_threshold[0].filter, "metric.label.response_code_class=\"5xx\"") &&
        strcontains(condition.condition_threshold[0].denominator_filter, "run.googleapis.com/request_count") &&
        toset(condition.condition_threshold[0].aggregations[0].group_by_fields) == toset(condition.condition_threshold[0].denominator_aggregations[0].group_by_fields),
        false
      )
    ])
    error_message = "Cloud Run alert must use a 2% 5xx/request ratio."
  }

  assert {
    condition = anytrue([
      for condition in google_monitoring_alert_policy.cloud_run_5xx.conditions :
      try(
        condition.condition_threshold[0].threshold_value == 1 / 60 &&
        condition.condition_threshold[0].duration == "300s" &&
        !strcontains(condition.condition_threshold[0].filter, "response_code_class"),
        false
      )
    ])
    error_message = "Cloud Run ratio paging must require sustained traffic above 1 request/minute."
  }

  assert {
    condition     = length(google_cloud_run_v2_job.migration[0].template[0].template[0].containers[0].command) == 1 && one(google_cloud_run_v2_job.migration[0].template[0].template[0].containers[0].command) == "/nodejs/bin/node" && contains(google_cloud_run_v2_job.migration[0].template[0].template[0].containers[0].args, "migrate")
    error_message = "Migration must run as an explicit Cloud Run Job, never application startup."
  }

  assert {
    condition = alltrue([
      for service, path in {
        web    = "/api/readiness"
        api    = "/ready"
        worker = "/ready"
      } : google_cloud_run_v2_service.application[service].template[0].containers[0].startup_probe[0].http_get[0].path == path
    ])
    error_message = "Every Cloud Run startup probe must exercise application readiness."
  }

  assert {
    condition = anytrue([
      for item in google_cloud_run_v2_service.application["api"].template[0].containers[0].env :
      item.name == "API_CORS_ALLOWED_ORIGINS" && item.value == "http://localhost:3000"
    ])
    error_message = "The API service must receive the explicit CORS origin allowlist."
  }

  assert {
    condition = alltrue([
      for name, value in {
        AUTH_LINE_EXCHANGE_GLOBAL_LIMIT    = "120"
        AUTH_LINE_EXCHANGE_TOKEN_LIMIT     = "5"
        AUTH_LINE_EXCHANGE_WINDOW_SECONDS  = "60"
        AUTH_RATE_LIMIT_BUCKET_TTL_SECONDS = "600"
        } : anytrue([
          for item in google_cloud_run_v2_service.application["api"].template[0].containers[0].env :
          item.name == name && item.value == value
      ])
    ])
    error_message = "The API service must receive bounded cross-instance LINE exchange limits."
  }
}

run "explicitly_enables_controlled_media_pipeline" {
  command = plan

  variables {
    deploy_runtime        = true
    enable_media_pipeline = true
    media_worker_url      = "https://worker.example.test"
    line_channel_id       = "1234567890"
    container_images = {
      web    = "asia-east1-docker.pkg.dev/nook-test-dev/nook-applications/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      api    = "asia-east1-docker.pkg.dev/nook-test-dev/nook-applications/api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      worker = "asia-east1-docker.pkg.dev/nook-test-dev/nook-applications/worker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }
  }

  assert {
    condition = {
      for env in google_cloud_run_v2_service.application["api"].template[0].containers[0].env : env.name => try(env.value, null)
    }["MEDIA_STORAGE_MODE"] == "gcp"
    error_message = "The media pipeline must remain disabled until it is explicitly enabled."
  }

  assert {
    condition = {
      for env in google_cloud_run_v2_service.application["worker"].template[0].containers[0].env : env.name => try(env.value, null)
    }["MEDIA_WORKER_URL"] == "https://worker.example.test"
    error_message = "API and worker must share the approved worker URL and OIDC audience."
  }

  assert {
    condition     = toset(keys(google_service_account_iam_member.runtime_automation_service_account_user)) == toset(["api"]) && length(google_cloud_tasks_queue_iam_member.media_enqueuer) == 1 && length(google_cloud_tasks_queue_iam_member.notification_enqueuer) == 0
    error_message = "The media pipeline must grant only the API actAs and default-queue enqueue permissions."
  }

  assert {
    condition     = google_cloud_tasks_queue_iam_member.media_enqueuer[0].name == google_cloud_tasks_queue.default.name && google_cloud_tasks_queue_iam_member.media_enqueuer[0].role == "roles/cloudtasks.enqueuer"
    error_message = "The media enqueue permission must be scoped to the default queue."
  }
}

run "rejects_unsafe_cors_origins" {
  command = plan

  variables {
    api_cors_allowed_origins = ["https://app.nook.example/path"]
  }

  expect_failures = [var.api_cors_allowed_origins]
}

run "requires_https_cors_origins_in_production" {
  command = plan

  variables {
    environment              = "prod"
    api_cors_allowed_origins = ["http://app.nook.example"]
  }

  expect_failures = [var.api_cors_allowed_origins]
}

run "rejects_unsafe_line_auth_rate_limit" {
  command = plan

  variables {
    line_auth_rate_limit = {
      global_limit       = 120
      token_limit        = 5
      window_seconds     = 120
      bucket_ttl_seconds = 60
    }
  }

  expect_failures = [var.line_auth_rate_limit]
}

run "rejects_dispatcher_without_runtime" {
  command = plan

  variables {
    enable_notification_dispatcher = true
  }

  expect_failures = [var.enable_notification_dispatcher]
}

run "explicitly_enables_notification_dispatcher" {
  command = plan

  variables {
    deploy_runtime                 = true
    enable_line_notifications      = true
    enable_notification_dispatcher = true
    notification_worker_url        = "https://worker.example.test"
    public_web_base_url            = "https://app.example.test"
    line_messaging_monthly_cap     = 1000
    line_channel_id                = "1234567890"
    container_images = {
      web    = "asia-east1-docker.pkg.dev/nook-test-dev/nook-applications/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      api    = "asia-east1-docker.pkg.dev/nook-test-dev/nook-applications/api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      worker = "asia-east1-docker.pkg.dev/nook-test-dev/nook-applications/worker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }
  }

  assert {
    condition     = length(google_cloud_scheduler_job.notification_dispatcher) == 1
    error_message = "The dispatcher must be created only after explicit activation."
  }

  assert {
    condition     = google_cloud_scheduler_job.notification_dispatcher[0].http_target[0].http_method == "POST"
    error_message = "The dispatcher must call the worker with POST."
  }

  assert {
    condition     = google_cloud_scheduler_job.notification_dispatcher[0].http_target[0].headers["x-cloudscheduler"] == "true"
    error_message = "The Scheduler request must carry the exact defense-in-depth header."
  }

  assert {
    condition = alltrue([
      for name, value in {
        NOTIFICATION_MODE          = "line_push"
        NOTIFICATION_TASK_QUEUE    = google_cloud_tasks_queue.notifications.name
        NOTIFICATION_WORKER_URL    = "https://worker.example.test"
        PUBLIC_WEB_BASE_URL        = "https://app.example.test"
        LINE_MESSAGING_MONTHLY_CAP = "1000"
        } : anytrue([
          for item in google_cloud_run_v2_service.application["worker"].template[0].containers[0].env :
          item.name == name && try(item.value, null) == value
      ])
    ])
    error_message = "The worker must receive the dedicated queue and approved notification runtime settings."
  }

  assert {
    condition     = contains(keys(google_secret_manager_secret_iam_member.runtime_access), "api_line_webhook") && contains(keys(google_secret_manager_secret_iam_member.runtime_access), "worker_line_push")
    error_message = "Explicit notification activation must grant each service only its required LINE secret."
  }

  assert {
    condition     = google_secret_manager_secret_iam_member.runtime_access["api_line_webhook"].role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.runtime_access["worker_line_push"].role == "roles/secretmanager.secretAccessor"
    error_message = "The service-specific LINE bindings must grant only secret accessor."
  }

  assert {
    condition     = toset(keys(google_service_account_iam_member.runtime_automation_service_account_user)) == toset(["worker"]) && length(google_cloud_tasks_queue_iam_member.notification_enqueuer) == 1 && length(google_cloud_tasks_queue_iam_member.media_enqueuer) == 0
    error_message = "Notifications must grant only the worker actAs and notification-queue enqueue permissions."
  }

  assert {
    condition     = google_cloud_tasks_queue_iam_member.notification_enqueuer[0].name == google_cloud_tasks_queue.notifications.name && google_cloud_tasks_queue_iam_member.notification_enqueuer[0].role == "roles/cloudtasks.enqueuer"
    error_message = "The notification enqueue permission must be scoped to the dedicated queue."
  }
}
