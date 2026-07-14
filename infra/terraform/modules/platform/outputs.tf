output "artifact_registry_repository" {
  value = google_artifact_registry_repository.applications.name
}

output "cloud_sql_connection_name" {
  value = google_sql_database_instance.postgres.connection_name
}

output "media_bucket" {
  value = google_storage_bucket.media.name
}

output "runtime_service_urls" {
  value = { for name, service in google_cloud_run_v2_service.application : name => service.uri }
}

output "runtime_service_accounts" {
  value = { for name, account in google_service_account.runtime : name => account.email }
}

output "automation_invoker_service_account" {
  value = google_service_account.automation_invoker.email
}
