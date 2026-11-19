import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSamples, verifySamples } from './chineseSamples.ts';
import { canPreviewSample, parseSamplePublication } from '../src/domain/chineseSamples.ts';
const read = (path: string) => JSON.parse(readFileSync(new URL(`../content/${path}`, import.meta.url), 'utf8'));
const drafts = () => read('m33-samples.json');
const reviews = () => read('m33-sample-reviews.json');

test('all 12 real contexts match frozen English and retain separate review statuses', () => {
  const data = buildSamples();
  assert.equal(data.records.length, 12);
  assert.equal(data.reviewer.independentReview, 'pending');
  assert.equal(data.reviewer.humanReview, 'approved');
  assert.ok(data.records.every(canPreviewSample));
  verifySamples();
});
test('changed Chinese cannot reuse a previous review', () => {
  const changed = drafts(); changed.records[0].glosses = ['毁灭'];
  assert.throws(() => buildSamples(changed, reviews()), /stale review/);
});
test('wrong sense, POS, examples or source cannot be attached to a draft', () => {
  for (const mutate of [
    (r: any) => { r.entryId = 'destroy'; },
    (r: any) => { r.context.partOfSpeech = 'noun'; },
    (r: any) => { r.context.examples.push('invented'); },
    (r: any) => { r.sourceFingerprint = '0'.repeat(64); },
  ]) { const value = drafts(); mutate(value.records[0]); assert.throws(() => buildSamples(value, reviews()), /frozen English/); }
});
test('scope cannot grow or silently claim independent/human review', () => {
  const expanded = drafts(); expanded.records.push(expanded.records[0]);
  assert.throws(() => buildSamples(expanded, reviews()), /12 distinct/);
  const forged = reviews(); forged.reviewer.humanReview = 'approved';
  assert.throws(() => buildSamples(drafts(), forged), /approval/);
});
test('disputed/rejected text remains excluded from preview', () => {
  for (const status of ['needs_review', 'rejected'] as const) {
    const record = buildSamples().records[0]; record.review.status = status;
    assert.equal(canPreviewSample(record), false);
  }
});
test('runtime rejects malformed records and misleading reviewer labels', () => {
  assert.equal(parseSamplePublication(buildSamples()).records.length, 12);
  for (const mutate of [
    (v: any) => { v.records[0] = null; },
    (v: any) => { v.records[0].sourceRefs[0].referenceUrl = 'javascript:alert(1)'; },
    (v: any) => { v.reviewer.independentReview = 'approved'; },
  ]) { const value = buildSamples(); mutate(value); assert.throws(() => parseSamplePublication(value)); }
});
