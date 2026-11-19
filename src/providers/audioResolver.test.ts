import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ManifestAudioResolver, assetUrl } from './audioResolver.ts';
import type { AudioManifest, AudioResource } from '../domain/audio.ts';
import { parseAuditionManifest } from './auditionManifest.ts';

const plan = JSON.parse(readFileSync(new URL('../../public/data/audio-audition.json', import.meta.url), 'utf8')) as AudioManifest;
const ready = (patch: Partial<AudioResource> = {}): AudioResource => ({ ...plan.resources[0], asset: { path: 'audio/audition/test.mp3', format: 'mp3', sha256: 'a'.repeat(64), bytes: 200 }, generation: { status: 'ready', attempts: 1 }, review: { status: 'approved' }, ...patch });
test('manifest parser rejects missing fields, orphan content and duplicate identities', () => {
  assert.equal(parseAuditionManifest(plan).resources.length, 96);
  for (const value of [null, {}, { ...plan, resources: [null] }, { ...plan, resources: [{ ...plan.resources[0], generation: null }] }, { ...plan, resources: [plan.resources[0], plan.resources[0]] }, { ...plan, resources: [{ ...plan.resources[0], text: 'wrong content' }] }]) assert.throws(() => parseAuditionManifest(value));
});
test('unreviewed audition files never resolve in dictionary; audition can play a generated candidate', () => {
  const r = ready({ review: { status: 'pending' } });
  const resolver = new ManifestAudioResolver({ schemaVersion: 1, resources: [r] }, 'https://site.example/app/');
  assert.equal(resolver.resolve(r.target, r.locale).length, 0);
  assert.equal(resolver.audition(r)?.urls[0], 'https://site.example/app/audio/audition/test.mp3');
  assert.equal(resolver.audition(ready({ review: { status: 'rejected' } })), undefined);
  assert.equal(resolver.audition(ready({ asset: undefined, generation: { status: 'planned', attempts: 0 } })), undefined);
});
test('same spelling never merges locale, pronunciation, sense or content kind', () => {
  const r = ready(), resolver = new ManifestAudioResolver({ schemaVersion: 1, resources: [r] }, 'https://site.example/');
  assert.equal(resolver.resolve(r.target, 'en-US').length, 1);
  assert.equal(resolver.resolve(r.target, 'en-GB').length, 0);
  for (const patch of [{ pronunciationId: 'other' }, { senseId: 'other' }, { contentId: 'other' }, { kind: 'phrase' as const }]) assert.equal(resolver.resolve({ ...r.target, ...patch }, 'en-US').length, 0);
});
test('human precedes neural and an asset base change needs no detail-page change', () => {
  const neural = ready(), human = ready({ source: 'human', id: 'human', provider: 'Commons' });
  const resolver = new ManifestAudioResolver({ schemaVersion: 1, resources: [neural, human] }, 'https://audio.example/r2/');
  const values = resolver.resolve(human.target, 'en-US');
  assert.equal(values[0].source, 'human'); assert.match(values[1].urls[0], /^https:\/\/audio.example\/r2\//);
});
test('invalid checksum metadata, paths and protocols fail closed', () => {
  const resolver = new ManifestAudioResolver({ schemaVersion: 1, resources: [] }, 'https://site.example/');
  assert.equal(resolver.audition(ready({ asset: { path: '../secret.mp3', format: 'mp3', sha256: 'a'.repeat(64), bytes: 4 } })), undefined);
  assert.equal(resolver.audition(ready({ asset: { path: 'audio/test.mp3', format: 'mp3', sha256: '', bytes: 4 } })), undefined);
  for (const path of ['../a.mp3', 'https://evil.test/a.mp3', '/a.mp3', 'a\\b.mp3', 'a%2f.mp3']) assert.throws(() => assetUrl(path, 'https://site.example/'));
  assert.throws(() => assetUrl('a.mp3', 'file:///tmp/'));
});
