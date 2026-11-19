import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert } from './model.mjs';

/** Recover context from the exact original download, without changing shipped English. */
export function contextFromRaw(task, bytes) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert(task.sourceRefs?.some(r => r.extractedFileSha256 === sha256), 'RAW_SOURCE_HASH_MISMATCH');
  const pos = { adjective: 'adj', adverb: 'adv' }[task.pos] ?? task.pos;
  const records = bytes.toString('utf8').split(/\r?\n/).filter(s => s.trim()).map(s => JSON.parse(s));
  const matches = records.flatMap((r, recordIndex) => r.word === task.word && r.lang_code === 'en' && r.pos === pos
    ? (r.senses ?? []).flatMap((s, senseIndex) => s.glosses?.at(-1) === task.english_definition ? [{ s, recordIndex, senseIndex }] : []) : []);
  assert(matches.length === 1, 'RAW_SENSE_MATCH_NOT_UNIQUE');
  const { s, recordIndex, senseIndex } = matches[0];
  return { sense_id: task.sense_id, exactDefinition: task.english_definition, rawFileSha256: sha256, recordIndex, senseIndex, matchingMethod: 'verified_file_hash+headword+language+POS+exact_definition', rawGlosses: s.raw_glosses ?? [], topics: s.topics ?? [], rawTags: s.raw_tags ?? [], tags: s.tags ?? [], sourceSenseIds: s.senseid ?? [], externalQuotationsExcluded: true, license: 'CC BY-SA 4.0', attribution: task.sourceRefs[0].attribution, sourceUrl: task.sourceRefs[0].referenceUrl };
}
export function loadSourceContext(root, task) {
  assert(/^[a-z -]+$/.test(task.word), 'UNSAFE_SOURCE_WORD');
  return contextFromRaw(task, readFileSync(join(root, 'artifacts/import', task.word.replaceAll(' ', '-') + '.jsonl')));
}
