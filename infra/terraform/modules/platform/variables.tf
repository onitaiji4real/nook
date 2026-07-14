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

variable "line_channel_id" {
  description = "LINE Login channel ID. This is an audience identifier, not a secret."
  type        = string
  default     = ""

  validation {
    condition     = !var.deploy_runtime || length(trimspace(var.line_channel_id)) > 0
    error_message = "line_channel_id is required when deploy_runtime is true."
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

variable "monitoring_notification_channels" {
  description = "Existing Monitoring notification channel resource names. Values are identifiers, not channel secrets."
  type        = list(string)
  default     = []
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
