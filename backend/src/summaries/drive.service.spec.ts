import { createHash } from 'node:crypto';
import { DriveService } from './drive.service';

describe('DriveService', () => {
  const service = new DriveService();
  const bytes = Buffer.from('audio de prueba');
  const file = { id: 'file_123', name: 'libro.mp3', size: String(bytes.length), version: '7', capabilities: { canDownload: true } };
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('calcula la huella de los bytes seleccionados y no expone el token en la URL', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(file))
      .mockResolvedValueOnce(new Response(bytes))
      .mockResolvedValueOnce(Response.json(file));
    const result = await service.inspect(file.id, 'token-de-prueba', 'resource_key');
    expect(result).toEqual({
      id: file.id, name: file.name, size: bytes.length, version: file.version,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain('token-de-prueba');
    expect(options.headers).toEqual({
      Authorization: 'Bearer token-de-prueba',
      'X-Goog-Drive-Resource-Keys': 'file_123/resource_key',
    });
  });

  it('rechaza un archivo que cambia durante la lectura', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(file))
      .mockResolvedValueOnce(new Response(bytes))
      .mockResolvedValueOnce(Response.json({ ...file, version: '8' }));
    await expect(service.inspect(file.id, 'token')).rejects.toThrow('cambió');
  });

  it('rechaza contenido que no coincide con el tamaño declarado', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(file))
      .mockResolvedValueOnce(new Response(Buffer.concat([bytes, bytes])));
    await expect(service.inspect(file.id, 'token')).rejects.toThrow('tamaño');
  });

  it('informa permisos revocados sin exponer la respuesta de Google', async () => {
    fetchMock.mockResolvedValueOnce(new Response('datos privados', { status: 403 }));
    await expect(service.inspect(file.id, 'token')).rejects.toThrow('Vuelve a seleccionarlo');
  });

  it('rechaza archivos que no se pueden descargar', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...file, capabilities: { canDownload: false } }));
    await expect(service.inspect(file.id, 'token')).rejects.toThrow('no se puede descargar');
  });
});
