output "platform" {
  value = {
    artifact_registry                 = module.platform.artifact_registry_repository
    cloud_sql_connection              = module.platform.cloud_sql_connection_name
    media_bucket                      = module.platform.media_bucket
    runtime_service_urls              = module.platform.runtime_service_urls
    migration_job_name                = module.platform.migration_job_name
    runtime_service_accounts          = module.platform.runtime_service_accounts
    github_deployer_service_account   = module.platform.github_deployer_service_account
    github_workload_identity_provider = module.platform.github_workload_identity_provider
    cloud_run_5xx_alert_policy        = module.platform.cloud_run_5xx_alert_policy
    service_health_dashboard          = module.platform.service_health_dashboard
  }
}
