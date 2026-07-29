provider "google" {
  project = var.project_id
  region  = var.region
}

module "platform" {
  source = "../../modules/platform"

  project_id                       = var.project_id
  environment                      = "stg"
  region                           = var.region
  deploy_runtime                   = var.deploy_runtime
  enable_notification_dispatcher   = var.enable_notification_dispatcher
  enable_line_notifications        = var.enable_line_notifications
  notification_worker_url          = var.notification_worker_url
  public_web_base_url              = var.public_web_base_url
  line_messaging_monthly_cap       = var.line_messaging_monthly_cap
  line_channel_id                  = var.line_channel_id
  api_cors_allowed_origins         = var.api_cors_allowed_origins
  line_auth_rate_limit             = var.line_auth_rate_limit
  enable_media_pipeline            = var.enable_media_pipeline
  media_worker_url                 = var.media_worker_url
  media_cors_origins               = var.media_cors_origins
  container_images                 = var.container_images
  github_repository                = var.github_repository
  monitoring_notification_channels = var.monitoring_notification_channels
  project_budget                   = var.project_budget
  alert_runbook_url                = var.alert_runbook_url
  database_tier                    = "db-custom-1-3840"
  database_availability_type       = "ZONAL"
  database_deletion_protection     = true
}
