import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config, Transport, azureTranslate, geminiCall } from './m3/clients.mjs';
import { generationInput, validateGeneration, validateComparison, qualityGate, digest } from './m3/model.mjs';
import { processTasks } from './m3/pipeline.mjs';
import { validateAcceptance } from './m3/acceptance.mjs';
import { acceptanceHash, exportReport } from './m3/report.mjs';

const settings = () => ({ ...config({ GOOGLE_GEMINI_API_KEY: 'test-google-secret', AZURE_TRANSLATOR_KEY: 'test-azure-secret', M3_DRY_RUN: 'false' }), allowGemini: true });
const task = id => ({ sense_id: id, word: 'create', pos: 'verb', english_definition: 'To bring into existence.', examples: [], tags: [], adjacent_senses: [], ecdict_candidates: [], events: [], status: 'queued', azure: null, gemini: null, comparison: null, recheck: null, quality_flags: [] });
const draft = id => ({ sense_id: id, pos: 'verb', english_definition: 'To bring into existence.', glosses: ['创造'], explanation: '使原先不存在的事物出现。', confidence: .9, uncertainties: [] });
const comparison = id => ({ sense_id: id, core_consistent: true, meaning_supported: true, complete: true, pos_correct: true, no_sense_merging: true, natural_chinese: true, register_preserved: true, evidence: '中文覆盖 bring into existence 的创造含义，无额外条件。', unresolved: [] });
const success = data => new Response(JSON.stringify(data), { status: 200 });
function fakeTransport(fetcher) {
  let time = 100000;
  return new Transport(settings(), mkdtempSync(join(tmpdir(), 'dictionary-m3-test-')), { fetcher, now: () => time, wait: async ms => { time += ms; }, random: () => 0 });
}

test('dual config pins Express model/global Azure v3 and caps RPM without exposing credentials', () => {
  assert.equal(settings().rpm, 8);
  assert.throws(() => config({ M3_GEMINI_MAX_RPM: '9' }), /INVALID/);
  assert.throws(() => config({ AZURE_TRANSLATOR_ENDPOINT: 'https://evil.invalid' }), /UNVERIFIED/);
  assert.equal(config({}).dry, true);
});
test('first generation is independent of Azure and ECDICT references', () => {
  const t = task('a'); t.azure = { text: 'wrong reference' }; t.ecdict_candidates = ['wrong'];
  assert.equal(generationInput(t).azure_translation, null); assert.deepEqual(generationInput(t).ecdict_candidates, []);
});
test('schema rejects wrong/duplicate/missing IDs, wrong POS and changed English', () => {
  assert.throws(() => validateGeneration({ results: [] }, [task('a')]));
  assert.throws(() => validateGeneration({ results: [draft('a'), draft('a')] }, [task('a'), task('b')]));
  assert.throws(() => validateGeneration({ results: [{ ...draft('a'), pos: 'noun' }] }, [task('a')]));
  assert.throws(() => validateGeneration({ results: [{ ...draft('a'), english_definition: 'Different.' }] }, [task('a')]));
  assert.equal(validateGeneration({ results: [draft('a')] }, [task('a')]).length, 1);
});
test('confidence alone cannot pass semantic gates or missing independent translation', () => {
  const t = task('a'); t.gemini = draft('a');
  assert.equal(qualityGate(t, comparison('a')).status, 'needs_review');
  t.azure = { text: '创造' }; assert.equal(qualityGate(t, comparison('a')).status, 'auto_pass');
  assert.equal(qualityGate(t, { ...comparison('a'), meaning_supported: false }).status, 'needs_review');
  assert.equal(qualityGate(t, { ...comparison('a'), unresolved: ['专业义不确定'] }).status, 'needs_review');
  assert.throws(() => validateComparison({ results: [{ ...comparison('a'), core_consistent: 'yes' }] }, [t]));
});
test('Azure batch preserves order and records exact submitted definition with no global region header', async () => {
  const tr = fakeTransport(async (url, options) => {
    assert.equal(new URL(url).hostname, 'api.cognitive.microsofttranslator.com');
    assert.equal(options.headers['Ocp-Apim-Subscription-Region'], undefined);
    assert.equal(JSON.parse(options.body)[0].Text, 'create (verb)\nTo bring into existence.');
    return success([{ translations: [{ to: 'zh-Hans', text: '甲' }] }, { translations: [{ to: 'zh-Hans', text: '乙' }] }]);
  });
  const result = await azureTranslate(tr, [task('a'), task('b')]);
  assert.deepEqual(result.map(r => [r.sense_id, r.text]), [['a', '甲'], ['b', '乙']]);
});
test('Express uses API key header, structured schema, cache and persisted RPM spacing', async () => {
  let calls = 0;
  const tr = fakeTransport(async (url, options) => {
    calls++; assert.equal(url, 'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3-flash-preview:generateContent');
    assert.ok(!url.includes('test-google-secret')); assert.equal(options.headers['x-goog-api-key'], 'test-google-secret');
    const body = JSON.parse(options.body); assert.equal(body.generationConfig.responseMimeType, 'application/json'); assert.ok(body.generationConfig.responseSchema);
    return success({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ results: [draft('a')] }) }] } }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 40, totalTokenCount: 70 }, modelVersion: 'gemini-3-flash-preview' });
  });
  const inputs = [generationInput(task('a'))];
  await geminiCall(tr, 'generate', inputs); await geminiCall(tr, 'generate', inputs);
  await geminiCall(tr, 'generate', inputs, 'new');
  assert.equal(calls, 2); assert.ok(tr.ledger.calls[1].startedAtMs - tr.ledger.calls[0].startedAtMs >= 7500);
  assert.ok(!readFileSync(tr.ledgerPath, 'utf8').includes('test-google-secret'));
});
test('429 retries are bounded and character budget blocks before a further call', async () => {
  let calls = 0;
  const tr = fakeTransport(async () => { calls++; return new Response('', { status: 429 }); });
  await assert.rejects(azureTranslate(tr, [task('a')]), /HTTP_429/); assert.equal(calls, 3);
  await assert.rejects(azureTranslate(tr, [task('a')]), /RETRY_LIMIT/); assert.equal(calls, 3);
  const small = fakeTransport(async () => { throw new Error('should not run'); }); small.settings.maxCharacters = 1;
  await assert.rejects(azureTranslate(small, [task('a')]), /BUDGET/);
});
test('auth failures do not retry and raw network errors cannot expose credentials', async () => {
  let calls = 0; const tr = fakeTransport(async () => { calls++; return new Response('private error', { status: 401 }); });
  await assert.rejects(azureTranslate(tr, [task('a')]), /HTTP_401/); assert.equal(calls, 1);
  const fail = fakeTransport(async () => { throw new Error('secret in network error'); });
  await assert.rejects(azureTranslate(fail, [task('a')]), { message: 'AZURE_NETWORK_ERROR' });
});
test('real workflow shape with explicit mock responses resumes without repeat calls', async () => {
  let requests = 0;
  const tr = fakeTransport(async (url, options) => {
    requests++; const body = JSON.parse(options.body);
    if (url.includes('microsoft')) return success([{ translations: [{ to: 'zh-Hans', text: '使产生' }] }]);
    const comparing = body.systemInstruction.parts[0].text.includes('Compare Azure');
    return success({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ results: [comparing ? comparison('a') : draft('a')] }) }] } }], usageMetadata: { totalTokenCount: 100 } });
  });
  const t = task('a'), job = { tasks: [t] }; await processTasks(job, [t], tr, () => {});
  assert.equal(t.status, 'needs_review'); assert.equal(requests, 2); const before = digest(t.gemini);
  await processTasks(job, [t], tr, () => {}); assert.equal(requests, 2); assert.equal(digest(t.gemini), before);
});

test('known unsupported background and repetitive glosses cannot auto pass', () => {
  const t = task('a'); t.azure = { text: '创造' }; t.gemini = { ...draft('a'), explanation: '指上帝从无中创造万物（ex nihilo）。' };
  assert.equal(qualityGate(t, comparison('a')).status, 'needs_review');
  t.gemini = { ...draft('a'), glosses: ['引起引起'] };
  assert.ok(qualityGate(t, comparison('a')).flags.includes('repeated_gloss_fragment'));
});
test('human acceptance is bound to exact reviewed content and cannot overwrite accepted senses', () => {
  const t = { ...task('a'), jobKey: 'fixture', status: 'auto_pass', gemini: draft('a') };
  const job = { datasetVersion: 'fixture-version', tasks: [t] };
  const review = { schemaVersion: 1, datasetVersion: job.datasetVersion, reviewer: 'test user', reviewedAt: '2026-11-14T15:00:00Z', items: [{ sense_id: 'a', expectedHash: acceptanceHash(t), decision: 'user_accepted', glosses: t.gemini.glosses, explanation: t.gemini.explanation, manualCorrection: false }] };
  assert.equal(validateAcceptance(job, review), review);
  review.items[0].glosses = ['用户修正']; assert.throws(() => validateAcceptance(job, review), /CORRECTION/);
  review.items[0].manualCorrection = true; validateAcceptance(job, review);
  t.gemini.explanation = '内容已经改变'; assert.throws(() => validateAcceptance(job, review), /STALE/);
  review.items[0].expectedHash = acceptanceHash(t); t.status = 'user_accepted'; assert.throws(() => validateAcceptance(job, review), /STALE/);
});
test('report embeds untrusted text without executable markup and never invents generated rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dictionary-report-test-'));
  const t = { ...task('a'), entry_id: 'create', jobKey: 'fixture', word: '</script><script>alert(1)</script>', accepted_content: null };
  const summary = exportReport(directory, { datasetVersion: 'fixture', tasks: [t] }, directory);
  const html = readFileSync(join(directory, 'artifacts/m3-dual/acceptance.html'), 'utf8');
  assert.ok(!html.includes('</script><script>alert(1)</script>')); assert.equal(summary.geminiSuccess, 0); assert.equal(summary.queued, 1);
});
