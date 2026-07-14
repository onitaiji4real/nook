variable "project_id" { type = string }
variable "environment" { type = string }
variable "region" { type = string }

variable "deploy_runtime" {
  description = "Create Cloud Run services after deployable images exist."
  type        = bool
  default     = false
}

variable "container_images" {
  description = "Immutable image references keyed by web, api, and worker."
  type        = map(string)
  default     = {}
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
