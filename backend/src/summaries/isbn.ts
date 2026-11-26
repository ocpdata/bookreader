import { registerDecorator, ValidationOptions } from 'class-validator';

const digitsOf = (value: string) => value.replace(/[\s-]/g, '').toUpperCase();

function checkDigit13(first12: string) {
  const sum = [...first12].reduce((total, ch, i) => total + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

/**
 * Devuelve el ISBN-13 sin guiones, o null si no es un ISBN válido. Acepta ISBN-13 y ISBN-10 (que convierte), con o
 * sin guiones o espacios, y comprueba el dígito de control.
 */
export function normalizeIsbn(input: string): string | null {
  const value = digitsOf(input);
  if (/^97[89]\d{10}$/.test(value)) return checkDigit13(value.slice(0, 12)) === Number(value[12]) ? value : null;
  if (!/^\d{9}[\dX]$/.test(value)) return null;
  const sum = [...value.slice(0, 9)].reduce((total, ch, i) => total + Number(ch) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  if ((check === 10 ? 'X' : String(check)) !== value[9]) return null;
  const first12 = `978${value.slice(0, 9)}`;
  return `${first12}${checkDigit13(first12)}`;
}

/** Valida un campo opcional: vacío vale (borra el ISBN) y cualquier otro valor debe ser un ISBN-10 o ISBN-13 válido. */
export function IsIsbn(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isIsbn',
      target: object.constructor,
      propertyName,
      options: { message: 'El ISBN no es válido', ...options },
      validator: { validate: (value: unknown) => typeof value === 'string' && (value === '' || normalizeIsbn(value) !== null) },
    });
}

/** Para @Transform: deja el ISBN-13 normalizado y respeta lo que no sea texto o no sea válido para que falle la validación. */
export const isbnTransform = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? '' : (normalizeIsbn(trimmed) ?? trimmed);
};
