import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlan, makeRequest, validateDraft, validateReview, responseText, reserveCost, usageCost, hash } from './aiChinese.mjs';
import { loadFrozenInventory } from './chineseContent.ts';
const testTarget = loadFrozenInventory().registry.targets.find(t => t.target.kind === 'sense');

test('pilot excludes all 113 released senses and schedules no redundant generation', () => {
  const plan = makePlan(); assert.equal(plan.remaining, 0); assert.equal(plan.selected, 0);
  assert.ok(plan.tasks.every(t => t.sourceFingerprint.length === 64));
  assert.throws(() => makePlan(98), /1–20/);
});
test('review request uses distinct model, current sense, exact draft, no prior conversation or tools', () => {
  const target = testTarget;
  const draft = { senseId: target.target.senseId, glosses: ['测试'], explanation: '测试解释' };
  const gen = makeRequest(target, 'generate'), review = makeRequest(target, 'review', draft);
  assert.notEqual(gen.model, review.model); assert.equal(review.store, false);
  assert.deepEqual(JSON.parse(review.input).candidate, draft);
  assert.equal(review.previous_response_id, undefined); assert.equal(review.tools, undefined);
});
test('wrong sense, incomplete output, refusal or conflicting review cannot pass', () => {
  assert.throws(() => validateDraft({ senseId: 'other', glosses: ['错'], explanation: '错' }, 'target'));
  assert.throws(() => responseText({ status: 'incomplete', output: [] }));
  assert.throws(() => responseText({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }));
  assert.throws(() => validateReview({ senseId: 's', verdict: 'pass', checks: { meaning: false, pos: true, scope: true, register: true, naturalChinese: true }, rationale: 'contradiction' }, 's'));
});
test('cost reservation includes output cap and exact pricing, and text hashes change on edits', () => {
  const body = makeRequest(testTarget, 'review', {});
  assert.ok(reserveCost(body, 'review') > .0225);
  assert.equal(usageCost({ input_tokens: 1000, output_tokens: 1000 }, 'review'), .0175);
  assert.throws(() => usageCost({}, 'generate'));
  assert.notEqual(hash({ glosses: ['甲'] }), hash({ glosses: ['乙'] }));
});
