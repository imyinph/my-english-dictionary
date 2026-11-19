import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadSenseHistory } from './senseTranslations.ts';
import { verifyReviewEvidence, publishSenseTranslations, applySenseReview } from './senseTranslationModel.ts';
import { verifyAiReviewEvidence } from './aiReviewEvidence.ts';
import { parsePublishedTranslations } from '../src/providers/senseTranslations.ts';

const packages = readdirSync('content/reviews').filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(`content/reviews/${f}`, 'utf8')));
const { history, inventory } = loadSenseHistory();
const pack = packages.find(p => p.items.some((i: { decision: string }) => i.decision === 'ai_approved'));
const item = pack.items[0];
const record = history.records.find(r => r.senseId === item.senseId && r.review.status === 'ai_approved')!;

test('release separates 15 human approvals from 98 AI reviews and covers every sense', () => {
  verifyReviewEvidence(history, packages);
  const publication = publishSenseTranslations(history);
  assert.equal(publication.senses.filter(s => s.reviewStatus === 'approved').length, 15);
  assert.equal(publication.senses.filter(s => s.reviewStatus === 'ai_approved').length, 98);
  assert.equal(publication.senses.filter(s => s.glosses.length === 0).length, 0);
});

test('AI evidence rejects changed candidate, stale source, unresolved review and fake human approval', () => {
  verifyAiReviewEvidence(item.aiEvidence, record);
  for (const change of [
    (e: any) => { e.candidate.glosses = ['未审核的新文本']; },
    (e: any) => { e.sourceFingerprint = '0'.repeat(64); },
    (e: any) => { e.independentReview.result.unresolved = ['ambiguity']; },
    (e: any) => { e.editorialDecision.userApproved = true; },
    (e: any) => { e.reviewedCandidate.explanation = '原复核并未看到的文本'; },
  ]) { const e = structuredClone(item.aiEvidence); change(e); assert.throws(() => verifyAiReviewEvidence(e, record), /AI review evidence/); }
});

test('build requires saved AI review evidence; repeated exact review is a no-op', () => {
  assert.equal(applySenseReview(history, pack, inventory), history);
  assert.throws(() => verifyReviewEvidence(history, packages.filter(p => p !== pack)), /evidence/);
  const changed = structuredClone(history); changed.records.find(r => r.id === record.id)!.explanation = '未审核的改动';
  assert.throws(() => verifyReviewEvidence(changed, packages), /differs/);
});

test('runtime rejects AI status for non-AI source and pending content does not leak', () => {
  const published = publishSenseTranslations(history);
  const ai = published.senses.find(s => s.reviewStatus === 'ai_approved')!;
  ai.source!.type = 'dictionary';
  assert.throws(() => parsePublishedTranslations(published), /AI 来源/);
  ai.source!.type = 'ai'; ai.reviewStatus = 'pending'; ai.translationStatus = 'candidate';
  assert.throws(() => parsePublishedTranslations(published), /未审核/);
});
