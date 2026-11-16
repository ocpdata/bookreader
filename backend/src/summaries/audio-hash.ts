import { createHash } from 'node:crypto';
import { StorageService } from '../storage/storage.service';

export async function hashAudio(storage: StorageService, key: string): Promise<string> {
  const stream = await storage.getObjectStream(key);
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}
