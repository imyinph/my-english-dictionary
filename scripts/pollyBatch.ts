import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AudioResource } from '../src/domain/audio.ts';
import { atomicJson, sha256, validatePollyMp3, verifiedAudio } from './audioFiles.ts';
export const PRICE = 16 / 1_000_000;
export interface Event { type: 'attempt' | 'result'; run: string; id: string; at: string; voice?: string; characters?: number; estimatedUsd?: number; outcome?: 'success' | 'failed'; error?: string; awsCharacters?: number }
export interface BatchOptions { directory: string; stateDirectory: string; manifestPath: string; budgetUsd: number; region: string; retryFailed?: boolean; retryUncertain?: boolean; signal?: AbortSignal; concurrency?: number; limit?: number }
export interface SynthesisResult { bytes: Buffer; requestCharacters?: number }
export const safeError = (error: unknown) => {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(name) && name !== 'Error' ? name : 'SynthesisOrFileError';
};
export const transient = (error: unknown) => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return ['ThrottlingException', 'TooManyRequestsException', 'ServiceFailureException', 'ServiceUnavailable', 'TimeoutError', 'NetworkingError'].includes(e?.name ?? '') || e?.$metadata?.httpStatusCode === 429 || (e?.$metadata?.httpStatusCode ?? 0) >= 500;
};
export const fatal = (error: unknown) => ['AccessDeniedException', 'UnrecognizedClientException', 'ExpiredTokenException', 'CredentialsProviderError', 'InvalidSignatureException'].includes(safeError(error));
export const audioPath = (r: AudioResource) => `audio/polly/en-US/neural/${r.voice.toLowerCase()}/${r.id}.mp3`;
const receiptPath = (state: string, r: AudioResource) => join(state, 'receipts', `${r.id}.json`);
export function readLedger(state: string): Event[] {
  const path = join(state, 'ledger.jsonl');
  if (!existsSync(path)) return [];
  // Fail closed on a torn/corrupted journal: do not lose a possible billable reservation.
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function appendEvent(state: string, event: Event) {
  mkdirSync(state, { recursive: true });
  const fd = openSync(join(state, 'ledger.jsonl'), 'a');
  try { appendFileSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}
export function restore(resources: AudioResource[], options: Pick<BatchOptions, 'directory' | 'stateDirectory'>) {
  const events = readLedger(options.stateDirectory), last = new Map(events.map(e => [e.id, e]));
  for (const resource of resources) {
    const path = audioPath(resource), file = join(options.directory, path), receipt = receiptPath(options.stateDirectory, resource);
    let saved: AudioResource | undefined;
    if (existsSync(receipt)) saved = JSON.parse(readFileSync(receipt, 'utf8')) as AudioResource;
    if (saved && saved.id === resource.id && verifiedAudio(saved.asset, options.directory)) {
      resource.asset = saved.asset; resource.generation = saved.generation; resource.review = saved.review;
    } else if (!saved && existsSync(file)) {
      // Atomic MP3 rename happened before a crash writing the receipt: recover without a new request.
      try {
        const bytes = readFileSync(file); validatePollyMp3(bytes);
        resource.asset = { path, format: 'mp3', bytes: bytes.length, sha256: sha256(bytes) };
        resource.generation = { status: 'ready', attempts: events.filter(e => e.type === 'attempt' && e.id === resource.id).length, generatedAt: statSync(file).mtime.toISOString() };
      } catch { resource.generation = { status: 'failed', attempts: 0, error: 'INVALID_LOCAL_AUDIO' }; }
    } else if (saved) resource.generation = { status: 'failed', attempts: saved.generation.attempts, error: 'INVALID_LOCAL_AUDIO' };
    else if (last.get(resource.id)?.type === 'attempt') resource.generation = { status: 'failed', attempts: events.filter(e => e.type === 'attempt' && e.id === resource.id).length, error: 'INTERRUPTED_UNCERTAIN' };
    else if (last.get(resource.id)?.outcome === 'failed') resource.generation = { status: 'failed', attempts: events.filter(e => e.type === 'attempt' && e.id === resource.id).length, error: last.get(resource.id)!.error };
  }
  return events;
}
export function pendingJobs(resources: AudioResource[], options: Pick<BatchOptions, 'retryFailed' | 'retryUncertain' | 'limit'>) {
  return resources.filter(r => r.generation.status !== 'ready' && (r.generation.error === 'INTERRUPTED_UNCERTAIN' ? options.retryUncertain : r.generation.status !== 'failed' || r.generation.error === 'INVALID_LOCAL_AUDIO' || options.retryFailed)).slice(0, options.limit);
}
export function summarize(resources: AudioResource[], events: Event[], jobs: AudioResource[], cacheHits: number, run?: string) {
  const attempts = events.filter(e => e.type === 'attempt'), runEvents = run ? attempts.filter(e => e.run === run) : [];
  const characters = jobs.reduce((n, r) => n + r.synthesis!.billableCharacters, 0);
  return { totalResources: resources.length, cacheHits, ready: resources.filter(r => r.generation.status === 'ready').length, failed: resources.filter(r => r.generation.status === 'failed').map(r => ({ id: r.id, text: r.text, voice: r.voice, error: r.generation.error })), planned: resources.filter(r => r.generation.status === 'planned').length,
    voices: Object.fromEntries(['Joanna', 'Stephen'].map(voice => [voice, { total: resources.filter(r => r.voice === voice).length, ready: resources.filter(r => r.voice === voice && r.generation.status === 'ready').length, pendingRequests: jobs.filter(r => r.voice === voice).length }])),
    pendingRequests: jobs.length, pendingCharacters: characters, estimatedUsd: characters * PRICE, withThreeAttemptsUsd: characters * PRICE * 3,
    cumulativeSubmittedCharacters: attempts.reduce((n, e) => n + (e.characters ?? 0), 0), cumulativeEstimatedUsd: attempts.reduce((n, e) => n + (e.estimatedUsd ?? 0), 0),
    runSubmittedCharacters: runEvents.reduce((n, e) => n + (e.characters ?? 0), 0), runEstimatedUsd: runEvents.reduce((n, e) => n + (e.estimatedUsd ?? 0), 0),
    awsConfirmedCharacters: events.filter(e => e.type === 'result').reduce((n, e) => n + (e.awsCharacters ?? 0), 0),
    totalBytes: resources.reduce((n, r) => n + (r.asset?.bytes ?? 0), 0), note: 'Attempt reservations include uncertain requests/retries; estimates are not the AWS bill.' };
}
export class StartLimiter {
  private next = 0;
  private tail = Promise.resolve();
  constructor(privateNow: () => number = Date.now, privateSleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) { this.now = privateNow; this.sleep = privateSleep; }
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  start() {
    const result = this.tail.then(async () => { await this.sleep(Math.max(0, this.next - this.now())); this.next = this.now() + 500; });
    this.tail = result.catch(() => {}); return result;
  }
}
export async function runBatch(resources: AudioResource[], options: BatchOptions, synthesize: (r: AudioResource, signal?: AbortSignal) => Promise<SynthesisResult>, dependencies: { limiter?: StartLimiter; sleep?: (ms: number) => Promise<void> } = {}) {
  if (!Number.isFinite(options.budgetUsd) || options.budgetUsd <= 0) throw new Error('Invalid budget');
  const events = restore(resources, options), cacheHits = resources.filter(r => r.generation.status === 'ready').length;
  const jobs = pendingJobs(resources, options), preview = summarize(resources, events, jobs, cacheHits);
  if (preview.withThreeAttemptsUsd > options.budgetUsd) throw new Error('BudgetExceeded: change --budget-usd explicitly after reviewing the estimate.');
  const run = `${Date.now()}-${process.pid}`, limiter = dependencies.limiter ?? new StartLimiter(), sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let cursor = 0, spent = 0, stop = false;
  const publish = () => atomicJson(options.manifestPath, { schemaVersion: 1, resources });
  publish();
  async function worker() {
    while (!stop && !options.signal?.aborted) {
      const resource = jobs[cursor++]; if (!resource) return;
      for (let attempt = 1; attempt <= 3; attempt++) {
        await limiter.start();
        if (stop || options.signal?.aborted) return;
        const characters = resource.synthesis!.billableCharacters, cost = characters * PRICE;
        if (spent + cost > options.budgetUsd + 1e-12) { stop = true; return; }
        const event: Event = { type: 'attempt', run, id: resource.id, voice: resource.voice, at: new Date().toISOString(), characters, estimatedUsd: cost };
        appendEvent(options.stateDirectory, event); events.push(event); spent += cost; resource.generation.attempts++;
        let result: SynthesisResult;
        try { result = await synthesize(resource, options.signal); }
        catch (error) {
          const name = options.signal?.aborted ? 'INTERRUPTED_UNCERTAIN' : safeError(error);
          const e: Event = { type: 'result', run, id: resource.id, at: new Date().toISOString(), outcome: 'failed', error: name };
          appendEvent(options.stateDirectory, e); events.push(e);
          resource.generation.status = 'failed'; resource.generation.error = name; publish();
          if (fatal(error)) stop = true;
          if (attempt < 3 && transient(error) && !stop && !options.signal?.aborted) { await sleep(1000 * 2 ** (attempt - 1)); continue; }
          break;
        }
        // A post-response disk/validation failure must NEVER automatically synthesize again.
        try {
          validatePollyMp3(result.bytes);
          const path = audioPath(resource), file = join(options.directory, path);
          mkdirSync(dirname(file), { recursive: true }); writeFileSync(`${file}.tmp`, result.bytes); renameSync(`${file}.tmp`, file);
          resource.asset = { path, format: 'mp3', sha256: sha256(result.bytes), bytes: result.bytes.length };
          resource.generation = { status: 'ready', generatedAt: new Date().toISOString(), attempts: resource.generation.attempts };
          atomicJson(receiptPath(options.stateDirectory, resource), resource);
          const e: Event = { type: 'result', run, id: resource.id, at: new Date().toISOString(), outcome: 'success', awsCharacters: result.requestCharacters };
          appendEvent(options.stateDirectory, e); events.push(e); publish();
        } catch {
          resource.generation = { ...resource.generation, status: 'failed', error: 'POST_RESPONSE_VALIDATION_OR_STORAGE' };
          delete resource.asset;
          const e: Event = { type: 'result', run, id: resource.id, at: new Date().toISOString(), outcome: 'failed', error: resource.generation.error, awsCharacters: result.requestCharacters };
          appendEvent(options.stateDirectory, e); events.push(e); publish(); stop = true;
        }
        break;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(2, options.concurrency ?? 2)) }, () => worker()));
  publish();
  return summarize(resources, events, pendingJobs(resources, options), cacheHits, run);
}
