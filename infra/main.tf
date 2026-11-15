locals {
  name = "bookreader"

  # CIDR ya usados en la cuenta por otras redes (NewPeople y la VPC por defecto).
  reserved_cidrs = ["10.90.0.0/16", "172.31.0.0/16"]

  # Rango numérico [inicio, fin] de un CIDR IPv4, para comprobar solapes y pertenencia.
  cidr_range = {
    for c in distinct(concat([var.vpc_cidr, var.public_subnet_cidr], var.private_subnet_cidrs, local.reserved_cidrs)) :
    c => {
      start = sum([for i, o in split(".", cidrhost(c, 0)) : tonumber(o) * pow(256, 3 - i)])
      end   = sum([for i, o in split(".", cidrhost(c, 0)) : tonumber(o) * pow(256, 3 - i)]) + pow(2, 32 - tonumber(split("/", c)[1])) - 1
    }
  }

  vpc_overlaps = [
    for r in local.reserved_cidrs : r
    if local.cidr_range[var.vpc_cidr].start <= local.cidr_range[r].end && local.cidr_range[r].start <= local.cidr_range[var.vpc_cidr].end
  ]

  subnets_outside_vpc = [
    for c in concat([var.public_subnet_cidr], var.private_subnet_cidrs) : c
    if local.cidr_range[c].start < local.cidr_range[var.vpc_cidr].start || local.cidr_range[c].end > local.cidr_range[var.vpc_cidr].end
  ]

  all_subnets = concat([var.public_subnet_cidr], var.private_subnet_cidrs)

  subnets_overlapping = flatten([
    for i, a in local.all_subnets : [
      for j, b in local.all_subnets : "${a} / ${b}"
      if i < j && local.cidr_range[a].start <= local.cidr_range[b].end && local.cidr_range[b].start <= local.cidr_range[a].end
    ]
  ])
}

data "aws_availability_zones" "available" {
  state = "available"
}

# AMI oficial de Ubuntu 24.04 LTS (x86_64), resuelta por el parámetro público de Canonical.
data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

# ---------- Red ----------

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.name}-vpc" }

  lifecycle {
    precondition {
      condition     = length(local.vpc_overlaps) == 0
      error_message = "vpc_cidr se solapa con una red existente: ${join(", ", local.vpc_overlaps)} (NewPeople 10.90.0.0/16 o VPC por defecto 172.31.0.0/16)."
    }

    precondition {
      condition     = length(local.subnets_outside_vpc) == 0
      error_message = "Subredes fuera de vpc_cidr: ${join(", ", local.subnets_outside_vpc)}."
    }

    precondition {
      condition     = length(local.subnets_overlapping) == 0
      error_message = "Subredes que se solapan entre sí: ${join("; ", local.subnets_overlapping)}."
    }
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${local.name}-igw" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = { Name = "${local.name}-public" }
}

resource "aws_subnet" "private" {
  count = length(var.private_subnet_cidrs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = { Name = "${local.name}-private-${count.index + 1}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ---------- Security Groups ----------

resource "aws_security_group" "web" {
  name        = "${local.name}-web"
  description = "SSH, HTTP y HTTPS a la VM de BookReader desde IPs permitidas"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-web" }
}

# SSH: solo desde las IPs permitidas.
resource "aws_vpc_security_group_ingress_rule" "web" {
  for_each = {
    for pair in setproduct([22], var.allowed_cidr_blocks) :
    "${pair[0]}-${pair[1]}" => { port = pair[0], cidr = pair[1] }
  }

  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
  cidr_ipv4         = each.value.cidr
}

# HTTPS: abierto a Internet para que las apps móviles (Absorb, AudioBooth) y la web funcionen fuera de casa.
# La aplicación exige sesión o token en todo salvo /api/health, /ping, /status y el audio de sesiones de
# reproducción (id aleatorio); Nginx limita los intentos de acceso.
resource "aws_vpc_security_group_ingress_rule" "https" {
  for_each = toset(var.https_cidr_blocks)

  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = each.value
}

# Puerto 80 abierto a Internet: Let's Encrypt valida desde IP que no publica y la renovación
# usa el mismo canal. Nginx solo atiende ahí la validación y la redirección a HTTPS.
resource "aws_vpc_security_group_ingress_rule" "http" {
  for_each = toset(var.http_cidr_blocks)

  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_egress_rule" "web_all" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "MySQL solo desde la VM de BookReader"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-db" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_web" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.web.id
  ip_protocol                  = "tcp"
  from_port                    = 3306
  to_port                      = 3306
}

# ---------- IAM de la VM: acceso mínimo al bucket de audios ----------

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "s3_audios" {
  statement {
    sid = "AudioObjects"
    # DeleteObject: borrado definitivo desde la papelera y limpieza de cargas abandonadas.
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${var.s3_bucket_name}/audios/*"]
  }

  # Sin ListBucket, S3 responde 403 (en vez de 404) al consultar un objeto que aún no existe.
  statement {
    sid       = "ListBucket"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.s3_bucket_name}"]
  }
}

resource "aws_iam_role" "app" {
  name               = "${local.name}-ec2"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy" "s3_audios" {
  name   = "${local.name}-s3-audios"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.s3_audios.json
}

resource "aws_iam_instance_profile" "app" {
  name = "${local.name}-ec2"
  role = aws_iam_role.app.name
}

# ---------- VM ----------

resource "aws_key_pair" "deployer" {
  key_name   = "${local.name}-deployer"
  public_key = var.ssh_public_key
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.ubuntu_ami.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
  key_name               = aws_key_pair.deployer.key_name
  iam_instance_profile   = aws_iam_instance_profile.app.name

  user_data = templatefile("${path.module}/templates/cloud-init.sh.tftpl", {
    ssh_public_key = var.ssh_public_key
  })

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required" # IMDSv2
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_size
    encrypted   = true
  }

  tags = { Name = "${local.name}-vm" }

  # Evita recrear la VM cuando Canonical publica una AMI nueva o cambia el script de arranque.
  lifecycle {
    ignore_changes = [ami, user_data]
  }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id

  tags = { Name = "${local.name}-eip" }
}

# ---------- Base de datos ----------

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "${local.name}-db" }
}

resource "aws_db_parameter_group" "mysql" {
  name   = "${local.name}-mysql84"
  family = "mysql8.4"

  parameter {
    name  = "character_set_server"
    value = "utf8mb4"
  }

  parameter {
    name  = "collation_server"
    value = "utf8mb4_0900_ai_ci"
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-mysql"
  engine         = "mysql"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage # sin max_allocated_storage: no hay escalado automático
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password
  port     = 3306

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.mysql.name
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period    = 7
  copy_tags_to_snapshot      = true
  auto_minor_version_upgrade = true

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-mysql-final"

  lifecycle {
    prevent_destroy = true
  }
}
