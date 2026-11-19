import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFrozenInventory } from './chineseContent.ts';
import { applySenseReview, importSenseCandidates, verifyCandidateEvidence, migrateSenseTranslations, publishSenseTranslations, validateSenseHistory, verifyReviewEvidence } from './senseTranslationModel.ts';
import { senseTranslationId } from '../src/domain/senseTranslation.ts';
import { verifyPublished } from './senseTranslations.ts';

const inventory = loadFrozenInventory();
const seed = () => migrateSenseTranslations(inventory);
function reviewPackage() {
  const history = seed();
  return { schemaVersion: 1, dictionaryVersion: history.dictionaryVersion, baseRevision: 1, reviewer: 'Explicit test reviewer', reviewedAt: '2026-11-14T05:00:00.000Z', items: history.records.filter(record => record.translationStatus === 'candidate').map(record => ({ senseId: record.senseId, expectedVersion: 1, sourceFingerprint: record.sourceFingerprint, glosses: record.glosses, explanation: record.explanation, decision: 'approved' })) };
}

test('v2 migration covers all senses, preserves English IDs and never invents approval', () => {
  const history = seed(); validateSenseHistory(history, inventory);
  assert.equal(history.records.length, 113); assert.equal(history.records.filter(record => record.translationStatus === 'candidate').length, 3);
  assert.ok(history.records.every(record => record.review.status === 'pending' && record.explanation === null));
  assert.deepEqual(migrateSenseTranslations(inventory), history);
  const published = publishSenseTranslations(history);
  assert.equal(published.senses.filter(record => record.glosses.length).length, 0);
  const revisedLegacy = structuredClone(inventory.initialContent); revisedLegacy.contentRevision = 2;
  assert.throws(() => migrateSenseTranslations(inventory, revisedLegacy), /explicit migration/u);
});

test('explicit review publishes only the exact reviewed sense and preserves all seed history', () => {
  const history = applySenseReview(seed(), reviewPackage(), inventory);
  assert.equal(history.revision, 2); assert.equal(history.records.length, 116);
  assert.deepEqual(history.records.slice(0, 113), seed().records);
  const approved = publishSenseTranslations(history).senses.filter(record => record.reviewStatus === 'approved');
  assert.equal(approved.length, 3);
  assert.deepEqual(approved.map(record => record.glosses), [['创作品'], ['造物主'], ['使', '使得']]);
  assert.ok(approved.every(record => record.source?.type === 'dictionary'));
});

test('review import is idempotent, stale versions and changed text cannot be approved', () => {
  const input = reviewPackage(), next = applySenseReview(seed(), input, inventory);
  assert.equal(applySenseReview(next, input, inventory), next);
  const altered = structuredClone(input); altered.items[0].glosses = ['Different content'];
  assert.throws(() => applySenseReview(seed(), altered, inventory), /differs/u);
  altered.items[0].glosses = input.items[0].glosses; altered.items[0].expectedVersion = 3;
  assert.throws(() => applySenseReview(seed(), altered, inventory), /mismatch/u);
  const stale = structuredClone(input); stale.reviewer = 'Another';
  assert.throws(() => applySenseReview(next, stale, inventory), /stale/u);
});

test('rejection leaves source trace, excludes content from publication and cannot turn complete', () => {
  const input = reviewPackage(); input.items.forEach(item => { item.decision = 'rejected'; });
  const history = applySenseReview(seed(), input, inventory);
  const published = publishSenseTranslations(history);
  assert.equal(published.senses.filter(record => record.reviewStatus === 'rejected').length, 3);
  assert.ok(published.senses.every(record => !record.glosses.length && record.source === null));
  history.records.at(-1)!.translationStatus = 'complete';
  assert.throws(() => validateSenseHistory(history, inventory), /explicit approval/u);
});

test('v2 rejects wrong identity, removed history, duplicate current IDs and unlicensed approval', () => {
  for (const change of [
    (history: ReturnType<typeof seed>) => { history.records[0].senseId = 'unknown'; },
    (history: ReturnType<typeof seed>) => { history.records.shift(); },
    (history: ReturnType<typeof seed>) => { history.currentRecordIds[0] = history.currentRecordIds[1]; },
    (history: ReturnType<typeof seed>) => { history.records.find(record => record.source)!.source!.licenseStatus = 'upstream_unresolved'; },
  ]) { const history = seed(); change(history); assert.throws(() => validateSenseHistory(history, inventory)); }
});

test('multiple glosses and optional reviewed explanation are supported without changing English', () => {
  // Explicit schema fixture only; no explanation is inserted into production content.
  const history = applySenseReview(seed(), reviewPackage(), inventory);
  const prior = history.records.at(-1)!;
  const next = { ...structuredClone(prior), version: 3, id: senseTranslationId(prior.senseId, 3), explanation: '测试专用解释，绝不写入正式数据。' };
  history.records.push(next); history.currentRecordIds[history.currentRecordIds.indexOf(prior.id)] = next.id; history.revision = 3;
  validateSenseHistory(history, inventory);
  const published = publishSenseTranslations(history).senses.find(record => record.senseId === next.senseId)!;
  assert.equal(published.explanation, next.explanation); assert.deepEqual(published.glosses, ['使', '使得']);
  assert.equal(published.englishText, prior.englishText);
});

test('local candidate summary can mark a missing sense pending without leaking source text', () => {
  const history = seed(); const target = history.records.find(record => record.translationStatus === 'missing')!;
  const published = publishSenseTranslations(history, new Set([target.senseId]));
  const record = published.senses.find(record => record.senseId === target.senseId)!;
  assert.equal(record.translationStatus, 'candidate'); assert.deepEqual(record.glosses, []); assert.equal(record.source, null);
});

test('real publication contains user-approved source content and 113 statuses, not ECDICT text', () => {
  const stats = verifyPublished(); assert.equal(stats.senses, 113); assert.equal(stats.approved, 15);
  const text = readFileSync(new URL('../public/data/chinese-senses.json', import.meta.url), 'utf8');
  assert.ok(!text.includes('ecdict:')); assert.ok(!text.includes('upstream_unresolved'));
});

test('publication audit rejects an old approval attached to changed Chinese text', () => {
  const review = reviewPackage(), history = applySenseReview(seed(), review, inventory);
  verifyReviewEvidence(history, [review]);
  assert.throws(() => verifyReviewEvidence(history, []), /evidence/u);
  history.records.at(-1)!.glosses = ['未经本次审核的新文本'];
  assert.throws(() => verifyReviewEvidence(history, [review]), /differs/u);
});

test('candidate import adds pending provenance and is idempotent, never overwrites source Chinese', () => {
  const history = seed(), target = history.records.find(r => r.translationStatus === 'missing')!;
  const source = JSON.parse(readFileSync(new URL('../public/data/chinese-senses.json', import.meta.url), 'utf8')).senses.find((r: { source?: { type?: string } }) => r.source?.type === 'ai').source;
  const bundle = { schemaVersion: 1, dictionaryVersion: history.dictionaryVersion, baseRevision: 1, createdAt: '2026-11-14T12:30:00Z', items: [{ senseId: target.senseId, sourceFingerprint: target.sourceFingerprint, expectedVersion: 1, glosses: ['测试候选'], explanation: '仅供测试', source }] };
  const next = importSenseCandidates(history, bundle, inventory);
  assert.equal(next.revision, 2);
  assert.equal(importSenseCandidates(next, bundle, inventory), next);
  verifyCandidateEvidence(next, [bundle]);
  assert.throws(() => verifyCandidateEvidence(next, []), /evidence/);
  assert.ok(publishSenseTranslations(next).senses.every(r => !r.glosses.length));
  const altered = structuredClone(next); altered.records.at(-1)!.explanation = 'changed';
  assert.throws(() => verifyCandidateEvidence(altered, [bundle]), /differs/);
  const original = history.records.find(r => r.source)!;
  bundle.items[0].senseId = original.senseId; bundle.items[0].sourceFingerprint = original.sourceFingerprint;
  assert.throws(() => importSenseCandidates(history, bundle, inventory), /overwrite/);
});

test('all twelve user-approved samples are published verbatim without extending approval', () => {
  const drafts = JSON.parse(readFileSync(new URL('../content/m33-samples.json', import.meta.url), 'utf8'));
  const published = JSON.parse(readFileSync(new URL('../public/data/chinese-senses.json', import.meta.url), 'utf8'));
  for (const sample of drafts.records) {
    const actual = published.senses.find((r: { senseId: string }) => r.senseId === sample.senseId);
    assert.deepEqual(actual.glosses, sample.glosses); assert.equal(actual.explanation, sample.explanation);
    assert.equal(actual.reviewStatus, 'approved'); assert.equal(actual.source.type, 'ai');
  }
  assert.equal(published.senses.filter((r: { reviewStatus: string }) => r.reviewStatus === 'approved').length, 15);
});
