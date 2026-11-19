import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { AudioManifest } from '../src/domain/audio.ts';
export const manifest: AudioManifest = JSON.parse(readFileSync(new URL('../public/data/audio-manifest.json', import.meta.url), 'utf8'));
export function readyManifest(ready = true) {
  const value = structuredClone(manifest);
  for (const r of value.resources) {
    r.generation = { status: ready ? 'ready' : 'planned', attempts: ready ? 1 : 0 }; r.review.status = 'pending';
    if (ready) r.asset = { path: `audio/polly/en-US/neural/${r.voice.toLowerCase()}/${r.id}.mp3`, format: 'mp3', sha256: 'a'.repeat(64), bytes: 384 }; else delete r.asset;
  }
  return value;
}
export async function installPollyFixture(page: Page, ready = true) { await page.route('**/data/audio-manifest.json', route => route.fulfill({ json: readyManifest(ready) })); }
