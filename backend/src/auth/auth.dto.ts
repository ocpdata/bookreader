import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  // Se recorta antes de validar: un correo pegado con espacios no debe rechazarse.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  current!: string;

  @IsString()
  @MaxLength(200)
  next!: string;
}

export class DeleteAccountDto {
  /** Se omite en las cuentas sin contraseña, que confirman volviendo a identificarse con Google. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}

export class AppPasswordDto {
  @IsString()
  @MaxLength(100)
  name!: string;
}
