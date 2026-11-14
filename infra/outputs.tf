output "public_ip" {
  description = "IP pública (Elastic IP) de la VM."
  value       = aws_eip.app.public_ip
}

output "instance_id" {
  value = aws_instance.app.id
}

output "db_host" {
  description = "Endpoint privado de la RDS (solo accesible desde la VM)."
  value       = aws_db_instance.main.address
}

output "db_port" {
  value = aws_db_instance.main.port
}

output "db_name" {
  value = aws_db_instance.main.db_name
}
