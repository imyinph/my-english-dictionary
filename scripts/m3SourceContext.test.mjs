import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { contextFromRaw } from './m3/sourceContext.mjs';
import { candidateProvenance } from './m3/acceptance.mjs';
const sense = { glosses: ['To secure a point.'], topics: ['backgammon'], raw_tags: ['generally negated'], raw_glosses: ['(backgammon) To secure a point.'], examples: [{ type: 'quotation', text: 'Not for publication.' }] };
const record = { word: 'make', lang_code: 'en', pos: 'verb', senses: [sense] };
const bytes = value => Buffer.from(JSON.stringify(value));
const task = b => ({ sense_id: 'make:test', word: 'make', pos: 'verb', english_definition: 'To secure a point.', sourceRefs: [{ extractedFileSha256: createHash('sha256').update(b).digest('hex'), referenceUrl: 'https://en.wiktionary.org/wiki/make', attribution: 'Wiktionary contributors' }] });
test('verified context recovers domains and usage without copying external quotations', () => {
  const raw = bytes(record); const context = contextFromRaw(task(raw), raw);
  assert.deepEqual(context.topics, ['backgammon']); assert.deepEqual(context.rawTags, ['generally negated']);
  assert.ok(!JSON.stringify(context).includes('Not for publication.'));
  assert.equal(context.matchingMethod, 'verified_file_hash+headword+language+POS+exact_definition');
});
test('context rejects stale files, ambiguous senses and cross-POS matches', () => {
  const raw = bytes(record);
  assert.throws(() => contextFromRaw(task(raw), bytes({ ...record, pos: 'noun' })), /HASH_MISMATCH/);
  const ambiguous = bytes({ ...record, senses: [sense, sense] });
  assert.throws(() => contextFromRaw(task(ambiguous), ambiguous), /NOT_UNIQUE/);
  assert.throws(() => contextFromRaw({ ...task(raw), pos: 'noun' }, raw), /NOT_UNIQUE/);
});

test('parent gloss repeated in child senses does not associate child context to parent', () => {
  const raw = bytes({ ...record, senses: [sense, { glosses: [sense.glosses[0], 'A narrower meaning.'], topics: ['unrelated'] }] });
  const context = contextFromRaw(task(raw), raw);
  assert.equal(context.senseIndex, 0); assert.deepEqual(context.topics, ['backgammon']);
});
test('editorial provenance retains original AI hashes and supplementary source URLs', () => {
  const result = candidateProvenance({ generationMetadata: { requestHash: 'original' }, candidateMetadata: { provider: 'codex', modelVersion: 'not-recorded', requestHash: 'edit', upstreamRequestHashes: ['review'], evidenceUrls: ['https://en.wiktionary.org/wiki/busy'] } });
  assert.match(result.provider, /Codex/); assert.deepEqual(result.hashes, ['original', 'review', 'edit']);
  assert.deepEqual(result.evidenceUrls, ['https://en.wiktionary.org/wiki/busy']);
  assert.match(result.provider, /历史 Gemini/);
  assert.match(candidateProvenance({ generationMetadata: { requestHash: 'original', provider: 'deepseek' }, candidateMetadata: { provider: 'codex', requestHash: 'edit' } }).provider, /基于 DeepSeek/);
});
