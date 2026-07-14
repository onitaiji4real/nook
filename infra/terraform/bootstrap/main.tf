provider "google" {
  project = var.seed_project_id
}

resource "google_project" "environment" {
  for_each = var.project_ids

  name            = "Beauty Platform ${upper(each.key)}"
  project_id      = each.value
  billing_account = var.billing_account
  org_id          = var.folder_id == null ? var.organization_id : null
  folder_id       = var.folder_id

  labels = {
    application = "nook"
    environment = each.key
    managed_by  = "terraform"
  }

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = (var.organization_id == null) != (var.folder_id == null)
      error_message = "Set exactly one of organization_id or folder_id."
    }
  }
}

resource "google_project_service" "storage" {
  for_each = google_project.environment

  project            = each.value.project_id
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

resource "google_storage_bucket" "terraform_state" {
  for_each = google_project.environment

  project                     = each.value.project_id
  name                        = "${each.value.project_id}-tfstate"
  location                    = "ASIA-EAST1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 20
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.storage]
}
