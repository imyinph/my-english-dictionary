// Decode real files with Chromium. This verifies media integrity, not pronunciation or iPhone quality.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { parsePollyManifest } from '../src/providers/pollyManifest.ts';
import { verifiedAudio } from './audioFiles.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { url: { type: 'string' } } });
if (values.url && new URL(values.url).protocol !== 'https:') throw new Error('Remote playback verification requires HTTPS.');
const directory = join(root, 'public');
const manifest = parsePollyManifest(JSON.parse(readFileSync(join(directory, 'data/audio-manifest.json'), 'utf8')));
if (!manifest.resources.length || manifest.resources.some(r => r.generation.status !== 'ready')) throw new Error('Generate all real audio before media verification.');
const browser = await chromium.launch();
const results = [];
const playback = [];
let server;
try {
  const page = await browser.newPage();
  for (const resource of manifest.resources) {
    if (!verifiedAudio(resource.asset, directory)) throw new Error(`Missing/corrupt audio ${resource.id}`);
    const base64 = readFileSync(join(directory, resource.asset.path)).toString('base64');
    const media = await page.evaluate(async encoded => {
      const context = new OfflineAudioContext(1, 1, 24000);
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const decoded = await context.decodeAudioData(bytes.buffer);
      const samples = decoded.getChannelData(0);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      return { seconds: decoded.duration, channels: decoded.numberOfChannels, decodedSampleRate: decoded.sampleRate, peak };
    }, base64);
    if (!(media.seconds > 0 && media.peak > 0)) throw new Error(`Empty/silent decoded audio ${resource.id}`);
    results.push({ id: resource.id, voice: resource.voice, kind: resource.target.kind, ...media });
  }
  // Use the actual built app and native Audio, without Audio/SpeechSynthesis test doubles.
  if (!values.url) server = await preview({ root, preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
  const base = (values.url ?? 'http://127.0.0.1:4175/').replace(/\/?$/, '/');
  for (const voice of ['Joanna', 'Stephen']) {
    await page.goto(`${base}#/entry/create`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('朗读音色').selectOption(voice);
    for (const kind of ['word', 'phrase', 'example']) {
      if (kind === 'phrase') await page.goto(`${base}#/entry/make-sense`, { waitUntil: 'domcontentloaded' });
      const request = page.waitForRequest(r => r.url().includes(`/audio/polly/en-US/neural/${voice.toLowerCase()}/`) && r.url().endsWith('.mp3'));
      await (kind === 'example' ? page.locator('.example-audio').first() : page.getByRole('button', { name: `朗读词条：${kind === 'word' ? 'create' : 'make sense'}`, exact: true })).click();
      const file = await request;
      await expect(page.locator('.audio-status')).toContainText('神经网络合成播放结束', { timeout: 30000 });
      await expect(page.locator('.audio-status')).toContainText(voice);
      playback.push({ voice, kind, path: new URL(file.url()).pathname, nativeAudioEnded: true });
    }
  }
} finally {
  await browser.close();
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
mkdirSync(join(root, 'artifacts'), { recursive: true });
writeFileSync(join(root, `artifacts/m2-${values.url ? 'online-' : ''}media-validation.json`), JSON.stringify({ checkedAt: new Date().toISOString(), pageUrl: values.url ?? 'http://127.0.0.1:4175/', engine: 'Chromium OfflineAudioContext and native Audio', note: 'Real MP3 decoding and native ended events; not human listening or iPhone acceptance.', resources: results, playback }, null, 2));
console.log(`Decoded ${results.length}/${manifest.resources.length} real MP3 files; nonempty audio signal in every file. ${playback.length}/6 native page playback checks passed. Not an iPhone or pronunciation-quality assessment.`);
