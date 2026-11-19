import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config, Transport, geminiCall, retryTiming, sanitize } from './m3/clients.mjs';
import { localTriage, generationInput, digest } from './m3/model.mjs';
import { processTasks } from './m3/pipeline.mjs';
import { processAzureOnly, azureCoverage } from './m3/azureOnly.mjs';

const settings = () => ({ ...config({ GOOGLE_GEMINI_API_KEY: 'test-google-secret', AZURE_TRANSLATOR_KEY: 'test-azure-secret', M3_DRY_RUN: 'false' }), allowGemini: true });
const task = id => ({ sense_id: id, word: 'create', pos: 'verb', english_definition: 'To bring into existence.', examples: [], tags: [], adjacent_senses: [], ecdict_candidates: [], events: [], status: 'queued', azure: null, gemini: null, comparison: null, recheck: null, quality_flags: [] });
const draft = id => ({ sense_id: id, pos: 'verb', english_definition: 'To bring into existence.', glosses: ['创造'], explanation: '使原先不存在的事物出现。', confidence: .9, uncertainties: [] });
const success = data => new Response(JSON.stringify(data), { status: 200 });
function fake(fetcher, opts = {}) {
  let now = 100000; const waits = [];
  const dependencies = { fetcher, now: () => now, wait: async ms => { waits.push(ms); now += ms; }, random: () => 0 };
  const tr = new Transport({ ...settings(), ...opts }, mkdtempSync(join(tmpdir(), 'm3-strategy-')), dependencies);
  return { tr, waits, dependencies };
}
const input = () => [generationInput(task('a'))];

test('Gemini defaults closed and retired 2.5 model is rejected before any request', async () => {
  assert.equal(config({}).model, 'gemini-3-flash-preview');
  assert.equal(config({}).allowGemini, false);
  assert.throws(() => config({ GOOGLE_GEMINI_MODEL: 'gemini-2.5-flash' }), /UNVERIFIED/);
  const { tr } = fake(() => { throw Error('network must not run'); }, { allowGemini: false });
  await assert.rejects(geminiCall(tr, 'generate', input()), /DISABLED/);
  assert.equal(tr.ledger.calls.length, 0);
});

test('Retry-After seconds/date and nested protobuf retryDelay take precedence; long server wait pauses', () => {
  const now = Date.parse('2026-11-15T00:00:00Z');
  const body = { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '120.5s' }] } };
  assert.equal(retryTiming(new Headers({ 'Retry-After': '90' }), body, now, 0).delayMs, 120500);
  assert.equal(retryTiming(new Headers({ 'Retry-After': 'Sun, 15 Nov 2026 00:03:00 GMT' }), body, now, 0).delayMs, 180000);
  assert.equal(retryTiming(new Headers(), { retryDelay: { seconds: '12', nanos: 500000000 } }, now, 0).delayMs, 12500);
  assert.equal(retryTiming(new Headers({ 'Retry-After': '601' }), {}, now, 0).pause, true);
  assert.equal(retryTiming(new Headers(), {}, now, 8, () => 1).delayMs, 600000);
  assert.ok(retryTiming(new Headers(), {}, now, 0, () => 1).delayMs > retryTiming(new Headers(), {}, now, 0, () => 0).delayMs);
});

test('Gemini 429 retries six times then durably pauses; no request occurs after restart', async () => {
  let calls = 0;
  const { tr, waits, dependencies } = fake(async () => { calls++; return new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'busy', details: [] } }), { status: 429 }); });
  await assert.rejects(geminiCall(tr, 'generate', input()), /RETRY_EXHAUSTED_PAUSED/);
  assert.equal(calls, 7);
  const starts = tr.ledger.calls.map(c => c.startedAtMs);
  assert.deepEqual(starts.slice(1).map((n, i) => n - starts[i]), [30000, 60000, 120000, 240000, 480000, 600000]);
  assert.ok(waits.every(ms => ms <= 60000));
  const resumed = new Transport(settings(), tr.directory, dependencies);
  await assert.rejects(geminiCall(resumed, 'generate', input(), 'different'), /GEMINI_PAUSED/);
  assert.equal(calls, 7);
});

test('server waits over ten minutes are preserved without sleeping or early retry', async () => {
  let calls = 0;
  const { tr, waits } = fake(async () => { calls++; return new Response('{}', { status: 429, headers: { 'Retry-After': '900' } }); });
  await assert.rejects(geminiCall(tr, 'generate', input()), /SERVER_WAIT_PAUSED/);
  assert.equal(calls, 1); assert.deepEqual(waits, []);
  assert.equal(Date.parse(tr.ledger.geminiPause.notBefore) - tr.ledger.calls[0].startedAtMs, 900000);
});

test('429 error body/details and diagnostic headers survive redaction; credentials do not', async () => {
  const body = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'test-google-secret Bearer hidden-token https://example.invalid/?key=another-secret', details: [{ '@type': 'google.rpc.RetryInfo', retryDelay: '901s', metadata: { authorization: 'private', api_key: 'private', reason: 'capacity' } }] } };
  const { tr } = fake(async () => new Response(JSON.stringify(body), { status: 429, headers: { 'Retry-After': '901', 'x-goog-request-id': 'request-123', 'x-cloud-trace-context': 'trace-123', 'x-goog-api-key': 'test-google-secret', 'set-cookie': 'private' } }));
  await assert.rejects(geminiCall(tr, 'generate', input()), /SERVER_WAIT_PAUSED/);
  const log = readFileSync(tr.ledgerPath, 'utf8'), c = JSON.parse(log).calls[0];
  for (const secret of ['test-google-secret', 'hidden-token', 'another-secret', 'private']) assert.ok(!log.includes(secret));
  assert.equal(c.errorResponse.error.details[0].metadata.reason, 'capacity');
  assert.deepEqual(c.retryDelay, ['901s']); assert.equal(c.retryAfter, '901');
  assert.equal(c.requestIds['x-goog-request-id'], 'request-123');
  assert.equal(c.model, 'gemini-3-flash-preview'); assert.equal(c.apiVersion, 'v1'); assert.equal(c.senseCount, 1);
  assert.ok(c.startedAt && c.completedAt && c.endpoint); assert.equal(c.httpStatus, 429);
  assert.equal(sanitize({ refresh_token: 'private' }).refresh_token, '[REDACTED]');
});

test('persisted next retry time is honored after interruption', async () => {
  let calls = 0;
  const { tr, dependencies } = fake(async () => { calls++; return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }); });
  tr.wait = async () => { throw Error('simulated interruption'); };
  await assert.rejects(geminiCall(tr, 'generate', input()), /interruption/);
  const resumed = new Transport(settings(), tr.directory, { ...dependencies, fetcher: async () => { calls++; return success({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ results: [draft('a')] }) }] } }], usageMetadata: { totalTokenCount: 100 } }); } });
  await geminiCall(resumed, 'generate', input());
  assert.equal(calls, 2); assert.ok(resumed.ledger.calls[1].startedAtMs - resumed.ledger.calls[0].startedAtMs >= 120000);
});

test('local triage never treats Chinese string overlap as semantic proof', () => {
  const t = { ...task('a'), azure: { text: '创造' }, gemini: draft('a') };
  assert.equal(localTriage(t).needsGeminiRecheck, false);
  assert.equal(localTriage(t).priorSemanticPass, false);
  t.gemini.explanation = '上帝凭空创造万物。'; assert.equal(localTriage(t).needsGeminiRecheck, true);
  t.gemini = { sense_id: 'wrong' }; assert.equal(localTriage(t).structureValid, false);
});

test('substantive conflict gets one recheck, no repeated comparison or automatic approval', async () => {
  let calls = 0;
  const t = { ...task('a'), status: 'gemini_completed', azure: { text: '创造' }, gemini: { ...draft('a'), explanation: '上帝创造万物。' } };
  const { tr } = fake(async (_url, options) => {
    calls++; assert.ok(JSON.parse(options.body).systemInstruction.parts[0].text.includes('Independently resolve'));
    return success({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ results: [{ sense_id: 'a', preferred: 'azure', glosses: ['创造'], explanation: draft('a').explanation, changes_needed: true, resolved: true, evidence: '英文未指定宗教背景。', unresolved: [] }] }) }] } }], usageMetadata: { totalTokenCount: 100 } });
  });
  const j = { tasks: [t] }; await processTasks(j, [t], tr, () => {});
  assert.equal(calls, 1); assert.equal(t.status, 'needs_review'); assert.equal(t.postRecheckComparison, undefined);
  assert.equal(t.original_gemini.explanation, '上帝创造万物。');
  await processTasks(j, [t], tr, () => {}); assert.equal(calls, 1);
});

test('Azure-only fills missing accepted/queued records, preserves old data and is idempotent', async () => {
  const old = { ...task('old'), azure: { text: '已有译文' }, gemini: draft('old'), status: 'auto_pass' };
  const approved = { ...task('approved'), status: 'user_accepted', accepted_content: { glosses: ['人工批准'] } };
  const queued = task('new'), j = { tasks: [old, approved, queued] }, oldHash = digest(old); let calls = 0, saves = 0;
  const { tr } = fake(async (url, options) => {
    calls++; assert.equal(new URL(url).hostname, 'api.cognitive.microsofttranslator.com');
    assert.equal(JSON.parse(options.body).length, 2);
    return success([{ translations: [{ to: 'zh-Hans', text: '参考甲' }] }, { translations: [{ to: 'zh-Hans', text: '参考乙' }] }]);
  }, { allowGemini: false });
  await processAzureOnly(j, tr, () => saves++);
  assert.equal(digest(old), oldHash); assert.equal(approved.status, 'user_accepted'); assert.deepEqual(approved.accepted_content.glosses, ['人工批准']); assert.equal(queued.status, 'queued');
  assert.equal(azureCoverage(j).completed, 3); assert.equal(saves, 2);
  await processAzureOnly(j, tr, () => saves++); assert.equal(calls, 1); assert.equal(saves, 2);
});

test('Azure partial missing result records failure without changing overall checkpoint status', async () => {
  const j = { tasks: [task('a'), task('b')] };
  const { tr } = fake(async () => success([{ translations: [{ to: 'zh-Hans', text: '甲' }] }, { translations: [] }]), { allowGemini: false });
  await processAzureOnly(j, tr, () => {});
  assert.equal(azureCoverage(j).completed, 1); assert.equal(azureCoverage(j).failed, 1);
  assert.equal(j.tasks[1].status, 'queued'); assert.equal(j.tasks[1].events[0].code, 'AZURE_RECORD_MISSING');
});
