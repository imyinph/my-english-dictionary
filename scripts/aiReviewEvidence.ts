import { isDeepStrictEqual } from 'node:util';
import { contentSha256 } from './chineseContentModel.ts';
import type { SenseTranslation } from '../src/domain/senseTranslation.ts';

export const AI_REVIEWER = 'AI: Codex editorial + DeepSeek independent review';
const row = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const hash = (v: unknown) => contentSha256(JSON.stringify(v));
function check(value: unknown): asserts value { if (!value) throw new Error('Invalid or stale AI review evidence'); }

/** Audit saved model review and final editorial decision separately; never assert human approval. */
export function verifyAiReviewEvidence(input: unknown, record: SenseTranslation) {
  const e = row(input), c = row(e.candidate), reviewed = row(e.reviewedCandidate);
  const r = row(e.independentReview), d = row(e.editorialDecision), context = row(e.sourceContext);
  check(record.source?.type === 'ai' && e.sourceFingerprint === record.sourceFingerprint);
  for (const candidate of [c, reviewed]) check(candidate.sense_id === record.senseId && candidate.english_definition === record.englishText && candidate.pos === record.partOfSpeech);
  check(isDeepStrictEqual(c.glosses, record.glosses) && c.explanation === record.explanation && record.glosses.length >= 1 && record.glosses.length <= 3 && record.glosses.every(g => !/[；;]/.test(g)) && record.explanation);
  check(Array.isArray(c.uncertainties) && c.uncertainties.length === 0);
  check(r.reviewer === 'DeepSeek · SCNet Token Plan' && r.model === 'DeepSeek-V4.1-Flash-1017-Event' && r.promptVersion === 'deepseek-recheck-source-bound-zh-v3' && r.userApproved === false);
  check(r.candidateHash === hash(reviewed) && /^[a-f0-9]{64}$/.test(r.requestHash) && r.result?.sense_id === record.senseId && r.result.resolved === true && r.result.unresolved?.length === 0 && r.result.evidence?.trim());
  check(context.sense_id === record.senseId && context.exactDefinition === record.englishText && /^[a-f0-9]{64}$/.test(context.rawFileSha256));
  check(d.type === 'ai_editorial_adjudication' && d.userApproved === false && d.editor === 'Codex assistant' && d.reviewedCandidateHash === r.candidateHash && d.finalCandidateHash === hash(c) && d.independentReviewRequestHash === r.requestHash);
  check(d.decision?.sense_id === record.senseId && d.decision.reason?.trim());
  const final = { ...reviewed, glosses: d.decision.glosses ?? reviewed.glosses, explanation: d.decision.explanation ?? reviewed.explanation };
  check(isDeepStrictEqual(final, c));
  check(record.source.recordIds.includes(r.requestHash) && record.source.recordIds.includes(hash(d)));
}
