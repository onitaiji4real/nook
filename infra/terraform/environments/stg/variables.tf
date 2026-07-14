variable "project_id" { type = string }
variable "region" { type = string }
variable "deploy_runtime" { type = bool }
variable "container_images" { type = map(string) }
variable "github_repository" { type = string }
variable "monitoring_notification_channels" {
  type    = list(string)
  default = []
}
variable "alert_runbook_url" {
  type    = string
  default = "https://github.com/onitaiji4real/nook/blob/main/docs/runbooks/deployment.md"
}
