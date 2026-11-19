import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepseekConfig, DeepSeekTransport, deepseekBody, remainingScope } from './m3/deepseek.mjs';
import { generationInput } from './m3/model.mjs';
import { processTasks } from './m3/pipeline.mjs';
import { candidateProvenance } from './m3/acceptance.mjs';

const task = id => ({ sense_id: id, word: 'make', pos: 'verb', english_definition: 'To write or compose.', examples: ['He made a will.'], tags: [], adjacent_senses: [], ecdict_candidates: [], azure: { text: '撰写' }, gemini: null, status: 'queued', events: [], quality_flags: [] });
const draft = id => ({ sense_id: id, pos: 'verb', english_definition: 'To write or compose.', glosses: ['撰写'], explanation: '指写成或创作文字内容。', confidence: .9, uncertainties: [] });
const settings = () => deepseekConfig({ DEEPSEEK_API_KEY: 'test-deepseek-secret' });
const reply = data => new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }], usage: { total_tokens: 100 } }), { status: 200 });
const transport = fetcher => new DeepSeekTransport(settings(), mkdtempSync(join(tmpdir(), 'dictionary-deepseek-')), { fetcher, wait: async () => {}, now: () => 100000 });

function retryTransport(fetcher, retries = 6) {
  let clock = 100000; const waits = [];
  const tr = new DeepSeekTransport({ ...settings(), maxRetries: retries }, mkdtempSync(join(tmpdir(), 'dictionary-retries-')), { fetcher, now: () => clock, random: () => 0, wait: async ms => { waits.push(ms); clock += ms; } });
  return { tr, waits };
}
test('recheck separates reader explanation from review evidence and records its own prompt version', async () => {
  const tr = transport(async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.ok(body.messages[0].content.includes('FIELD SEPARATION'));
    assert.ok(body.messages[0].content.includes('not explanation or glosses'));
    return reply({ results: [{ sense_id: 'a', preferred: 'gemini', glosses: ['撰写'], explanation: '指写成或创作文字内容。', changes_needed: false, resolved: true, evidence: '符合 write or compose。', unresolved: [] }] });
  });
  const result = await tr.aiCall('recheck', [generationInput(task('a'))]);
  assert.equal(result.promptVersion, 'deepseek-recheck-source-bound-zh-v3');
  assert.equal(tr.ledger.calls[0].promptVersion, result.promptVersion);
});
test('recheck rejects provider comparison text in a dictionary explanation', async () => {
  const tr = transport(async () => reply({ results: [{ sense_id: 'a', preferred: 'gemini', glosses: ['撰写'], explanation: 'Azure 译文不如候选译法自然。', changes_needed: true, resolved: true, evidence: '仅为评审意见。', unresolved: [] }] }));
  await assert.rejects(tr.aiCall('recheck', [generationInput(task('a'))]), /REVIEW_COMMENTARY/);
  assert.equal(tr.ledger.calls[0].validatedData, undefined);
});
test('authorized retries honor server delay, preserve failures and reuse successful retry cache', async () => {
  let calls = 0;
  const { tr, waits } = retryTransport(async () => ++calls === 1 ? new Response(JSON.stringify({ error: { details: [{ retryDelay: '45s' }] } }), { status: 429, headers: { 'retry-after': '20' } }) : reply({ results: [draft('a')] }));
  const first = await tr.aiCall('generate', [generationInput(task('a'))]);
  const second = await tr.aiCall('generate', [generationInput(task('a'))]);
  assert.equal(calls, 2); assert.deepEqual(first, second); assert.deepEqual(waits, [45000]);
  assert.equal(tr.ledger.calls[0].status, 'failed'); assert.equal(tr.ledger.calls[1].automaticRetries, 1); assert.equal(tr.ledger.paused, undefined);
});
test('network retry cap is persisted and diagnostic codes contain no error message secrets', async () => {
  let calls = 0;
  const { tr, waits } = retryTransport(async () => { calls++; const err = new Error('test-deepseek-secret'); err.cause = { code: 'ECONNRESET' }; throw err; });
  await assert.rejects(tr.aiCall('generate', [generationInput(task('a'))]), /NETWORK/);
  assert.equal(calls, 7); assert.equal(tr.ledger.calls.at(-1).automaticRetries, 6); assert.ok(tr.ledger.paused);
  assert.equal(waits.reduce((n,v) => n+v,0), 30000 + 60000 + 120000 + 240000 + 480000 + 600000);
  assert.equal(tr.ledger.calls[0].networkError.causeCode, 'ECONNRESET'); assert.ok(!readFileSync(tr.path,'utf8').includes('test-deepseek-secret'));
});
test('authorization errors and server waits over ten minutes do not auto retry', async () => {
  for (const response of [() => new Response('{}', { status: 403 }), () => new Response('{}', { status: 429, headers: { 'retry-after': '601' } })]) {
    let calls = 0; const { tr, waits } = retryTransport(async () => { calls++; return response(); });
    await assert.rejects(tr.aiCall('generate', [generationInput(task('a'))]), /HTTP/);
    assert.equal(calls, 1); assert.equal(waits.length, 0); assert.ok(tr.ledger.paused);
  }
});
test('invalid IDs are never corrected locally and invalid-output retries stop after two retries', async () => {
  let calls = 0; const { tr } = retryTransport(async () => { calls++; return reply({ results: [draft('wrong-id')] }); });
  await assert.rejects(tr.aiCall('generate', [generationInput(task('a'))]), /SCHEMA/);
  assert.equal(calls, 3); assert.equal(tr.ledger.calls[0].validationError, 'DUPLICATE_OR_WRONG_SENSE');
  assert.ok(tr.ledger.calls.every(c => !c.validatedData));
});

test('remaining scope preserves original reviewed, failed and generated tasks while retaining resumable scope', () => {
  const base = { tasks: [task('pending'), { ...task('approved'), status: 'user_accepted' }, { ...task('failed'), status: 'failed' }, { ...task('review'), status: 'needs_review', gemini: draft('review') }] };
  const job = structuredClone(base); job.tasks[0].gemini = draft('pending'); job.tasks[0].status = 'gemini_completed';
  assert.deepEqual(remainingScope(base, job).map(t => t.sense_id), ['pending']);
  assert.throws(() => remainingScope(base, { tasks: [] }), /IDENTITY_MISMATCH/);
  job.tasks[0].status = 'user_accepted'; assert.equal(remainingScope(base, job).length, 0);
});

test('SCNet Token Plan uses its endpoint and model and refuses ordinary PAYG keys', async () => {
  const cfg = deepseekConfig({ DEEPSEEK_BASE_URL: 'https://api.scnet.cn/api/llm/v1', DEEPSEEK_API_KEY: 'sk-ordinary-key' });
  assert.equal(cfg.service, 'scnet-token-plan'); assert.equal(cfg.model, 'DeepSeek-V4.1-Flash');
  assert.equal(cfg.endpoint, 'https://api.scnet.cn/api/llm/v1/chat/completions');
  const eventCfg = deepseekConfig({ DEEPSEEK_BASE_URL: 'https://api.scnet.cn/api/llm/v1', DEEPSEEK_MODEL: 'DeepSeek-V4.1-Flash-1017-Event' });
  assert.equal(deepseekBody(eventCfg, 'generate', [generationInput(task('a'))]).model, 'DeepSeek-V4.1-Flash-1017-Event');
  assert.throws(() => deepseekConfig({ DEEPSEEK_BASE_URL: 'https://api.scnet.cn/api/llm/v1', DEEPSEEK_MODEL: 'deepseek-flash' }), /UNVERIFIED/);
  const tr = new DeepSeekTransport(cfg, mkdtempSync(join(tmpdir(), 'scnet-key-test-')), { fetcher: async () => { throw Error('must not reach network'); } });
  await assert.rejects(tr.aiCall('generate', [generationInput(task('a'))]), /TOKEN_PLAN_KEY_REQUIRED/);
  assert.equal(tr.ledger.calls.length, 0);
});

test('SCNet successful result records serving platform without exposing Token Plan key', async () => {
  const cfg = deepseekConfig({ DEEPSEEK_BASE_URL: 'https://api.scnet.cn/api/llm/v1', DEEPSEEK_API_KEY: 'sk-tp-test-secret' });
  const tr = new DeepSeekTransport(cfg, mkdtempSync(join(tmpdir(), 'scnet-result-test-')), { fetcher: async (url, options) => {
    assert.equal(url, cfg.endpoint); assert.equal(options.headers.Authorization, 'Bearer sk-tp-test-secret');
    assert.equal(JSON.parse(options.body).model, 'DeepSeek-V4.1-Flash');
    return new Response(JSON.stringify({ model: 'DeepSeek-V4.1-Flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results: [draft('a')] }) } }] }), { status: 200 });
  } });
  const result = await tr.aiCall('generate', [generationInput(task('a'))]);
  assert.equal(result.service, 'scnet-token-plan');
  const origin = candidateProvenance({ generationMetadata: { ...result } });
  assert.equal(origin.provider, 'DeepSeek · SCNet Token Plan');
  assert.ok(!readFileSync(tr.path, 'utf8').includes('sk-tp-test-secret'));
});

test('DeepSeek pins official endpoint/current models and omits web tools', () => {
  assert.equal(settings().model, 'deepseek-flash');
  assert.throws(() => deepseekConfig({ DEEPSEEK_BASE_URL: 'https://proxy.invalid' }));
  assert.throws(() => deepseekConfig({ DEEPSEEK_MODEL: 'deepseek-chat' }));
  const body = deepseekBody(settings(), 'generate', [generationInput(task('a'))]);
  assert.equal(body.tools, undefined); assert.equal(body.tool_choice, 'none');
  assert.equal(body.response_format.type, 'json_object'); assert.equal(body.thinking.type, 'disabled');
  assert.ok(body.messages[0].content.includes('1-3'));
});
test('DeepSeek generation validates and caches, sends no Google/Azure requests or credentials into logs', async () => {
  let calls = 0;
  const tr = transport(async (url, options) => {
    calls++; assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-deepseek-secret');
    assert.equal(options.redirect, 'error');
    return reply({ results: [draft('a')] });
  });
  const first = await tr.aiCall('generate', [generationInput(task('a'))]);
  const second = await tr.aiCall('generate', [generationInput(task('a'))]);
  assert.deepEqual(first, second); assert.equal(calls, 1); assert.equal(first.provider, 'deepseek');
  assert.ok(!readFileSync(tr.path, 'utf8').includes('test-deepseek-secret'));
});
test('DeepSeek 429 saves complete sanitized diagnostics and pauses without retry', async () => {
  let calls = 0;
  const tr = transport(async () => {
    calls++; return new Response(JSON.stringify({ error: { code: 429, message: 'test-deepseek-secret', details: [{ retryDelay: '60s', authorization: 'private_auth_test_value' }] } }), { status: 429, headers: { 'Retry-After': '60', 'x-request-id': 'test-request' } });
  });
  await assert.rejects(tr.aiCall('generate', [generationInput(task('a'))]), /HTTP_429/);
  await assert.rejects(tr.aiCall('generate', [generationInput(task('b'))]), /PAUSED/);
  assert.equal(calls, 1);
  const text = readFileSync(tr.path, 'utf8'), c = JSON.parse(text).calls[0];
  assert.equal(c.retryAfter, '60'); assert.deepEqual(c.retryDelay, ['60s']);
  assert.equal(c.requestIds['x-request-id'], 'test-request'); assert.ok(c.completedAt); assert.ok(c.durationMs >= 0);
  assert.ok(!text.includes('test-deepseek-secret') && !text.includes('private_auth_test_value'));
});
test('DeepSeek rejects blank output, wrong sense identity and excessive glosses', async () => {
  const wrong = transport(async () => reply({ results: [draft('other')] }));
  await assert.rejects(wrong.aiCall('generate', [generationInput(task('a'))]), /SCHEMA_INVALID/);
  const tooMany = transport(async () => reply({ results: [{ ...draft('a'), glosses: ['写','作','撰','编'] }] }));
  await assert.rejects(tooMany.aiCall('generate', [generationInput(task('a'))]), /TOO_MANY_GLOSSES/);
  const blank = transport(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '   ' } }] }), { status: 200 }));
  await assert.rejects(blank.aiCall('generate', [generationInput(task('a'))]), /EMPTY_JSON/);
});
test('existing pipeline routes generation only to DeepSeek and keeps source attribution truthful', async () => {
  let calls = 0; const tr = transport(async () => { calls++; return reply({ results: [draft('a')] }); });
  const t = task('a'); await processTasks({ tasks: [t] }, [t], tr, () => {});
  assert.equal(calls, 1); assert.equal(t.status, 'needs_review');
  assert.equal(t.generationMetadata.provider, 'deepseek');
  assert.equal(candidateProvenance(t).provider, 'DeepSeek');
  assert.equal(candidateProvenance({ generationMetadata: { modelVersion: 'gemini-3-flash-preview', requestHash: 'old' } }).provider, 'Google Gemini Express');
  const mixed = candidateProvenance({ generationMetadata: { modelVersion: 'gemini-3-flash-preview', requestHash: 'old' }, candidateMetadata: { provider: 'deepseek', modelVersion: 'deepseek-flash', requestHash: 'new' } });
  assert.deepEqual(mixed.hashes, ['old', 'new']); assert.equal(mixed.provider, 'DeepSeek');
});
test('DeepSeek resolves a flagged historical draft once and preserves both provider references', async () => {
  const t = task('a'); t.gemini = { ...draft('a'), explanation: '上帝创造文字。' }; t.status = 'gemini_completed';
  t.generationMetadata = { modelVersion: 'gemini-3-flash-preview', requestHash: 'historical-google' };
  let calls = 0;
  const tr = transport(async (_url, options) => {
    calls++; const body = JSON.parse(options.body);
    assert.ok(body.messages[0].content.includes('Independently resolve'));
    assert.ok(!body.messages[1].content.includes('gemini_result'));
    return reply({ results: [{ sense_id: 'a', preferred: 'azure', glosses: ['撰写'], explanation: draft('a').explanation, changes_needed: true, resolved: true, evidence: '定义仅指 write or compose。', unresolved: [] }] });
  });
  await processTasks({ tasks: [t] }, [t], tr, () => {});
  assert.equal(calls, 1); assert.equal(t.status, 'needs_review');
  assert.equal(t.generationMetadata.requestHash, 'historical-google');
  assert.equal(t.candidateMetadata.provider, 'deepseek');
  assert.equal(candidateProvenance(t).provider, 'DeepSeek');
  assert.equal(t.original_gemini.explanation, '上帝创造文字。');
});
