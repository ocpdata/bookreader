import { BadGatewayException, BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { MAX_AUDIO_BYTES } from './summaries.dto';

export interface DriveFile {
  id: string;
  name: string;
  size: number;
  version: string;
}

@Injectable()
export class DriveService {
  private async request(fileId: string, token: string, resourceKey: string | undefined, media: boolean) {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set('supportsAllDrives', 'true');
    if (media) url.searchParams.set('alt', 'media');
    else url.searchParams.set('fields', 'id,name,size,version,capabilities(canDownload)');
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (resourceKey) headers['X-Goog-Drive-Resource-Keys'] = `${fileId}/${resourceKey}`;
    let response: Response;
    try {
      response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10 * 60_000) });
    } catch {
      throw new BadGatewayException('No se pudo conectar con Google Drive');
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new ForbiddenException('No se puede acceder al archivo de Drive. Vuelve a seleccionarlo y autorizar el acceso.');
    }
    if (!response.ok) throw new BadGatewayException(`Google Drive no pudo entregar el archivo (HTTP ${response.status})`);
    return response;
  }

  async metadata(fileId: string, token: string, resourceKey?: string): Promise<DriveFile> {
    const response = await this.request(fileId, token, resourceKey, false);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') throw new BadGatewayException('Google Drive devolvió datos de archivo inválidos');
    const file = data as Record<string, unknown>;
    const capabilities = file.capabilities;
    const canDownload = capabilities && typeof capabilities === 'object' &&
      (capabilities as Record<string, unknown>).canDownload === true;
    const size = typeof file.size === 'string' ? Number(file.size) : NaN;
    if (file.id !== fileId || typeof file.name !== 'string' || !file.name || file.name.length > 255 ||
        typeof file.version !== 'string' || !file.version || !Number.isSafeInteger(size) ||
        size < 1 || size > MAX_AUDIO_BYTES || !canDownload) {
      throw new BadRequestException('El archivo de Drive no se puede descargar o no cumple el límite de 200 MB');
    }
    if (!/\.(mp3|m4a)$/i.test(file.name)) throw new BadRequestException('El archivo debe ser MP3 o M4A');
    return { id: fileId, name: file.name, size, version: file.version };
  }

  async stream(fileId: string, token: string, size: number, resourceKey?: string): Promise<Readable> {
    const response = await this.request(fileId, token, resourceKey, true);
    if (!response.body) throw new BadGatewayException('Google Drive no devolvió el contenido del archivo');
    const body = response.body;
    return Readable.from((async function* () {
      const reader = body.getReader();
      let total = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > size) throw new BadRequestException('El tamaño del archivo de Drive cambió');
          yield Buffer.from(value);
        }
        if (total !== size) throw new BadRequestException('El tamaño del archivo de Drive cambió');
      } finally {
        await reader.cancel();
      }
    })());
  }

  async inspect(fileId: string, token: string, resourceKey?: string) {
    const file = await this.metadata(fileId, token, resourceKey);
    const stream = await this.stream(fileId, token, file.size, resourceKey);
    const hash = createHash('sha256');
    for await (const chunk of stream) hash.update(chunk);
    const after = await this.metadata(fileId, token, resourceKey);
    if (after.version !== file.version || after.size !== file.size || after.name !== file.name) {
      throw new BadRequestException('El archivo de Drive cambió. Selecciónalo de nuevo.');
    }
    return { ...file, sha256: hash.digest('hex') };
  }
}
