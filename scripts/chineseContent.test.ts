import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chineseRecordId, chineseTargetId } from '../src/domain/chineseContent.ts';
import type { ChineseContentBundle, ChineseRecord } from '../src/domain/chineseContent.ts';
import { parseKaikkiDataset } from '../src/providers/kaikkiAdapter.ts';
import { collectContentInventory, contentSha256, planIdentityReconciliation, summarizeContent, validateContentFiles, validateContentUpdate } from './chineseContentModel.ts';
import { contentDirectory, initializeContent, loadFrozenInventory, verifyContent } from './chineseContent.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshotBytes = readFileSync(join(root, 'public/data/kaikki-subset.json'));
const snapshot = JSON.parse(snapshotBytes.toString());
const inventory = loadFrozenInventory();
const fresh = () => structuredClone(inventory.initialContent);
const check = (bundle: unknown) => validateContentFiles(inventory.registry, bundle, inventory);
const pointer = (path: string) => path.split('/').slice(1).reduce((value, key) => value[key], snapshot);
const draft = (bundle: ChineseContentBundle, targetKind: 'sense' | 'example' = 'sense') => {
  const seed = bundle.records.find(item => item.status === 'unavailable' && item.target.kind === targetKind)!;
  const record: ChineseRecord = {
    ...structuredClone(seed), id: chineseRecordId(seed.target, 2), revision: 2,
    chineseText: '仅供自动化测试的草稿，不是生产译文。', status: 'ai_draft', origin: 'ai', reason: 'Test fixture only',
    generator: { provider: 'test-double', model: 'fixture', promptVersion: 'test-v1', jobId: 'test-job', generatedAt: seed.updatedAt },
  };
  bundle.records.push(record); bundle.contentRevision = 2;
  bundle.currentRecordIds[bundle.currentRecordIds.indexOf(seed.id)] = record.id;
  return record;
};

test('M3 initial migration registers all targets without pretending missing Chinese is complete', () => {
  const report = summarizeContent(inventory, check(fresh()));
  assert.deepEqual([report.entries, report.senses, report.examples, report.statusTargets, report.reliableTranslations], [10, 113, 95, 208, 3]);
  assert.deepEqual(report.statuses, { source_verified: 3, human_reviewed: 0, ai_draft: 0, needs_review: 0, unavailable: 205 });
  assert.equal(report.missingTargetIds.length, 205);
  assert.deepEqual(report.sourceCandidates, { total: 33, exactUnique: 4, unmatched: 29, ambiguous: 0 });
  assert.deepEqual(fresh().records.filter(item => item.status === 'source_verified').map(item => item.chineseText), ['創作品 /创作品', '造物主', '使；使得']);
});

test('M3 source references address real snapshot rows, preserve attribution and original Chinese', () => {
  for (const identity of inventory.registry.targets) {
    for (const ref of identity.englishSourceRefs) {
      assert.equal(ref.snapshotSha256, contentSha256(snapshotBytes));
      const original = pointer(ref.jsonPointer);
      assert.equal(identity.target.kind === 'sense' ? original.at(-1) : original.text, identity.englishText);
    }
  }
  for (const record of fresh().records.filter(item => item.origin === 'source')) {
    assert.equal([...new Set(record.sourceRefs.map(ref => pointer(ref.jsonPointer).word))].join('；'), record.chineseText);
    assert.equal(record.review, null);
    for (const ref of record.sourceRefs) {
      assert.equal(ref.license, 'CC BY-SA 4.0'); assert.match(ref.licenseUrl, /^https:\/\/creativecommons.org\//u);
      assert.ok(ref.attribution.includes('Wiktionary'));
    }
  }
});

test('M3 observer preserves every current dictionary ID and runtime field', () => {
  const seen: string[] = [];
  const entries = parseKaikkiDataset(snapshot, sense => seen.push(sense.id));
  assert.deepEqual(entries, parseKaikkiDataset(snapshot));
  assert.deepEqual(seen, inventory.registry.targets.filter(item => item.target.kind === 'sense').map(item => item.target.senseId));
});

test('M3 staged reconciliation retains all 208 identities after record and sense reordering', () => {
  for (const reorder of [
    (data: typeof snapshot) => data.records.reverse(),
    (data: typeof snapshot) => data.records.forEach((record: { senses: unknown[] }) => record.senses.reverse()),
  ]) {
    const changed = structuredClone(snapshot); reorder(changed);
    const incoming = collectContentInventory(JSON.stringify(changed), fresh().records[0].updatedAt).registry;
    const plan = planIdentityReconciliation(inventory.registry, incoming);
    assert.equal(plan.mappings.length, 208); assert.deepEqual(plan.unresolved, []); assert.deepEqual(plan.orphaned, []);
    assert.ok(plan.mappings.some(mapping => chineseTargetId(mapping.incomingTarget) !== chineseTargetId(mapping.retainedTarget)));
    assert.deepEqual(new Set(plan.mappings.map(mapping => chineseTargetId(mapping.retainedTarget))), new Set(inventory.registry.targets.map(item => chineseTargetId(item.target))));
  }
});

test('M3 content changes and duplicate contexts require reconciliation instead of guessing', () => {
  const changed = structuredClone(snapshot); changed.records[0].senses[0].glosses[0] += ' Changed.';
  const incoming = collectContentInventory(JSON.stringify(changed), fresh().records[0].updatedAt).registry;
  const plan = planIdentityReconciliation(inventory.registry, incoming);
  assert.ok(plan.unresolved.length > 0); assert.ok(plan.orphaned.length > 0);
  const duplicate = structuredClone(inventory.registry); duplicate.targets.push(structuredClone(duplicate.targets[0]));
  assert.ok(planIdentityReconciliation(inventory.registry, duplicate).unresolved.some(item => item.reason === 'ambiguous'));
});

test('M3 same spelling and example text cannot cross part of speech or sense context', () => {
  const fixture = { ...snapshot, records: [
    { word: 'create', lang_code: 'en', pos: 'verb', translations: [{ code: 'zh', word: '测试中文', sense: 'Test definition' }], senses: [{ glosses: ['Test definition.'], examples: [{ type: 'example', text: 'Test sentence.' }] }] },
    { word: 'create', lang_code: 'en', pos: 'noun', senses: [{ glosses: ['Test definition.'], examples: [{ type: 'example', text: 'Test sentence.' }] }] },
  ] };
  const data = collectContentInventory(JSON.stringify(fixture), fresh().records[0].updatedAt);
  assert.equal(data.initialContent.records.filter(item => item.status === 'source_verified').length, 1);
  assert.equal(data.initialContent.records.find(item => item.context.partOfSpeech === 'noun')!.status, 'unavailable');
  assert.equal(new Set(data.registry.targets.map(item => item.sourceFingerprint)).size, 4);
  fixture.records[0].senses.push({ glosses: ['Parent context.', 'Test definition.'], examples: [] });
  const ambiguous = collectContentInventory(JSON.stringify(fixture), fresh().records[0].updatedAt);
  assert.equal(ambiguous.initialContent.records.filter(item => item.status === 'needs_review').length, 2);
  assert.equal(ambiguous.initialContent.records.filter(item => item.publication === 'released').length, 0);
});

test('M3 rejects wrong parent, stale English, missing status coverage and duplicate selection', () => {
  for (const mutate of [
    (bundle: ChineseContentBundle) => { bundle.records[1].target.senseId = bundle.records[2].target.senseId; },
    (bundle: ChineseContentBundle) => { bundle.records[0].englishText += ' Changed'; },
    (bundle: ChineseContentBundle) => { bundle.records[0].context.partOfSpeech = 'noun'; },
    (bundle: ChineseContentBundle) => { bundle.currentRecordIds.pop(); },
    (bundle: ChineseContentBundle) => { bundle.currentRecordIds[1] = bundle.currentRecordIds[0]; },
    (bundle: ChineseContentBundle) => { bundle.dictionaryVersion = '0'.repeat(64); },
  ]) { const bundle = fresh(); mutate(bundle); assert.throws(() => check(bundle)); }
});

test('M3 draft requires provenance and cannot be published or claim Wiktionary', () => {
  const bundle = fresh(); const record = draft(bundle, 'example'); check(bundle);
  record.publication = 'released'; assert.throws(() => check(bundle), /Unreviewed/u); record.publication = 'draft';
  record.sourceRefs = fresh().records.find(item => item.origin === 'source')!.sourceRefs;
  assert.throws(() => check(bundle), /cannot claim dictionary/u); record.sourceRefs = [];
  record.generator = null; assert.throws(() => check(bundle), /generator/u);
});

test('M3 human approval preserves AI origin and immutable original revision', () => {
  const bundle = fresh(); const record = draft(bundle);
  record.status = 'human_reviewed'; record.publication = 'released';
  assert.throws(() => check(bundle), /approval/u);
  record.review = { reviewer: 'test-reviewer', reviewedAt: record.updatedAt, decision: 'approved' };
  check(bundle); assert.equal(record.origin, 'ai'); assert.equal(bundle.records[0].chineseText, null);
  record.review.decision = 'rejected'; assert.throws(() => check(bundle), /Rejected/u);
});

test('M3 original source, empty strings, forged origins and unknown schemas fail closed', () => {
  for (const mutate of [
    (bundle: ChineseContentBundle) => { bundle.records.find(item => item.origin === 'source')!.chineseText = '篡改原来源'; },
    (bundle: ChineseContentBundle) => { bundle.records[0].chineseText = ''; },
    (bundle: ChineseContentBundle) => { const record = draft(bundle); record.status = 'source_verified'; record.origin = 'source'; record.generator = null; },
    (bundle: ChineseContentBundle) => { Object.assign(bundle, { schemaVersion: 2 }); },
    (bundle: ChineseContentBundle) => { Object.assign(bundle.records[0], { unexpectedField: 'must reject' }); },
  ]) { const bundle = fresh(); mutate(bundle); assert.throws(() => check(bundle)); }
});

test('M3 revision history cannot be silently overwritten, skipped or backdated', () => {
  for (const mutate of [
    (bundle: ChineseContentBundle, record: ChineseRecord) => { bundle.contentRevision = 1; void record; },
    (_bundle: ChineseContentBundle, record: ChineseRecord) => { record.revision = 3; record.id = chineseRecordId(record.target, 3); },
    (_bundle: ChineseContentBundle, record: ChineseRecord) => { record.updatedAt = '2020-01-01T00:00:00Z'; },
    (bundle: ChineseContentBundle) => { bundle.records[0].reason = 'Overwrite initial history'; },
  ]) { const bundle = fresh(); const record = draft(bundle); mutate(bundle, record); assert.throws(() => check(bundle)); }
});

function isolatedRoot() {
  // Test data only; kept in OS temp for failure inspection, never deletes user directories.
  const temporary = mkdtempSync(join(tmpdir(), 'dictionary-m3-content-test-'));
  for (const relative of ['config/m3-content-baseline.json', 'public/data/kaikki-subset.json', 'public/data/audio-manifest.json']) {
    const destination = join(temporary, relative); mkdirSync(dirname(destination), { recursive: true }); cpSync(join(root, relative), destination);
  }
  return temporary;
}

test('M3 update validation protects all existing revisions, including non-source drafts', () => {
  const original = fresh(); const proposed = fresh(); draft(proposed);
  validateContentUpdate(original, proposed, inventory);
  validateContentUpdate(proposed, structuredClone(proposed), inventory);
  const overwrite = structuredClone(proposed); overwrite.contentRevision++;
  overwrite.records.at(-1)!.chineseText = 'Cannot edit an existing revision in place';
  assert.throws(() => validateContentUpdate(proposed, overwrite, inventory), /prior revision/u);
  const removed = fresh(); removed.contentRevision = 3;
  assert.throws(() => validateContentUpdate(proposed, removed, inventory), /prior revision/u);
  const unchangedVersion = structuredClone(proposed); unchangedVersion.contentRevision = 1;
  assert.throws(() => validateContentUpdate(original, unchangedVersion, inventory));
});

test('M3 initialization is idempotent and preserves later human revision history', () => {
  const temporary = isolatedRoot(); assert.equal(initializeContent(temporary).created, true);
  const path = join(temporary, 'public', contentDirectory, 'chinese-content.json');
  const bundle = fresh(); const record = draft(bundle); record.origin = 'human'; record.generator = null; record.status = 'needs_review';
  writeFileSync(path, JSON.stringify(bundle)); const before = readFileSync(path);
  assert.equal(initializeContent(temporary).created, false); assert.ok(readFileSync(path).equals(before));
  assert.equal(verifyContent(temporary).bundle.records.length, 209);
});

test('M3 failed initialization retains existing files and refuses changed M2 input', () => {
  const temporary = isolatedRoot(); initializeContent(temporary);
  const path = join(temporary, 'public', contentDirectory, 'chinese-content.json');
  writeFileSync(path, '{broken'); assert.throws(() => initializeContent(temporary)); assert.equal(readFileSync(path, 'utf8'), '{broken');
  const changed = isolatedRoot(); writeFileSync(join(changed, 'public/data/audio-manifest.json'), '{}');
  assert.throws(() => initializeContent(changed), /M2 dictionary\/audio baseline changed/u);
  assert.equal(existsSync(join(changed, 'public', contentDirectory)), false);
});

test('M3 dry-run CLI writes no content and makes no provider requests', () => {
  const files = ['public/data/kaikki-subset.json', 'public/data/audio-manifest.json', `public/${contentDirectory}/identity-registry.json`, `public/${contentDirectory}/chinese-content.json`];
  const before = files.map(file => contentSha256(readFileSync(join(root, file))));
  const result = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/chineseContent.ts'), 'scan'], { encoding: 'utf8' }));
  assert.equal(result.dryRun, true); assert.equal(result.missingTargets, 205);
  assert.equal(result.translationApiRequests, 0); assert.equal(result.pollyRequests, 0);
  assert.deepEqual(files.map(file => contentSha256(readFileSync(join(root, file)))), before);
});

test('M3 current files and M2 protected snapshots match the checked-in baseline', () => {
  verifyContent();
  assert.equal(contentSha256(snapshotBytes), '86232c6d48967970aa7203283a316f6f76879ceeea6dc4264e3f1ff923e84147');
  assert.equal(contentSha256(readFileSync(join(root, 'public/data/audio-manifest.json'))), '06181af8d2a217abcd3acbfb67c65c79d9662469f6c90a2ab4414fc95909f90e');
});
