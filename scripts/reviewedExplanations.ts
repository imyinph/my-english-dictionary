import assert from 'node:assert/strict';
import type { PublishedTranslations } from '../src/domain/senseTranslation.ts';

interface ExplanationInput {
  senseId: string;
  entryId: string;
  sourceFingerprint: string;
  englishText: string;
  glosses: string[];
  version: number;
  explanation: string;
}

export interface ExplanationBatch {
  requestId: string;
  model: string;
  reviewedAt: string;
  input: ExplanationInput[];
  reviews: {senseId: string; pass: boolean; reason: string}[];
}

export function addReviewedExplanations(publication: PublishedTranslations, batches: ExplanationBatch[]) {
  const senses = new Map(publication.senses.map(record => [record.senseId, record]));
  const added = new Set<string>();
  for (const batch of batches) {
    assert.ok(batch.requestId && batch.model && Number.isFinite(Date.parse(batch.reviewedAt)));
    for (const input of batch.input) {
      const decisions = batch.reviews.filter(review => review.senseId === input.senseId);
      assert.equal(decisions.length, 1);
      const [decision] = decisions;
      if (decision.pass !== true) continue;
      const record = senses.get(input.senseId);
      assert.ok(record && record.reviewStatus === 'approved' && record.source?.type === 'dictionary' && record.translationStatus === 'complete');
      assert.ok(record.explanation === null && !added.has(input.senseId));
      const {senseId, entryId, sourceFingerprint, englishText, glosses, version} = record;
      const {explanation, ...identity} = input;
      assert.deepEqual(identity, {senseId, entryId, sourceFingerprint, englishText, glosses, version});
      assert.ok(explanation.trim() && decision.reason.trim());
      senses.set(senseId, {...record, explanation, explanationReview: {
        status: 'ai_approved', revision: 1, requestId: batch.requestId, model: batch.model,
      }});
      added.add(senseId);
    }
  }
  assert.equal(added.size, 3);
  return {...publication, senses: [...senses.values()]};
}
