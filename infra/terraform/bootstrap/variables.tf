variable "seed_project_id" {
  description = "Existing project used to authenticate bootstrap operations."
  type        = string
}

variable "billing_account" {
  description = "Billing account attached to all environment projects."
  type        = string
  sensitive   = true
}

variable "organization_id" {
  description = "Organization ID. Set only when folder_id is null."
  type        = string
  default     = null
}

variable "folder_id" {
  description = "Optional folder ID for the environment projects."
  type        = string
  default     = null
}

variable "project_ids" {
  description = "Globally unique project IDs keyed by dev, stg, and prod."
  type        = map(string)

  validation {
    condition     = length(setsubtract(toset(["dev", "stg", "prod"]), toset(keys(var.project_ids)))) == 0
    error_message = "project_ids must include dev, stg, and prod."
  }
}
