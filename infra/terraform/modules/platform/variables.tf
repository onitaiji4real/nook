variable "project_id" {
  description = "Dedicated GCP project ID for this environment."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid GCP project ID."
  }
}

variable "environment" {
  description = "Deployment environment."
  type        = string

  validation {
    condition     = contains(["dev", "stg", "prod"], var.environment)
    error_message = "environment must be dev, stg, or prod."
  }
}

variable "region" {
  description = "Phase 1 GCP region."
  type        = string
  default     = "asia-east1"

  validation {
    condition     = var.region == "asia-east1"
    error_message = "Phase 1 resources must stay in asia-east1."
  }
}

variable "github_repository" {
  description = "GitHub owner/repository allowed to use this environment's WIF provider."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must use owner/repository format."
  }
}

variable "deploy_runtime" {
  description = "Create Cloud Run services after deployable images exist."
  type        = bool
  default     = false
}

variable "enable_notification_dispatcher" {
  description = "Create the notification Scheduler job only after its authenticated, idempotent worker endpoint is deployed."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_notification_dispatcher || (var.deploy_runtime && var.enable_line_notifications)
    error_message = "enable_notification_dispatcher requires deploy_runtime=true and enable_line_notifications=true."
  }
}

variable "enable_line_notifications" {
  description = "Enable LINE webhook and push runtime configuration after secrets and provider ownership are ready."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_line_notifications || var.deploy_runtime
    error_message = "enable_line_notifications requires deploy_runtime=true."
  }
}

variable "notification_worker_url" {
  description = "Existing private worker Cloud Run HTTPS origin used by the dedicated notification queue."
  type        = string
  default     = ""

  validation {
    condition = !var.enable_line_notifications || can(
      regex("^https://[A-Za-z0-9.-]+$", var.notification_worker_url)
    )
    error_message = "notification_worker_url must be an HTTPS origin when LINE notifications are enabled."
  }
}

variable "public_web_base_url" {
  description = "Public HTTPS Web origin used for the fixed authenticated appointment deep link."
  type        = string
  default     = ""

  validation {
    condition = !var.enable_line_notifications || can(
      regex("^https://[A-Za-z0-9.-]+$", var.public_web_base_url)
    )
    error_message = "public_web_base_url must be an HTTPS origin when LINE notifications are enabled."
  }
}

variable "line_messaging_monthly_cap" {
  description = "Owner-approved platform LINE OA monthly hard reservation cap."
  type        = number
  default     = 0

  validation {
    condition = !var.enable_line_notifications || (
      var.line_messaging_monthly_cap >= 1 &&
      var.line_messaging_monthly_cap <= 1000000 &&
      floor(var.line_messaging_monthly_cap) == var.line_messaging_monthly_cap
    )
    error_message = "line_messaging_monthly_cap must be an integer from 1 to 1000000 when enabled."
  }
}

variable "line_channel_id" {
  description = "LINE Login channel ID. This is an audience identifier, not a secret."
  type        = string
  default     = ""

  validation {
    condition     = !var.deploy_runtime || length(trimspace(var.line_channel_id)) > 0
    error_message = "line_channel_id is required when deploy_runtime is true."
  }
}

variable "api_cors_allowed_origins" {
  description = "Exact browser origins allowed to call the API. Empty keeps cross-origin browser access disabled."
  type        = list(string)
  default     = []

  validation {
    condition = (
      length(distinct(var.api_cors_allowed_origins)) == length(var.api_cors_allowed_origins) &&
      alltrue([
        for origin in var.api_cors_allowed_origins :
        can(regex("^https?://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$", origin)) &&
        origin != "http://*" &&
        origin != "https://*"
      ]) &&
      (var.environment != "prod" || alltrue([
        for origin in var.api_cors_allowed_origins : startswith(origin, "https://")
      ]))
    )
    error_message = "api_cors_allowed_origins must contain unique exact HTTP(S) origins without paths or wildcards; production origins must use HTTPS."
  }
}

variable "line_auth_rate_limit" {
  description = "Cross-instance PostgreSQL rate-limit settings for LINE token exchange."
  type = object({
    global_limit       = number
    token_limit        = number
    window_seconds     = number
    bucket_ttl_seconds = number
  })
  default = {
    global_limit       = 120
    token_limit        = 5
    window_seconds     = 60
    bucket_ttl_seconds = 600
  }

  validation {
    condition = (
      var.line_auth_rate_limit.global_limit >= 1 &&
      var.line_auth_rate_limit.global_limit <= 10000 &&
      var.line_auth_rate_limit.token_limit >= 1 &&
      var.line_auth_rate_limit.token_limit <= 100 &&
      var.line_auth_rate_limit.window_seconds >= 10 &&
      var.line_auth_rate_limit.window_seconds <= 3600 &&
      var.line_auth_rate_limit.bucket_ttl_seconds >= var.line_auth_rate_limit.window_seconds &&
      var.line_auth_rate_limit.bucket_ttl_seconds <= 86400
    )
    error_message = "line_auth_rate_limit values must stay within application bounds and bucket TTL must cover the window."
  }
}

variable "container_images" {
  description = "Immutable image references keyed by web, api, and worker."
  type        = map(string)
  default     = {}

  validation {
    condition = !var.deploy_runtime || (
      length(setsubtract(toset(keys(var.container_images)), toset(["web", "api", "worker"]))) == 0 &&
      length(setsubtract(toset(["web", "api", "worker"]), toset(keys(var.container_images)))) == 0 &&
      alltrue([for image in values(var.container_images) : can(regex("@sha256:[0-9a-f]{64}$", image))])
    )
    error_message = "When deploy_runtime is true, container_images must contain only web, api, and worker image references pinned by sha256 digest."
  }
}

variable "database_tier" {
  type    = string
  default = "db-custom-1-3840"
}

variable "database_availability_type" {
  type    = string
  default = "ZONAL"
}

variable "database_deletion_protection" {
  type    = bool
  default = true
}

variable "media_soft_delete_seconds" {
  type    = number
  default = 604800
}

variable "media_cors_origins" {
  description = "Explicit browser origins allowed to use signed upload URLs."
  type        = list(string)
  default     = []
}

variable "enable_media_pipeline" {
  description = "Enable GCS signed upload and Cloud Tasks verification only after the worker HTTPS URL is known."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_media_pipeline || var.deploy_runtime
    error_message = "enable_media_pipeline requires deploy_runtime=true."
  }
}

variable "media_worker_url" {
  description = "Existing private worker Cloud Run HTTPS URL used as the task target and OIDC audience."
  type        = string
  default     = ""

  validation {
    condition = !var.enable_media_pipeline || can(
      regex("^https://[A-Za-z0-9.-]+(?:/[A-Za-z0-9._~!$&'()*+,;=:@%-]*)?$", var.media_worker_url)
    )
    error_message = "media_worker_url must be an HTTPS URL when enable_media_pipeline=true."
  }
}

variable "monitoring_notification_channels" {
  description = "Existing Monitoring notification channel resource names. Values are identifiers, not channel secrets."
  type        = list(string)
  default     = []

  validation {
    condition = (
      length(var.monitoring_notification_channels) <= 5 &&
      length(distinct(var.monitoring_notification_channels)) == length(var.monitoring_notification_channels) &&
      alltrue([
        for channel in var.monitoring_notification_channels :
        can(regex("^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/notificationChannels/[0-9]+$", channel))
      ])
    )
    error_message = "monitoring_notification_channels must contain at most five unique full Monitoring channel resource names."
  }
}

variable "project_budget" {
  description = "Optional owner-approved monthly Cloud Billing budget for this project. Null creates no budget."
  type = object({
    billing_account_id    = string
    currency_code         = string
    monthly_amount_units  = number
    threshold_percentages = optional(list(number), [0.5, 0.8, 1.0])
  })
  default = null

  validation {
    condition = var.project_budget == null || try(
      can(regex("^[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}$", var.project_budget.billing_account_id)) &&
      can(regex("^[A-Z]{3}$", var.project_budget.currency_code)) &&
      var.project_budget.monthly_amount_units > 0 &&
      floor(var.project_budget.monthly_amount_units) == var.project_budget.monthly_amount_units &&
      length(var.project_budget.threshold_percentages) > 0 &&
      length(distinct(var.project_budget.threshold_percentages)) == length(var.project_budget.threshold_percentages) &&
      alltrue([for threshold in var.project_budget.threshold_percentages : threshold > 0]),
      false
    )
    error_message = "project_budget must use a valid billing account ID, ISO 4217-style uppercase currency, positive whole-unit monthly amount, and unique positive thresholds."
  }
}

variable "alert_runbook_url" {
  description = "Runbook URL attached to the Cloud Run 5xx alert."
  type        = string
  default     = "https://github.com/onitaiji4real/nook/blob/main/docs/runbooks/deployment.md"

  validation {
    condition     = startswith(var.alert_runbook_url, "https://")
    error_message = "alert_runbook_url must be HTTPS."
  }
}
