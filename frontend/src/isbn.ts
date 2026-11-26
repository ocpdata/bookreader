const clean = (value: string) => value.replace(/[\s-]/g, '').toUpperCase()

function checkDigit13(first12: string) {
  const sum = [...first12].reduce((total, ch, i) => total + Number(ch) * (i % 2 === 0 ? 1 : 3), 0)
  return (10 - (sum % 10)) % 10
}

/** ISBN-13 sin guiones, o null si no es válido. Acepta ISBN-10 (lo convierte) y comprueba el dígito de control. */
export function normalizeIsbn(input: string): string | null {
  const value = clean(input)
  if (/^97[89]\d{10}$/.test(value)) return checkDigit13(value.slice(0, 12)) === Number(value[12]) ? value : null
  if (!/^\d{9}[\dX]$/.test(value)) return null
  const sum = [...value.slice(0, 9)].reduce((total, ch, i) => total + Number(ch) * (10 - i), 0)
  const check = (11 - (sum % 11)) % 11
  if ((check === 10 ? 'X' : String(check)) !== value[9]) return null
  const first12 = `978${value.slice(0, 9)}`
  return `${first12}${checkDigit13(first12)}`
}
