import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addReviewedExplanations } from './reviewedExplanations.ts';
import { publishSenseTranslations } from './senseTranslationModel.ts';
import { loadSenseHistory } from './senseTranslations.ts';

test('supplemental explanation review binds to the approved gloss, source fingerprint and exact sense', () => {
  const {history} = loadSenseHistory();
  const base = publishSenseTranslations(history);
  const reviews = JSON.parse(readFileSync('content/reviews/explanations-v1.json', 'utf8'));
  const published = addReviewedExplanations(base, reviews);
  const additions = published.senses.filter(record => record.explanationReview);
  assert.equal(additions.length, 3);
  for (const record of additions) {
    const original = base.senses.find(sense => sense.senseId === record.senseId)!;
    const {explanationReview, explanation, ...unchanged} = record;
    assert.equal(explanationReview?.status, 'ai_approved');
    assert.ok(explanation);
    assert.deepEqual({...unchanged, explanation:null}, original);
  }
  for (const key of ['senseId', 'sourceFingerprint', 'glosses', 'version']) {
    const altered = structuredClone(reviews);
    const input = altered[0].input[0];
    input[key] = key === 'glosses' ? ['过期简释'] : 'stale';
    assert.throws(() => addReviewedExplanations(base, altered));
  }
});
