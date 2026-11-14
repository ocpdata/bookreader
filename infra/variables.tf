variable "aws_region" {
  description = "Región de AWS (la misma del bucket S3)."
  type        = string
  default     = "us-east-1"
}

variable "allowed_cidr_blocks" {
  description = "IPs (CIDR) con acceso a SSH, HTTP y HTTPS de la VM. Usa tu IP /32 hasta que exista el login."
  type        = list(string)

  validation {
    condition     = length(var.allowed_cidr_blocks) > 0 && !contains(var.allowed_cidr_blocks, "0.0.0.0/0")
    error_message = "allowed_cidr_blocks no puede estar vacío ni abrirse a 0.0.0.0/0 mientras la app no tenga login."
  }
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

variable "vpc_cidr" {
  description = "Rango de la VPC. No debe solaparse con vm-newpeople-vpc (10.90.0.0/16) ni con la VPC por defecto (172.31.0.0/16)."
  type        = string
  default     = "10.91.0.0/16"
}

variable "public_subnet_cidr" {
  type    = string
  default = "10.91.1.0/24"
}

variable "private_subnet_cidrs" {
  description = "Dos subredes privadas en zonas distintas (requisito de RDS)."
  type        = list(string)
  default     = ["10.91.10.0/24", "10.91.20.0/24"]
}

variable "s3_bucket_name" {
  description = "Bucket S3 privado con los audios (existe fuera de Terraform)."
  type        = string
  default     = "resumen-book-reader"
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
