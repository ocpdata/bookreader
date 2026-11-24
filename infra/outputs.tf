output "public_ip" {
  description = "IP pública (Elastic IP) de la VM."
  value       = aws_eip.app.public_ip
}

output "instance_id" {
  value = aws_instance.app.id
}

output "db_instance_id" {
  value = aws_db_instance.main.identifier
}

output "web_security_group_id" {
  description = "Security Group de la VM (el workflow de despliegue abre SSH temporalmente a la IP del runner)."
  value       = aws_security_group.web.id
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

output "mail_from" {
  description = "Remitente de los correos transaccionales."
  value       = local.mail_enabled ? local.mail_from : null
}

output "ses_dns_records" {
  description = "Registros DNS (CNAME) de DKIM que hay que publicar para verificar el dominio en SES."
  value = local.mail_enabled ? [
    for token in aws_sesv2_email_identity.app[0].dkim_signing_attributes[0].tokens : {
      type  = "CNAME"
      name  = "${token}._domainkey.${var.app_domain}"
      value = "${token}.dkim.amazonses.com"
    }
  ] : []
}
