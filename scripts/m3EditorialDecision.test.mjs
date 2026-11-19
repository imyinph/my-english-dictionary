import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEditorialDecision } from './m3/editorialDecision.mjs';
import { digest } from './m3/model.mjs';
import { acceptanceHash } from './m3/report.mjs';
const candidate = { sense_id:'a', pos:'verb', english_definition:'To pay.', glosses:['支付'], explanation:'指支付费用。', confidence:.8, uncertainties:[] };
function task() { return { sense_id:'a', pos:'verb', english_definition:'To pay.', status:'needs_review', gemini:structuredClone(candidate), sourceContext:{sense_id:'a',exactDefinition:'To pay.'}, candidateMetadata:{provider:'codex',requestHash:'edit'}, editorialReview:{candidateHash:digest(candidate),reviewer:'DeepSeek · SCNet Token Plan',requestHash:'review',result:{resolved:true,unresolved:[]}},editorialHistory:[],events:[] }; }
test('AI adjudication retains separate reviewed/final hashes and never invents human approval',()=>{
 const t=task();const result=applyEditorialDecision(t,{sense_id:'a',explanation:'指付出所需费用。',reason:'保留原文范围，调整措辞。'},'2026-11-17');
 assert.equal(t.status,'needs_review');assert.equal(result.status,'auto_pass');assert.equal(result.reviewOutcome.userApproved,false);
 assert.notEqual(result.editorialDecision.reviewedCandidateHash,result.editorialDecision.finalCandidateHash);
 assert.ok(result.candidateMetadata.upstreamRequestHashes.includes('review'));
});
test('stale, unresolved, mismatched and commentary-bearing editorial revisions cannot pass',()=>{
 const t=task();t.gemini.explanation='已改动';assert.throws(()=>applyEditorialDecision(t,{sense_id:'a',reason:'x'},'today'),/STALE/);
 const unresolved=task();unresolved.editorialReview.result.unresolved=['仍需证据'];assert.throws(()=>applyEditorialDecision(unresolved,{sense_id:'a',reason:'x'},'today'),/UNRESOLVED/);
 assert.throws(()=>applyEditorialDecision(task(),{sense_id:'wrong',reason:'x'},'today'),/REASON/);
 assert.throws(()=>applyEditorialDecision(task(),{sense_id:'a',explanation:'Azure 译文比较。',reason:'x'},'today'),/REVIEW_TEXT/);
 assert.throws(()=>applyEditorialDecision(task(),{sense_id:'a',glosses:['支付；承担'],reason:'x'},'today'),/GLOSS_PILE/);
});
test('acceptance hash changes when editorial evidence changes even if text is unchanged',()=>{
 const t=task();const hash=acceptanceHash(t);t.sourceContext.rawFileSha256='changed';assert.notEqual(acceptanceHash(t),hash);
});
