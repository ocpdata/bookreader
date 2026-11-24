resource "aws_s3_bucket_metric" "resource_monitoring" {
  bucket = var.s3_bucket_name
  name   = "bookreader-requests"
}

resource "aws_iam_role_policy_attachment" "systems_manager" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "resource_monitoring" {
  statement {
    actions   = ["cloudwatch:GetMetricData"]
    resources = ["*"]
  }

  statement {
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["CWAgent"]
    }
  }
}

resource "aws_iam_role_policy" "resource_monitoring" {
  name   = "${local.name}-resource-monitoring"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.resource_monitoring.json
}

resource "aws_ssm_document" "cloudwatch_agent" {
  name            = "${local.name}-configure-cloudwatch-agent"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Install and configure the BookReader CloudWatch agent"
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "configureAgent"
      inputs = {
        timeoutSeconds = "600"
        runCommand     = [file("${path.module}/templates/configure-cloudwatch-agent.sh")]
      }
    }]
  })
}

resource "aws_ssm_association" "cloudwatch_agent" {
  name                = aws_ssm_document.cloudwatch_agent.name
  association_name    = "${local.name}-cloudwatch-agent"
  schedule_expression = "rate(1 day)"
  targets {
    key    = "InstanceIds"
    values = [aws_instance.app.id]
  }
  depends_on = [
    aws_iam_role_policy_attachment.systems_manager,
    aws_iam_role_policy.resource_monitoring,
  ]
}

output "cloudwatch_agent_document_name" {
  value = aws_ssm_document.cloudwatch_agent.name
}
