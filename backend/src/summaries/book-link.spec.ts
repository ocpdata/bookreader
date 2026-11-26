import { bookUrlFor } from './book-link';

const KEYS = ['BOOK_LINKS_ENABLED', 'BOOK_LINK_TEMPLATE', 'BOOK_STORE_SEARCH_URL'] as const;

describe('bookUrlFor', () => {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  const book = { title: 'Ágil & "rápido" #1', author: 'Ana Pérez' };

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const configure = (template: string, enabled = 'true') => {
    process.env.BOOK_LINKS_ENABLED = enabled;
    process.env.BOOK_LINK_TEMPLATE = template;
    delete process.env.BOOK_STORE_SEARCH_URL;
  };

  it('está apagado sin interruptor o sin plantilla', () => {
    delete process.env.BOOK_LINKS_ENABLED;
    delete process.env.BOOK_LINK_TEMPLATE;
    expect(bookUrlFor(book)).toBeNull();
    configure('{target}&afiliado=ABC', 'false');
    expect(bookUrlFor(book)).toBeNull();
    process.env.BOOK_LINKS_ENABLED = 'true';
    process.env.BOOK_LINK_TEMPLATE = '  ';
    expect(bookUrlFor(book)).toBeNull();
  });

  it('busca por título y autor, bien codificados, cuando no hay ISBN', () => {
    configure('{target}&afiliado=ABC');
    const url = new URL(bookUrlFor(book)!);
    expect(url.origin + url.pathname).toBe('https://www.buscalibre.com.mx/libros/search');
    expect(url.searchParams.get('q')).toBe('Ágil & "rápido" #1 Ana Pérez');
    expect(url.searchParams.get('afiliado')).toBe('ABC');
  });

  it('prefiere el ISBN cuando existe', () => {
    configure('{target}&afiliado=ABC');
    expect(new URL(bookUrlFor({ ...book, isbn13: '9780201616224' })!).searchParams.get('q')).toBe('9780201616224');
  });

  it('admite plantillas de redirección con {url} y de solo consulta con {query}', () => {
    configure('https://redirect.example/go?to={url}&id=ABC');
    const go = new URL(bookUrlFor({ ...book, isbn13: '9780201616224' })!);
    expect(go.searchParams.get('to')).toBe('https://www.buscalibre.com.mx/libros/search?q=9780201616224');

    configure('https://tienda.example/s?term={query}&a=ABC');
    expect(new URL(bookUrlFor(book)!).searchParams.get('term')).toBe('Ágil & "rápido" #1 Ana Pérez');
  });

  it('descarta plantillas que no producen una URL https', () => {
    configure('javascript:alert(1)//{query}');
    expect(bookUrlFor(book)).toBeNull();
    configure('http://tienda.example/?q={query}');
    expect(bookUrlFor(book)).toBeNull();
  });
});
