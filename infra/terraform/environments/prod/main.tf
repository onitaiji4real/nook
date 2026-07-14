provider "google" {
  project = var.project_id
  region  = var.region
}

module "platform" {
  source = "../../modules/platform"

  project_id                       = var.project_id
  environment                      = "prod"
  region                           = var.region
  deploy_runtime                   = var.deploy_runtime
  line_channel_id                  = var.line_channel_id
  container_images                 = var.container_images
  github_repository                = var.github_repository
  monitoring_notification_channels = var.monitoring_notification_channels
  alert_runbook_url                = var.alert_runbook_url
  database_tier                    = "db-custom-2-7680"
  database_availability_type       = "REGIONAL"
  database_deletion_protection     = true
}
