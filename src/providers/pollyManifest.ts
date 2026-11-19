import type { AudioManifest, AudioResource, AudioTarget } from '../domain/audio.ts';
import { ManifestAudioResolver } from './audioResolver.ts';
const row = (x: unknown): Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const nonempty = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const hex = (x: unknown) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const target = (value: unknown): value is AudioTarget => { const t = row(value); return nonempty(t.contentId) && ['word', 'phrase', 'example'].includes(String(t.kind)) && nonempty(t.pronunciationId) && (t.senseId === undefined || nonempty(t.senseId)); };
export function parsePollyManifest(value: unknown): AudioManifest {
  const m = row(value);
  if (m.schemaVersion !== 1 || !Array.isArray(m.resources)) throw new Error('Invalid Polly manifest');
  const resources = m.resources.map(value => {
    const r = row(value), s = row(r.synthesis), g = row(r.generation), a = row(r.asset), license = row(r.license), review = row(r.review);
    if (!hex(r.id) || !hex(r.textSha256) || !nonempty(r.text) || r.provider !== 'Amazon Polly' || r.source !== 'neural' || r.model !== 'neural' || r.locale !== 'en-US' || r.publication !== 'production' || !['Joanna', 'Stephen'].includes(String(r.voice)) || !target(r.target) || !Array.isArray(r.targets) || !r.targets.length || !r.targets.every(target) || !nonempty(r.recipeVersion) || !['planned', 'failed', 'ready'].includes(String(g.status)) || !['pending', 'approved', 'rejected'].includes(String(review.status)) || s.engine !== 'neural' || s.languageCode !== 'en-US' || s.sampleRate !== '24000' || !nonempty(license.attribution) || !String(license.url).startsWith('https://')) throw new Error('Invalid Polly resource');
    if (g.status === 'ready' && (!hex(a.sha256) || typeof a.bytes !== 'number' || a.bytes <= 0 || a.format !== 'mp3' || a.path !== `audio/polly/en-US/neural/${String(r.voice).toLowerCase()}/${r.id}.mp3`)) throw new Error('Invalid Polly asset');
    return r as unknown as AudioResource;
  });
  if (new Set(resources.map(r => r.id)).size !== resources.length) throw new Error('Duplicate Polly resource');
  return { schemaVersion: 1, resources };
}
export function createPollyManifestLoader(fetchManifest: () => Promise<unknown>) {
  let pending: Promise<AudioManifest> | undefined;
  return () => pending ??= fetchManifest().then(parsePollyManifest).catch(error => { pending = undefined; throw error; });
}
export const loadPollyManifest = createPollyManifestLoader(async () => {
  const response = await fetch(`${import.meta.env.BASE_URL}data/audio-manifest.json`, { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('音频清单加载失败');
  return response.json();
});
export class PollyAudioResolver extends ManifestAudioResolver {
  async prepare() { this.setManifest(await loadPollyManifest()); }
}
