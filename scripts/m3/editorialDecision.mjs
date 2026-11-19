import { assert, digest, validateGeneration } from './model.mjs';

/** AI editorial adjudication after an independent review; never human approval/publication. */
export function applyEditorialDecision(task, decision, at) {
  const review = task.editorialReview;
  assert(task.status === 'needs_review' && task.candidateMetadata?.provider === 'codex', 'EDITORIAL_CANDIDATE_REQUIRED');
  assert(review && review.candidateHash === digest(task.gemini) && review.reviewer === 'DeepSeek · SCNet Token Plan', 'STALE_OR_WRONG_REVIEW');
  assert(review.result.resolved === true && review.result.unresolved.length === 0, 'UNRESOLVED_REVIEW_CANNOT_PASS');
  assert(task.sourceContext?.sense_id === task.sense_id && task.sourceContext.exactDefinition === task.english_definition, 'SOURCE_CONTEXT_MISMATCH');
  assert(decision.sense_id === task.sense_id && typeof decision.reason === 'string' && decision.reason.trim(), 'EDITORIAL_REASON_REQUIRED');
  const candidate = { ...task.gemini, glosses: decision.glosses ?? task.gemini.glosses, explanation: decision.explanation ?? task.gemini.explanation };
  validateGeneration({ results: [candidate] }, [task]);
  assert(candidate.glosses.length <= 3 && candidate.glosses.every(g => !/[；;]/.test(g)), 'GLOSS_PILE_NOT_ALLOWED');
  assert(!/Azure|Gemini|DeepSeek|候选|译文|译法/i.test(candidate.explanation), 'REVIEW_TEXT_IN_EXPLANATION');
  const next = structuredClone(task);
  next.editorialHistory.push({ candidate: task.gemini, metadata: task.candidateMetadata, independentReview: review, at });
  next.gemini = candidate;
  next.editorialDecision = { type: 'ai_editorial_adjudication', editor: 'Codex assistant', modelVersion: 'not-recorded', decision, reviewedCandidateHash: review.candidateHash, finalCandidateHash: digest(candidate), independentReviewRequestHash: review.requestHash, userApproved: false, at };
  next.candidateMetadata = { ...task.candidateMetadata, requestHash: digest(next.editorialDecision), upstreamRequestHashes: [...new Set([...(task.candidateMetadata.upstreamRequestHashes ?? []), task.candidateMetadata.requestHash, review.requestHash])], artifactPath: 'artifacts/m3-editorial20-decisions-20261117.json', receivedAt: at };
  next.reviewOutcome = { status: 'ai_editorial_review_passed', basis: 'verified_source_context+DeepSeek_review+Codex_adjudication', userApproved: false, finalCandidateHash: digest(candidate), at };
  next.status = 'auto_pass'; next.translation_status = 'candidate'; next.quality_flags = [];
  next.events.push({ type: 'ai_editorial_adjudication', decisionHash: next.candidateMetadata.requestHash, at });
  next.updated_at = at;
  return next;
}
