provider "google" {
  project = var.project_id
  region  = var.region
}

module "platform" {
  source = "../../modules/platform"

  project_id                   = var.project_id
  environment                  = "prod"
  region                       = var.region
  deploy_runtime               = var.deploy_runtime
  container_images             = var.container_images
  database_tier                = "db-custom-2-7680"
  database_availability_type   = "REGIONAL"
  database_deletion_protection = true
}
