variable "project_id" { type = string }
variable "region" { type = string }
variable "deploy_runtime" { type = bool }
variable "enable_notification_dispatcher" {
  type    = bool
  default = false
}
variable "enable_line_notifications" {
  type    = bool
  default = false
}
variable "notification_worker_url" {
  type    = string
  default = ""
}
variable "public_web_base_url" {
  type    = string
  default = ""
}
variable "line_messaging_monthly_cap" {
  type    = number
  default = 0
}
variable "line_channel_id" {
  type    = string
  default = ""
}
variable "api_cors_allowed_origins" {
  type    = list(string)
  default = []
}
variable "line_auth_rate_limit" {
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
}
variable "container_images" { type = map(string) }
variable "enable_media_pipeline" {
  type    = bool
  default = false
}
variable "media_worker_url" {
  type    = string
  default = ""
}
variable "media_cors_origins" {
  type    = list(string)
  default = []
}
variable "github_repository" { type = string }
variable "monitoring_notification_channels" {
  type    = list(string)
  default = []
}
variable "project_budget" {
  type = object({
    billing_account_id    = string
    currency_code         = string
    monthly_amount_units  = number
    threshold_percentages = optional(list(number), [0.5, 0.8, 1.0])
  })
  default = null
}
variable "alert_runbook_url" {
  type    = string
  default = "https://github.com/onitaiji4real/nook/blob/main/docs/runbooks/deployment.md"
}
