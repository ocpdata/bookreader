import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator';

// Se recorta y pasa a minúsculas antes de validar: un correo pegado con espacios o en mayúsculas no debe rechazarse.
const email = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);

export class RegisterDto {
  @Transform(email)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Escribe tu nombre' })
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  inviteCode?: string;

  @IsOptional()
  @Equals('share')
  source?: 'share';

  @IsBoolean()
  @Equals(true, { message: 'Debes aceptar los términos y el aviso de privacidad' })
  acceptTerms!: boolean;
}

export class EmailDto {
  @Transform(email)
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class VerificationEmailDto extends EmailDto {
  @IsOptional()
  @Equals('share')
  source?: 'share';
}

export class TokenDto {
  @IsString()
  @Length(20, 200)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @MaxLength(200)
  password!: string;
}
