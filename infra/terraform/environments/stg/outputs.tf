output "platform" {
  value = {
    artifact_registry       = module.platform.artifact_registry_repository
    cloud_sql_connection    = module.platform.cloud_sql_connection_name
    media_bucket            = module.platform.media_bucket
    runtime_service_urls    = module.platform.runtime_service_urls
    runtime_service_accounts = module.platform.runtime_service_accounts
  }
}
