export type AudioLocale = 'en-US' | 'en-GB';
export type PollyVoice = 'Joanna' | 'Stephen';
export interface AudioTarget {
  contentId: string;
  kind: 'word' | 'phrase' | 'example' | 'diagnostic';
  pronunciationId: string;
  senseId?: string;
}
export interface AudioResource {
  id: string;
  target: AudioTarget;
  targets?: AudioTarget[];
  publication?: 'production';
  synthesis?: { engine: 'neural'; languageCode: 'en-US'; sampleRate: '24000'; textType: 'text' | 'ssml'; requestText: string; billableCharacters: number; contextKey: string };
  locale: AudioLocale;
  text: string;
  textSha256: string;
  source: 'human' | 'neural';
  provider: string;
  model: string;
  voice: string;
  /** null means the provider does not expose a pinned model revision. */
  voiceVersion: string | null;
  recipeVersion: string;
  asset?: { path: string; format: 'mp3' | 'ogg'; sha256: string; bytes: number };
  license: { name: string; url: string; attribution: string; sourceUrl?: string; textLicense?: string; textLicenseUrl?: string; termsCheckedAt: string };
  generation: { status: 'planned' | 'ready' | 'failed'; generatedAt?: string; attempts: number; error?: string };
  review: { status: 'pending' | 'approved' | 'rejected'; reviewer?: string; reviewedAt?: string; device?: string; notes?: string };
}
export interface AudioManifest { schemaVersion: 1; resources: AudioResource[] }
export interface ResolvedAudio { urls: string[]; source: 'human' | 'neural'; label: string; resourceId?: string }
export interface AudioResolver {
  prepare?(): Promise<void>;
  resolve(target: AudioTarget, locale: AudioLocale, voice?: PollyVoice, text?: string): ResolvedAudio[];
  audition(resource: AudioResource): ResolvedAudio | undefined;
}
export interface AudioPlayer {
  playResource(resource: AudioResource, rate: number): Promise<void>;
  stop(): void;
}
