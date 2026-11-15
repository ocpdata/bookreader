# ---------- Protección de los audios (S3) ----------
# El bucket existe fuera de Terraform; aquí solo se gestionan su versionado y su ciclo de vida.
# Con versionado, un borrado (o una sobrescritura) por error o por un bug se puede recuperar mientras
# la versión anterior no haya expirado.

resource "aws_s3_bucket_versioning" "audios" {
  bucket = var.s3_bucket_name

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audios" {
  bucket     = var.s3_bucket_name
  depends_on = [aws_s3_bucket_versioning.audios]

  rule {
    id     = "expirar-versiones-anteriores"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Limpia los marcadores de borrado cuando ya no queda ninguna versión detrás.
  rule {
    id     = "limpiar-marcadores-de-borrado"
    status = "Enabled"

    filter {}

    expiration {
      expired_object_delete_marker = true
    }
  }
}

# ---------- Alarmas y presupuesto ----------
# Se crean solo si hay un correo de avisos (variable ALERT_EMAIL). Las alarmas avisan por SNS: la
# suscripción por correo debe confirmarse una vez desde el enlace que llega a esa dirección.

locals {
  alerts_enabled = var.alert_email != ""
}

resource "aws_sns_topic" "alerts" {
  count = local.alerts_enabled ? 1 : 0

  name = "${local.name}-alertas"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count = local.alerts_enabled ? 1 : 0

  topic_arn = aws_sns_topic.alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# La VM no responde a los chequeos de AWS (o está detenida: sin datos cuenta como fallo).
resource "aws_cloudwatch_metric_alarm" "vm_status" {
  count = local.alerts_enabled ? 1 : 0

  alarm_name          = "${local.name}-vm-sin-respuesta"
  alarm_description   = "La VM de BookReader falla los chequeos de estado de AWS."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  dimensions          = { InstanceId = aws_instance.app.id }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}

# A la base le quedan menos de 4 GiB libres (de 20 GiB).
resource "aws_cloudwatch_metric_alarm" "db_storage" {
  count = local.alerts_enabled ? 1 : 0

  alarm_name          = "${local.name}-bd-poco-espacio"
  alarm_description   = "A la base de datos de BookReader le queda poco espacio libre."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 4 * 1024 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
}

# La web deja de responder desde fuera: un chequeo HTTPS externo a /api/health (que también consulta la base).
resource "aws_route53_health_check" "web" {
  count = local.alerts_enabled && var.app_domain != "" ? 1 : 0

  type              = "HTTPS_STR_MATCH"
  fqdn              = var.app_domain
  port              = 443
  resource_path     = "/api/health"
  search_string     = "ok"
  request_interval  = 30
  failure_threshold = 3

  tags = { Name = "${local.name}-web" }
}

resource "aws_cloudwatch_metric_alarm" "web_health" {
  count = local.alerts_enabled && var.app_domain != "" ? 1 : 0

  alarm_name          = "${local.name}-web-caida"
  alarm_description   = "https://${var.app_domain}/api/health no responde correctamente."
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.web[0].id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}

# Gasto mensual de la cuenta: aviso al 80 % real y cuando se prevea superar el 100 %.
resource "aws_budgets_budget" "monthly" {
  count = local.alerts_enabled ? 1 : 0

  name         = "${local.name}-gasto-mensual"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
