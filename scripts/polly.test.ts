import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPollyPlan, buildPollyPlan, type Rule } from './pollyPlan.ts';
import { runBatch, restore, pendingJobs, StartLimiter, readLedger, audioPath, type BatchOptions } from './pollyBatch.ts';
import { parseKaikkiDataset } from '../src/providers/kaikkiAdapter.ts';
import { validatePollyMp3 } from './audioFiles.ts';
import { parsePollyManifest } from '../src/providers/pollyManifest.ts';
import { ManifestAudioResolver } from '../src/providers/audioResolver.ts';

// Structural test frames ONLY. Never deployed and never claimed to be speech.
function mp3() { const frame = Buffer.alloc(192); frame[0] = 255; frame[1] = 243; frame[2] = 132; return Buffer.concat([frame, frame]); }
function environment() {
  const dir = mkdtempSync(join(tmpdir(), 'polly-batch-test-'));
  const options: BatchOptions = { directory: join(dir, 'public'), stateDirectory: join(dir, 'state'), manifestPath: join(dir, 'public/data/audio-manifest.json'), budgetUsd: 5, region: 'ap-southeast-2' };
  let time = 0;
  return { options, deps: { limiter: new StartLimiter(() => time, async ms => { time += ms; }), sleep: async () => {} }, cleanup: () => { if (!dir.startsWith(join(tmpdir(), 'polly-batch-test-'))) throw new Error('Invalid cleanup'); rmSync(dir, { recursive: true, force: true }); } };
}
test('real dataset scan covers every playable English text, both chosen Neural voices, no diagnostics', () => {
  const plan = loadPollyPlan();
  assert.deepEqual(plan.contentTypes, { word: 9, phrase: 1, example: 95 }); assert.equal(plan.scannedContents, 105); assert.equal(plan.resources.length, 210);
  assert.equal(plan.resources.reduce((n, r) => n + r.synthesis!.billableCharacters, 0), 8900);
  assert.ok(plan.resources.every(r => r.synthesis?.engine === 'neural' && r.synthesis.sampleRate === '24000' && r.locale === 'en-US' && ['Joanna', 'Stephen'].includes(r.voice)));
  assert.equal(parsePollyManifest(plan).resources.length, 210);
});
test('same text/context shares a job and aliases, distinct meaning remains separate', () => {
  const entries = parseKaikkiDataset(JSON.parse(readFileSync(new URL('../public/data/kaikki-subset.json', import.meta.url), 'utf8')));
  const e = structuredClone(entries.find(e => e.id === 'creation')!);
  const s = e.senses.find(s => s.examples.length)!; e.senses = [s]; s.examples = [s.examples[0], { ...s.examples[0], id: 'duplicate-example' }];
  const same = buildPollyPlan([e]); assert.equal(same.resources.length, 4); assert.equal(same.resources.find(r => r.target.kind === 'example')!.targets!.length, 2);
  e.senses.push({ ...s, id: 'another-sense', definition: 'Another meaning', examples: [{ ...s.examples[0], id: 'other-example' }] });
  assert.equal(buildPollyPlan([e]).resources.length, 6);
  const otherLexeme = { ...e, id: 'distinct-lexeme', senses: [] };
  assert.equal(buildPollyPlan([{ ...e, senses: [] }, otherLexeme]).resources.length, 4);
});
test('targeted verified IPA affects only its resource pair, unchanged display text; stale rules rejected', () => {
  const entries = parseKaikkiDataset(JSON.parse(readFileSync(new URL('../public/data/kaikki-subset.json', import.meta.url), 'utf8')));
  const original = buildPollyPlan(entries), r = original.resources[0];
  const rule: Rule = { target: r.target, expectedText: r.text, ipa: 'test', version: 'test-v1', reviewedBy: 'test fixture', reviewedAt: '2026-11-13', sourceUrl: 'https://example.test/fixture' };
  const changed = buildPollyPlan(entries, [rule]);
  assert.equal(changed.resources.filter(x => !original.resources.some(o => o.id === x.id)).length, 2);
  assert.equal(changed.resources[0].text, r.text); assert.match(changed.resources[0].synthesis!.requestText, /<phoneme/);
  assert.throws(() => buildPollyPlan(entries, [{ ...rule, expectedText: 'wrong' }]));
  assert.throws(() => buildPollyPlan(entries, [{ ...rule, reviewedBy: '' }]));
});
test('generation commits checked files; rerun is idempotent and never calls service for cache hits', async () => {
  const env = environment(); try {
    const jobs = loadPollyPlan().resources.slice(0, 4); let calls = 0;
    const generate = async () => { calls++; return { bytes: mp3(), requestCharacters: 6 }; };
    const report = await runBatch(jobs, env.options, generate, env.deps);
    assert.equal(report.ready, 4); assert.equal(calls, 4); assert.equal(report.awsConfirmedCharacters, 24);
    const fresh = loadPollyPlan().resources.slice(0, 4);
    const cached = await runBatch(fresh, env.options, generate, env.deps);
    assert.equal(cached.cacheHits, 4); assert.equal(calls, 4);
    const resolver = new ManifestAudioResolver(parsePollyManifest(JSON.parse(readFileSync(env.options.manifestPath, 'utf8'))), 'https://host.example/sub/');
    assert.match(resolver.resolve(fresh[0].target, 'en-US', 'Joanna', fresh[0].text)[0].urls[0], /\/sub\/audio\/polly\/en-US\/neural\/joanna\//);
    assert.equal(resolver.resolve(fresh[0].target, 'en-US', 'Joanna', 'changed').length, 0);
  } finally { env.cleanup(); }
});
test('retry limit and permanent error classification persist submitted-character cost', async () => {
  const env = environment(); try {
    let calls = 0;
    const r = loadPollyPlan().resources.slice(0, 2);
    const report = await runBatch(r, env.options, async resource => { calls++; if (resource.voice === 'Stephen') throw Object.assign(new Error(), { name: 'InvalidSsmlException' }); if (calls < 3) throw Object.assign(new Error(), { name: 'ThrottlingException' }); return { bytes: mp3() }; }, env.deps);
    assert.equal(report.ready, 1); assert.equal(report.failed.length, 1);
    assert.equal(readLedger(env.options.stateDirectory).filter(e => e.type === 'attempt').length, calls);
    assert.equal(report.cumulativeSubmittedCharacters, calls * r[0].synthesis!.billableCharacters);
    const fresh = loadPollyPlan().resources.slice(0, 2); restore(fresh, env.options);
    assert.equal(pendingJobs(fresh, {}).length, 0); assert.equal(pendingJobs(fresh, { retryFailed: true }).length, 1);
  } finally { env.cleanup(); }
});
test('budget rejects before submitting anything, preserves existing bytes on failed regeneration', async () => {
  const env = environment(); try {
    const r = loadPollyPlan().resources.slice(0, 1); let calls = 0;
    await assert.rejects(runBatch(r, { ...env.options, budgetUsd: .000001 }, async () => { calls++; return { bytes: mp3() }; }, env.deps), /BudgetExceeded/); assert.equal(calls, 0);
    await runBatch(r, env.options, async () => ({ bytes: mp3() }), env.deps);
    const path = join(env.options.directory, audioPath(r[0])); writeFileSync(path, 'corrupt old file');
    await runBatch(loadPollyPlan().resources.slice(0, 1), env.options, async () => { throw Object.assign(new Error(), { name: 'InvalidSsmlException' }); }, env.deps);
    assert.equal(readFileSync(path, 'utf8'), 'corrupt old file');
  } finally { env.cleanup(); }
});
test('interrupt resumes completed items; uncertain in-flight requests require explicit retry', async () => {
  const env = environment(); try {
    const abort = new AbortController();
    const report = await runBatch(loadPollyPlan().resources.slice(0, 4), { ...env.options, concurrency: 1, signal: abort.signal }, async () => { abort.abort(); return { bytes: mp3() }; }, env.deps);
    assert.equal(report.ready, 1);
    const fresh = loadPollyPlan().resources.slice(0, 4); restore(fresh, env.options); assert.equal(pendingJobs(fresh, {}).length, 3);
    const uncertain = fresh[1];
    const event = { type: 'attempt', id: uncertain.id, run: 'test-crash', at: 'test', characters: 6, estimatedUsd: .000096 };
    const log = join(env.options.stateDirectory, 'ledger.jsonl'); writeFileSync(log, readFileSync(log, 'utf8') + JSON.stringify(event) + '\n');
    restore(fresh, env.options); assert.equal(uncertain.generation.error, 'INTERRUPTED_UNCERTAIN');
    assert.equal(pendingJobs(fresh, {}).length, 2); assert.equal(pendingJobs(fresh, { retryUncertain: true }).length, 3);
  } finally { env.cleanup(); }
});
test('atomic audio survives crash before receipt; no second paid request', async () => {
  const env = environment(); try {
    const r = loadPollyPlan().resources.slice(0, 1), file = join(env.options.directory, audioPath(r[0]));
    mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, mp3());
    const report = await runBatch(r, env.options, async () => { throw new Error('must not call'); }, env.deps);
    assert.equal(report.ready, 1); assert.equal(report.cacheHits, 1); assert.equal(existsSync(env.options.manifestPath), true);
  } finally { env.cleanup(); }
});
test('rate limiter spaces every request start, including retry slots', async () => {
  let time = 0; const starts: number[] = [];
  const limiter = new StartLimiter(() => time, async ms => { time += ms; });
  await Promise.all(Array.from({ length: 6 }, async () => { await limiter.start(); starts.push(time); }));
  assert.deepEqual(starts, [0, 500, 1000, 1500, 2000, 2500]);
});
test('at most two requests in flight and malformed MP3 never becomes ready', async () => {
  const env = environment(); try {
    let active = 0, maximum = 0;
    await runBatch(loadPollyPlan().resources.slice(0, 6), env.options, async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return { bytes: mp3() }; }, env.deps);
    assert.equal(maximum, 2);
    assert.throws(() => validatePollyMp3(Buffer.from('ID3 but not audio')));
    const r = loadPollyPlan().resources.slice(6, 7);
    const report = await runBatch(r, env.options, async () => ({ bytes: Buffer.from('HTML error') }), env.deps);
    assert.equal(report.ready, 0); assert.equal(report.failed[0].error, 'POST_RESPONSE_VALIDATION_OR_STORAGE');
  } finally { env.cleanup(); }
});
