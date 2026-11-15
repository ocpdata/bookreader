variable "aws_region" {
  description = "Región de AWS (la misma del bucket S3)."
  type        = string
  default     = "us-east-1"
}

variable "allowed_cidr_blocks" {
  description = "IPs (CIDR) con acceso a SSH de la VM (nunca 0.0.0.0/0). Los despliegues abren el 22 temporalmente solo para el runner."
  type        = list(string)

  validation {
    condition     = length(var.allowed_cidr_blocks) > 0 && !contains(var.allowed_cidr_blocks, "0.0.0.0/0")
    error_message = "allowed_cidr_blocks (SSH) no puede estar vacío ni abrirse a 0.0.0.0/0."
  }
}

variable "https_cidr_blocks" {
  description = "IPs (CIDR) con acceso al puerto 443. Público para las apps y la web fuera de casa; restringe a tu IP si quieres cerrar el acceso."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "http_cidr_blocks" {
  description = "IPs (CIDR) con acceso al puerto 80. Debe ser público para que Let's Encrypt valide y renueve; Nginx solo valida y redirige a HTTPS ahí."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "ssh_public_key" {
  description = "Clave pública SSH que se instala para el usuario deployer."
  type        = string
}

variable "instance_type" {
  description = "Tipo de instancia EC2."
  type        = string
  default     = "t3.small"
}

variable "root_volume_size" {
  description = "Tamaño del disco de la VM en GB."
  type        = number
  default     = 20
}

# Los rangos de red vienen de las variables de GitHub Actions (VPC_CIDR, PUBLIC_SUBNET_CIDR,
# PRIVATE_SUBNET_1_CIDR y PRIVATE_SUBNET_2_CIDR) y no tienen valor por defecto: si falta
# alguno, el plan falla en lugar de usar un rango inesperado. No se deben cambiar una vez
# creada la red: obligaría a reemplazar la VPC, las subredes y la VM.
# Las comprobaciones de solape y pertenencia a la VPC están en main.tf (precondiciones).
variable "vpc_cidr" {
  description = "Rango de la VPC. No debe solaparse con vm-newpeople-vpc (10.90.0.0/16) ni con la VPC por defecto (172.31.0.0/16)."
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr no es un CIDR válido."
  }
}

variable "public_subnet_cidr" {
  description = "Subred pública de la VM."
  type        = string

  validation {
    condition     = can(cidrhost(var.public_subnet_cidr, 0))
    error_message = "public_subnet_cidr no es un CIDR válido."
  }
}

variable "private_subnet_cidrs" {
  description = "Subredes privadas de la RDS, en zonas distintas (RDS exige al menos dos)."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_cidrs) >= 2 && length(distinct(var.private_subnet_cidrs)) == length(var.private_subnet_cidrs)
    error_message = "Hacen falta al menos dos subredes privadas distintas."
  }

  validation {
    condition     = alltrue([for cidr in var.private_subnet_cidrs : can(cidrhost(cidr, 0))])
    error_message = "Todas las subredes privadas deben ser CIDR válidos."
  }
}

variable "s3_bucket_name" {
  description = "Bucket S3 privado con los audios (existe fuera de Terraform)."
  type        = string
  default     = "resumen-book-reader"
}

variable "noncurrent_version_days" {
  description = "Días que se conservan las versiones anteriores (o borradas) de un audio en S3 antes de eliminarlas definitivamente."
  type        = number
  default     = 14
}

variable "alert_email" {
  description = "Correo que recibe las alarmas y los avisos de gasto. Vacío = no se crean alarmas ni presupuesto."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Gasto mensual (USD) de la cuenta AWS a partir del cual se avisa (80 % real y 100 % previsto)."
  type        = number
  default     = 25
}

variable "app_domain" {
  description = "Dominio público de la app para el chequeo externo de disponibilidad (vacío = sin chequeo)."
  type        = string
  default     = ""
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_engine_version" {
  type    = string
  default = "8.4.8"
}

variable "db_allocated_storage" {
  description = "GB de almacenamiento RDS. Sin escalado automático: se amplía a mano."
  type        = number
  default     = 20
}

variable "db_name" {
  type    = string
  default = "bookreader"
}

variable "db_username" {
  type      = string
  sensitive = true
}

variable "db_password" {
  type      = string
  sensitive = true
}
