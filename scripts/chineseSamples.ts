import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ChineseSample, SampleReview, SamplePublication } from '../src/domain/chineseSamples.ts';
import { verifyContent } from './chineseContent.ts';
import { loadSenseHistory } from './senseTranslations.ts';

const root = new URL('../', import.meta.url);
export const sampleHash = (value: ChineseSample) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export function buildSamples(drafts = read('content/m33-samples.json'), reviews = read('content/m33-sample-reviews.json')): SamplePublication {
  const { inventory } = verifyContent();
  check(drafts.schemaVersion === 1 && drafts.scope === 'sample-only' && drafts.locale === 'zh-Hans' && drafts.dictionaryVersion === inventory.registry.dictionaryVersion && drafts.batchId === 'm33-sample-12-v1', 'Wrong sample snapshot/scope');
  check(Array.isArray(drafts.records) && drafts.records.length === 12 && new Set(drafts.records.map((r: ChineseSample) => r.senseId)).size === 12, 'Exactly 12 distinct senses required');
  check(reviews.batchId === drafts.batchId && reviews.schemaVersion === 1 && reviews.reviewer.kind === 'same-agent-second-pass' && reviews.reviewer.independentReview === 'pending' && reviews.reviewer.humanReview === 'pending', 'Do not invent independent/human approval');
  check(Array.isArray(reviews.records) && reviews.records.length === 12 && new Set(reviews.records.map((r: SampleReview) => r.senseId)).size === 12, 'Review coverage mismatch');
  check(drafts.generator.provider === 'OpenAI / Codex conversation' && drafts.generator.model === 'not-exposed' && drafts.generator.promptVersion === 'm33-sense-context-v1', 'Invalid generation provenance');
  const records = drafts.records.map((r: ChineseSample) => {
    const identity = inventory.registry.targets.find(x => x.target.kind === 'sense' && x.target.senseId === r.senseId);
    check(identity && identity.target.entryId === r.entryId && identity.englishText === r.englishText && identity.sourceFingerprint === r.sourceFingerprint && isDeepStrictEqual(identity.context, r.context) && isDeepStrictEqual(identity.englishSourceRefs, r.sourceRefs), 'Sample context differs from frozen English');
    check(r.version === 1 && Array.isArray(r.glosses) && r.glosses.length >= 1 && r.glosses.length <= 4 && r.glosses.every(g => typeof g === 'string' && g.trim() && g.length <= 60) && new Set(r.glosses).size === r.glosses.length && typeof r.explanation === 'string' && r.explanation.length > 0 && r.explanation.length <= 500, 'Invalid sample text');
    const review = reviews.records.find((v: SampleReview) => v.senseId === r.senseId);
    check(review && review.contentHash === sampleHash(r) && ['self_checked', 'needs_review', 'rejected'].includes(review.status) && typeof review.rationale === 'string' && review.rationale.trim() && /^\d{4}-\d{2}-\d{2}$/.test(review.reviewedOn), 'Missing/stale review evidence');
    return { ...r, review };
  });
  const { history } = loadSenseHistory();
  const approved = records.every((sample: ChineseSample) => history.records.some(r => history.currentRecordIds.includes(r.id) && r.senseId === sample.senseId && r.review.status === 'approved' && isDeepStrictEqual(r.glosses, sample.glosses) && r.explanation === sample.explanation));
  return { ...drafts, reviewer: { ...reviews.reviewer, humanReview: approved ? 'approved' : 'pending' }, records };
}

export function verifySamples(directory = 'public') {
  const expected = buildSamples();
  check(expected.records.every(r => r.review.status === 'self_checked'), 'Unresolved samples cannot be published');
  check(isDeepStrictEqual(read(`${directory}/data/chinese-samples.json`), expected), 'Stale sample publication; run zh:samples:publish');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--publish')) {
    const data = buildSamples();
    // Text is retained in authoring for rejected records, but never shipped to the browser.
    check(data.records.every(r => r.review.status === 'self_checked'), 'Unresolved samples must remain local; resolve or version the batch');
    writeFileSync(new URL('public/data/chinese-samples.json', root), JSON.stringify(data, null, 2) + '\n');
  } else verifySamples(process.argv.includes('--dist') ? 'dist' : 'public');
  console.log(`M3.3: 12 sample contexts verified; human review: ${buildSamples().reviewer.humanReview}; independent model review pending.`);
}
