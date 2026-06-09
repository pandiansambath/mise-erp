output "app_url" {
  description = "Public URL of the Mise app"
  value       = "http://${aws_eip.app.public_ip}"
}

output "public_ip" {
  value = aws_eip.app.public_ip
}

output "db_address" {
  value     = aws_db_instance.main.address
  sensitive = true
}

output "uploads_bucket" {
  value = aws_s3_bucket.uploads.bucket
}
