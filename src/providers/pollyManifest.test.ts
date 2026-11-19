import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPollyPlan } from '../../scripts/pollyPlan.ts';
import { createPollyManifestLoader, parsePollyManifest } from './pollyManifest.ts';
import { ManifestAudioResolver } from './audioResolver.ts';

const plan = () => ({ schemaVersion: 1 as const, resources: loadPollyPlan().resources });
test('production manifest rejects wrong engines, voices, unsafe assets and duplicate identities', () => {
  const m = plan(), r = m.resources[0];
  assert.equal(parsePollyManifest(m).resources.length, 210);
  for (const patch of [{ model: 'standard' }, { voice: 'Amy' }, { targets: [] }, { generation: null }, { locale: 'en-GB' }, { generation: { status: 'ready' }, asset: { path: '../bad.mp3', bytes: 2, sha256: 'a'.repeat(64), format: 'mp3' } }]) {
    assert.throws(() => parsePollyManifest({ ...m, resources: [{ ...r, ...patch }] }));
  }
  assert.throws(() => parsePollyManifest({ ...m, resources: [r, r] }));
});
test('manifest fetch is shared and retries after malformed response or network failure', async () => {
  let calls = 0;
  const load = createPollyManifestLoader(async () => { calls++; if (calls === 1) throw new Error('network'); if (calls === 2) return {}; return plan(); });
  await assert.rejects(load()); await assert.rejects(load());
  const [a, b] = await Promise.all([load(), load()]); assert.equal(a, b); assert.equal(calls, 3);
  assert.equal(await load(), a); assert.equal(calls, 3);
});
test('production selection preserves voice, aliases, exact text, sense and prefixed hosting paths', () => {
  const m = plan();
  for (const r of m.resources) { r.generation.status = 'ready'; r.asset = { path: `audio/polly/en-US/neural/${r.voice.toLowerCase()}/${r.id}.mp3`, bytes: 300, format: 'mp3', sha256: 'a'.repeat(64) }; }
  const r = m.resources[0], resolver = new ManifestAudioResolver(m, 'https://example.test/dictionary/');
  assert.match(resolver.resolve(r.target, 'en-US', 'Joanna', r.text)[0].urls[0], /\/dictionary\/audio\/polly\/en-US\/neural\/joanna\//);
  assert.match(resolver.resolve(r.target, 'en-US', 'Stephen', r.text)[0].urls[0], /\/stephen\//);
  assert.equal(resolver.resolve(r.target, 'en-US', 'Joanna', 'changed text').length, 0);
  assert.equal(resolver.resolve({ ...r.target, senseId: 'another' }, 'en-US', 'Joanna', r.text).length, 0);
  r.targets!.push({ ...r.target, contentId: 'alias' });
  assert.equal(resolver.resolve({ ...r.target, contentId: 'alias' }, 'en-US', 'Joanna', r.text).length, 1);
  r.review.status = 'rejected'; assert.equal(resolver.resolve(r.target, 'en-US', 'Joanna', r.text).length, 0);
});
