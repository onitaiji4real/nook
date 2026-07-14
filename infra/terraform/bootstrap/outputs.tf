output "project_ids" {
  value = { for environment, project in google_project.environment : environment => project.project_id }
}

output "terraform_state_buckets" {
  value = { for environment, bucket in google_storage_bucket.terraform_state : environment => bucket.name }
}
