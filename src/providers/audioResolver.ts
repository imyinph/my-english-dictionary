import type { AudioLocale, AudioManifest, AudioResolver, AudioResource, AudioTarget, ResolvedAudio, PollyVoice } from '../domain/audio.ts';

export function assetUrl(path: string, baseUrl: string): string {
  // Paths stay portable between a Pages subdirectory and an HTTPS R2 custom domain.
  if (!/^[a-zA-Z0-9_/-]+\.(mp3|ogg)$/.test(path) || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Invalid audio asset path');
  const base = new URL(baseUrl);
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Invalid audio origin');
  return new URL(path, base.href.endsWith('/') ? base.href : `${base.href}/`).href;
}

export class ManifestAudioResolver implements AudioResolver {
  constructor(privateManifest: AudioManifest, assetBase: string) { this.manifest = privateManifest; this.base = assetBase; }
  private manifest: AudioManifest;
  private base: string;
  setManifest(manifest: AudioManifest) { this.manifest = manifest; }
  private candidate(resource: AudioResource): ResolvedAudio | undefined {
    if (resource.generation.status !== 'ready' || resource.review.status === 'rejected' || !resource.asset || !/^[a-f0-9]{64}$/.test(resource.asset.sha256) || resource.asset.bytes <= 0) return;
    try { return { urls: [assetUrl(resource.asset.path, this.base)], source: resource.source, label: `${resource.provider} · ${resource.voice}（${resource.source === 'human' ? '真人录音' : '神经网络合成'}）`, resourceId: resource.id }; } catch { return; }
  }
  resolve(target: AudioTarget, locale: AudioLocale, voice?: PollyVoice, text?: string): ResolvedAudio[] {
    return this.manifest.resources.filter(r => r.locale === locale && (text === undefined || r.text === text) && (!voice || r.voice === voice) && (r.targets ?? [r.target]).some(t => t.contentId === target.contentId && t.kind === target.kind && t.pronunciationId === target.pronunciationId && t.senseId === target.senseId) && (r.review.status === 'approved' || (r.publication === 'production' && r.provider === 'Amazon Polly' && r.model === 'neural' && ['Joanna', 'Stephen'].includes(r.voice))))
      .sort((a, b) => Number(a.source !== 'human') - Number(b.source !== 'human'))
      .flatMap(r => { const value = this.candidate(r); return value ? [value] : []; });
  }
  audition(resource: AudioResource) { return this.candidate(resource); }
}
