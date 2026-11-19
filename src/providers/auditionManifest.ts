import type { AudioManifest, AudioResource } from '../domain/audio.ts';
export interface AuditionSample { id: string; text: string; note: string; source: { title: string; attribution: string; referenceUrl?: string; license: string; licenseUrl?: string } }
export interface AuditionManifest extends AudioManifest { samples: AuditionSample[] }

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (row: Record<string, unknown>, keys: string[]) => keys.every(key => typeof row[key] === 'string' && !!row[key]);
const optionalHttps = (value: unknown) => value === undefined || (typeof value === 'string' && /^https:\/\//.test(value));

export function parseAuditionManifest(value: unknown): AuditionManifest {
  const data = object(value);
  if (data.schemaVersion !== 1 || !Array.isArray(data.samples) || !Array.isArray(data.resources) || data.resources.length > 96) throw new Error('Invalid audition manifest');
  const samples = data.samples.map(value => {
    const s = object(value), source = object(s.source);
    if (!strings(s, ['id', 'text', 'note']) || !strings(source, ['title', 'attribution', 'license']) || !optionalHttps(source.referenceUrl) || !optionalHttps(source.licenseUrl)) throw new Error('Invalid sample');
    return s as unknown as AuditionSample;
  });
  const resources = data.resources.map(value => {
    const r = object(value), target = object(r.target), license = object(r.license), generation = object(r.generation), review = object(r.review), asset = object(r.asset);
    if (!strings(r, ['id', 'text', 'textSha256', 'provider', 'model', 'voice', 'recipeVersion']) || !strings(target, ['contentId', 'kind', 'pronunciationId']) || !['en-US', 'en-GB'].includes(String(r.locale)) || !['human', 'neural'].includes(String(r.source)) || !['word', 'phrase', 'example', 'diagnostic'].includes(String(target.kind)) || !strings(license, ['name', 'url', 'attribution', 'termsCheckedAt']) || !optionalHttps(license.url) || !['planned', 'ready', 'failed'].includes(String(generation.status)) || !['pending', 'approved', 'rejected'].includes(String(review.status)) || !(r.voiceVersion === null || typeof r.voiceVersion === 'string')) throw new Error('Invalid resource');
    if (!samples.some(s => s.id === target.contentId && s.text === r.text)) throw new Error('Unknown sample');
    if (r.asset !== undefined && (!strings(asset, ['path', 'format', 'sha256']) || !['mp3', 'ogg'].includes(String(asset.format)) || !/^[a-f0-9]{64}$/.test(String(asset.sha256)) || typeof asset.bytes !== 'number' || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0)) throw new Error('Invalid asset');
    if (generation.status === 'ready' && r.asset === undefined) throw new Error('Missing generated asset');
    return r as unknown as AudioResource;
  });
  if (new Set(samples.map(s => s.id)).size !== samples.length || new Set(resources.map(r => r.id)).size !== resources.length) throw new Error('Duplicate audition identity');
  return { schemaVersion: 1, samples, resources };
}
