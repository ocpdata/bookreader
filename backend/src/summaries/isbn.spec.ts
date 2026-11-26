import { normalizeIsbn } from './isbn';

describe('normalizeIsbn', () => {
  it('acepta un ISBN-13 con guiones o espacios y lo deja sin ellos', () => {
    expect(normalizeIsbn('978-0-201-61622-4')).toBe('9780201616224');
    expect(normalizeIsbn(' 9780201616224 ')).toBe('9780201616224');
  });

  it('convierte un ISBN-10, incluido el dígito de control X', () => {
    expect(normalizeIsbn('0-201-61622-X')).toBe('9780201616224');
    expect(normalizeIsbn('8484322394')).toBe('9788484322399');
  });

  it('rechaza dígitos de control incorrectos, longitudes y prefijos inválidos', () => {
    for (const bad of ['9780201616225', '0201616220', '12345', '9770201616224', 'abcdefghijklm', '']) {
      expect(normalizeIsbn(bad)).toBeNull();
    }
  });
});
