output "backend_url" {
  value = "https://${aws_apprunner_service.backend.service_url}"
}

output "frontend_url" {
  value = length(aws_apprunner_service.frontend) > 0 ? "https://${aws_apprunner_service.frontend[0].service_url}" : ""
}

output "db_address" {
  value     = aws_db_instance.main.address
  sensitive = true
}
