import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyContent } from './chineseContent.ts';

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

export function verifyExamples(bundle, batches, registry) {
  const examples = new Map();
  for (const identity of registry.targets) {
    if (identity.target.kind !== 'example') continue;
    assert.ok(identity.englishSourceRefs.length && identity.englishSourceRefs.every(ref =>
      ref.license === 'CC BY-SA 4.0' && ref.attribution && ref.referenceUrl), 'Missing licensed example source');
    assert.ok(!examples.has(identity.target.exampleId), 'Duplicate source example');
    examples.set(identity.target.exampleId, identity);
  }
  assert.equal(bundle.dictionaryVersion, registry.dictionaryVersion);
  assert.ok([1, 2].includes(bundle.revision), 'Unknown example revision');
  const byReviewId = new Map(batches.map(batch => [batch.requestId, batch]));
  assert.equal(byReviewId.size, batches.length, 'Duplicate review ID');
  const seen = new Set();
  for (const record of bundle.records) {
    const source = examples.get(record.exampleId);
    assert.ok(source && !seen.has(record.exampleId), 'Unknown or duplicate example');
    seen.add(record.exampleId);
    assert.equal(record.entryId, source.target.entryId);
    assert.equal(record.senseId, source.target.senseId);
    assert.equal(record.englishText, source.englishText);
    assert.equal(record.sourceFingerprint, source.sourceFingerprint);
    assert.equal(record.sourceUrl, source.englishSourceRefs[0].referenceUrl);
    assert.equal(record.status, 'ai_approved');
    assert.ok(record.translation.trim());
    const batch = byReviewId.get(record.reviewId);
    assert.ok(batch?.model && batch.reviewedAt, 'Missing review');
    const inputs = batch.input.filter(item => item.exampleId === record.exampleId);
    const decisions = batch.reviews.filter(item => item.exampleId === record.exampleId);
    assert.equal(inputs.length, 1);
    assert.equal(decisions.length, 1);
    assert.ok(decisions[0].pass === true && decisions[0].reason.trim(), 'Missing positive decision');
    const {entryId, senseId, exampleId, englishText, sourceFingerprint, translation} = record;
    assert.deepEqual(inputs[0], {kind:'example', entryId, senseId, exampleId, englishText,
      sourceFingerprint, translation, definition:source.context.glosses}, 'Review does not match final text and parent');
  }
  return {checked:examples.size, reviewed:seen.size, missing:examples.size-seen.size};
}

export function verifyCurrentExamples() {
  const registry = verifyContent().inventory.registry;
  const pilot = readJson('content/example-translations-v1.json');
  const pilotReviews = readJson('content/reviews/example-pilot-v1.json');
  const current = readJson('content/example-translations-v2.json');
  const reviews = readJson('content/reviews/example-closeout85.json');
  assert.equal(pilot.revision, 1);
  assert.equal(current.revision, 2);
  verifyExamples(pilot, pilotReviews, registry);
  const currentRecords = new Map(current.records.map(record => [record.exampleId, record]));
  for (const prior of pilot.records) assert.deepEqual(currentRecords.get(prior.exampleId), prior, 'Pilot sample changed');
  const counts = verifyExamples(current, [...pilotReviews, ...reviews], registry);
  assert.equal(counts.missing, 0, 'Incomplete example translations');
  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(verifyCurrentExamples());
}
