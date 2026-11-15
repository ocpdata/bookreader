# ---------- Correo transaccional (Amazon SES) ----------
# Verificación de correo y recuperación de contraseña. La identidad es el dominio de la app
# (var.app_domain): los registros DKIM que genera SES se publican en el DNS del dominio (ver output
# ses_dns_records). Hasta que AWS conceda acceso a producción, SES solo envía a direcciones verificadas.

data "aws_caller_identity" "current" {}

locals {
  mail_enabled   = var.app_domain != ""
  mail_from      = "${var.mail_from_local_part}@${var.app_domain}"
  ses_config_set = "${local.name}-correo"
}

resource "aws_sesv2_configuration_set" "mail" {
  count = local.mail_enabled ? 1 : 0

  configuration_set_name = local.ses_config_set

  delivery_options {
    tls_policy = "REQUIRE"
  }

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }
}

resource "aws_sesv2_email_identity" "app" {
  count = local.mail_enabled ? 1 : 0

  email_identity         = var.app_domain
  configuration_set_name = aws_sesv2_configuration_set.mail[0].configuration_set_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# La VM solo puede enviar correo desde el remitente de BookReader (condición ses:FromAddress). En el modo de
# pruebas de SES, además de la identidad remitente se evalúan las identidades destinatarias verificadas, por eso
# el recurso es identity/*: lo que limita el envío es el remitente, que no puede ser otro.
data "aws_iam_policy_document" "ses_send" {
  statement {
    sid     = "EnviarCorreo"
    actions = ["ses:SendEmail"]
    resources = [
      "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/*",
      "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:configuration-set/${local.ses_config_set}",
    ]

    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [local.mail_from]
    }
  }
}

resource "aws_iam_role_policy" "ses_send" {
  count = local.mail_enabled ? 1 : 0

  name   = "${local.name}-ses-send"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.ses_send.json
}

# Rebotes, quejas y rechazos llegan al mismo correo de avisos. SES ya deja de escribir a las direcciones que
# rebotan (lista de supresión de la cuenta); esto sirve para enterarse.
data "aws_iam_policy_document" "alerts_topic" {
  count = local.alerts_enabled && local.mail_enabled ? 1 : 0

  # Equivale a la política por defecto del tema (las alarmas de CloudWatch de esta cuenta pueden publicar).
  statement {
    sid       = "PublicarDesdeLaCuenta"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.alerts[0].arn]

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid       = "PublicarDesdeSES"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.alerts[0].arn]

    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  count = local.alerts_enabled && local.mail_enabled ? 1 : 0

  arn    = aws_sns_topic.alerts[0].arn
  policy = data.aws_iam_policy_document.alerts_topic[0].json
}

resource "aws_sesv2_configuration_set_event_destination" "alerts" {
  count = local.alerts_enabled && local.mail_enabled ? 1 : 0

  configuration_set_name = aws_sesv2_configuration_set.mail[0].configuration_set_name
  event_destination_name = "avisos-sns"

  event_destination {
    enabled              = true
    matching_event_types = ["BOUNCE", "COMPLAINT", "REJECT"]

    sns_destination {
      topic_arn = aws_sns_topic.alerts[0].arn
    }
  }

  depends_on = [aws_sns_topic_policy.alerts]
}

# SES pausa el envío si la reputación empeora; estas alarmas avisan antes (umbrales de advertencia de AWS).
resource "aws_cloudwatch_metric_alarm" "ses_bounce_rate" {
  count = local.alerts_enabled && local.mail_enabled ? 1 : 0

  alarm_name          = "${local.name}-correo-rebotes"
  alarm_description   = "La tasa de rebote de los correos de BookReader supera el 5 %."
  namespace           = "AWS/SES"
  metric_name         = "Reputation.BounceRate"
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0.05
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "ses_complaint_rate" {
  count = local.alerts_enabled && local.mail_enabled ? 1 : 0

  alarm_name          = "${local.name}-correo-quejas"
  alarm_description   = "La tasa de quejas (spam) de los correos de BookReader supera el 0,1 %."
  namespace           = "AWS/SES"
  metric_name         = "Reputation.ComplaintRate"
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0.001
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
}
