import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function atomicJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n'); renameSync(`${path}.tmp`, path);
}
export function verifiedAudio(asset: { path: string; sha256: string; bytes: number } | undefined, directory: string) {
  if (!asset || !/^audio\/[a-zA-Z0-9_/-]+\.mp3$/.test(asset.path) || asset.path.includes('..')) return false;
  try { const data = readFileSync(join(directory, asset.path)); return data.length === asset.bytes && sha256(data) === asset.sha256; } catch { return false; }
}
export const isMp3 = (data: Buffer) => data.length > 128 && (data.subarray(0, 3).toString() === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0));
/** Validate complete MPEG-2 Layer III frames at the requested 24 kHz (not a listening test). */
export function validatePollyMp3(data: Buffer) {
  let offset = 0, frames = 0;
  if (data.subarray(0, 3).toString() === 'ID3') {
    if (data.length < 10 || [...data.subarray(6, 10)].some(x => x > 127)) throw new Error('INVALID_MP3');
    offset = 10 + (data[6] << 21 | data[7] << 14 | data[8] << 7 | data[9]);
  }
  const rates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  while (offset + 4 <= data.length) {
    if (data.length - offset === 128 && data.subarray(offset, offset + 3).toString() === 'TAG') { offset += 128; break; }
    const a = data[offset], b = data[offset + 1], c = data[offset + 2];
    if (a !== 255 || (b & 0xfe) !== 0xf2 || (c >> 2 & 3) !== 1 || !(c >> 4) || (c >> 4) === 15) throw new Error('INVALID_MP3_24000');
    const size = Math.floor(72000 * rates[c >> 4] / 24000) + (c >> 1 & 1);
    if (offset + size > data.length) throw new Error('TRUNCATED_MP3');
    frames++; offset += size;
  }
  if (frames < 2 || offset !== data.length) throw new Error('INVALID_MP3');
}
