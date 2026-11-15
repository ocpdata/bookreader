import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fragmentedMp4Duration } from './fragmented-mp4';

const fixture = readFileSync(join(__dirname, '../../test/fixtures/sample-fragmented.m4a'));

describe('fragmentedMp4Duration', () => {
  it('suma la duración de los fragmentos aunque lleguen en trozos pequeños', async () => {
    const whole = await fragmentedMp4Duration(Readable.from([fixture]));
    expect(whole).toBeGreaterThan(0);
    const chunks = Array.from({ length: Math.ceil(fixture.length / 7) }, (_, i) => fixture.subarray(i * 7, i * 7 + 7));
    expect(await fragmentedMp4Duration(Readable.from(chunks))).toBeCloseTo(whole!, 6);
  });

  it('devuelve null si no es un MP4 fragmentado', async () => {
    const plain = readFileSync(join(__dirname, '../../test/fixtures/sample.m4a'));
    expect(await fragmentedMp4Duration(Readable.from([plain]))).toBeNull();
    expect(await fragmentedMp4Duration(Readable.from([Buffer.from('no es un audio')]))).toBeNull();
  });
});
