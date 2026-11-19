import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlan, sha256, synthesisBody } from './audio-plan.mjs';
import { estimate, isMp3, synthesize, verifiedAsset, main } from './generate-audition.mjs';

const plan = buildPlan();
test('audition is bounded; all voice/locale/heteronym identities are unique and unapproved', () => {
  assert.equal(plan.samples.length, 12); assert.equal(plan.resources.length, 96);
  assert.equal(new Set(plan.resources.map(r => r.id)).size, 96);
  assert.equal(plan.samples.filter(s => s.target.kind === 'diagnostic').length, 6);
  assert.ok(plan.resources.every(r => r.review.status === 'pending' && !r.asset && r.voiceVersion === null && r.voice.startsWith(r.locale)));
  const records = plan.resources.filter(r => r.text === 'record');
  assert.equal(new Set(records.map(r => r.target.pronunciationId)).size, 2);
  assert.ok(plan.samples.filter(s => s.target.kind === 'example').every(s => s.target.senseId && s.source.referenceUrl && s.source.licenseUrl));
});
test('request recipes preserve regional IPA, text and explicit MP3 output', () => {
  const sample = plan.samples.find(s => s.id === 'diagnostic:record-noun');
  const azure = plan.resources.find(r => r.target.contentId === sample.id && r.locale === 'en-GB' && r.provider === 'azure');
  const google = plan.resources.find(r => r.target.contentId === sample.id && r.locale === 'en-US' && r.provider === 'google');
  assert.match(synthesisBody(azure, sample), /ˈrɛkɔːd/);
  assert.match(synthesisBody(google, sample).input.ssml, /ˈrɛkɚd/);
  assert.equal(synthesisBody(google, sample).audioConfig.audioEncoding, 'MP3');
  const sentence = plan.samples.find(s => s.target.kind === 'example');
  assert.equal(synthesisBody({ ...google, text: sentence.text }, sentence).input.text, sentence.text);
});
test('missing credentials fail before network and API errors never include response secrets', async () => {
  let requests = 0;
  const resource = plan.resources[0], sample = plan.samples[0];
  await assert.rejects(synthesize(resource, sample, {}, async () => { requests++; }), /Configure/);
  assert.equal(requests, 0);
  await assert.rejects(synthesize(resource, sample, { AZURE_SPEECH_KEY: 'test-only', AZURE_SPEECH_REGION: 'eastus', AZURE_SPEECH_TIER: 'S0' }, async () => new Response('secret provider detail', { status: 401 })), error => error.message === 'HTTP 401' && !error.retryable);
  await assert.rejects(synthesize(resource, sample, { AZURE_SPEECH_KEY: 'test-only', AZURE_SPEECH_REGION: 'eastus', AZURE_SPEECH_TIER: 'S0' }, async () => new Response('', { status: 429, headers: { 'retry-after': '60' } })), error => error.retryable && error.retryAfter === 60);
});
test('both provider adapters decode and validate MP3 without live calls', async () => {
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)]); // Test bytes, never published as an audio sample.
  const azure = plan.resources[0], google = plan.resources.find(r => r.provider === 'google');
  const a = await synthesize(azure, plan.samples[0], { AZURE_SPEECH_KEY: 'test-only', AZURE_SPEECH_REGION: 'eastus', AZURE_SPEECH_TIER: 'S0' }, async (_url, request) => { assert.equal(request.headers['X-Microsoft-OutputFormat'], 'audio-24khz-96kbitrate-mono-mp3'); return new Response(mp3); });
  const g = await synthesize(google, plan.samples[0], { GOOGLE_ACCESS_TOKEN: 'test-only', GOOGLE_CLOUD_PROJECT: 'test-project' }, async (_url, request) => { assert.equal(JSON.parse(request.body).voice.languageCode, 'en-US'); return Response.json({ audioContent: mp3.toString('base64') }); });
  assert.deepEqual(a, g); assert.ok(isMp3(a)); assert.equal(isMp3(Buffer.from('<html>error</html>')), false);
});
test('dedupe checks file length and SHA-256, not just a ready flag', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dictionary-audio-test-'));
  try {
    const bytes = Buffer.from('fixture only'), checksum = sha256(bytes), path = `audio/audition/${checksum}.mp3`;
    mkdirSync(join(directory, 'audio/audition'), { recursive: true }); writeFileSync(join(directory, path), bytes);
    const resource = { asset: { path, sha256: checksum, bytes: bytes.length } };
    assert.equal(verifiedAsset(resource, directory), true);
    writeFileSync(join(directory, path), 'corrupt'); assert.equal(verifiedAsset(resource, directory), false);
    assert.equal(verifiedAsset({ asset: { ...resource.asset, path: '../secret' } }, directory), false);
  } finally { rmSync(directory, { recursive: true }); }
});
test('cost reserves all three attempts and CLI rejects bulk or invalid limits', async () => {
  const value = estimate(plan.resources.slice(0, 2), plan.samples, 15);
  assert.equal(value.jobs, 2); assert.equal(value.threeAttemptsUsd, value.conservativeCharacters * 45 / 1e6);
  for (const args of [['--limit','97'], ['--limit','NaN'], ['--budget-usd','2'], ['--generate'], ['--provider','invalid']]) await assert.rejects(main(args));
});
