import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrozenInventory } from './chineseContent.ts';
import { matchEcdict, matchingStatistics, validateEcdictIndex } from './ecdictMatching.ts';
import type { EcdictIndex } from './ecdictMatching.ts';
import { readFileSync } from 'node:fs';

const registry = loadFrozenInventory().registry;
function fixture(word = 'creatively', english = 'in a creative manner', pos = 'adverb'): EcdictIndex {
  return { schemaVersion: 1, datasetVersion: 'test-fixture', source: { name: 'ECDICT TEST DOUBLE', url: null, sha256: 'a'.repeat(64), bytes: 1, contentLicenseStatus: 'upstream_unresolved', distribution: 'local-review-only', repositoryLicense: 'fixture' }, scope: [word], index: { [word]: ['test-row-1'] }, statistics: { csvRecordsScanned: 1, invalidColumnRows: 0, blankWords: 0, selectedUniqueRecords: 1, duplicateSelectedRows: 0, selectedRecordsWithIssues: 0, duplicateScope: 'current-headwords-only' }, records: [{ recordId: 'test-row-1', word, raw: { definition: english, translation: '仅供测试' }, locator: { dataRecordNumber: 1, physicalEndLine: 2, recordSha256: 'b'.repeat(64) }, duplicateLocations: [], issues: [], bilingualAlignment: 'not_provided', upstreamRecordOrigin: 'not_provided', definitions: [{ sourceLine: 1, text: english, partOfSpeech: [pos], originalText: english }], translations: [{ sourceLine: 1, text: '仅供测试', partOfSpeech: [pos], originalText: '仅供测试' }] }] };
}

test('matcher reports all 113 identities and strong candidates always stay pending', () => {
  const index = fixture(), matches = matchEcdict(registry, index);
  assert.equal(matches.length, 113); const match = matches.find(item => item.headword === 'creatively')!;
  assert.equal(match.category, 'high_confidence_candidate'); assert.equal(match.reviewStatus, 'pending');
  assert.equal(match.candidates[0].bilingualAlignment, 'unverified');
  assert.ok(!JSON.stringify(matches).includes('仅供测试'));
  assert.equal(matchingStatistics(matches, index).automaticApprovals, 0);
});

test('word spelling and POS alone cannot generate a semantic candidate', () => {
  const matches = matchEcdict(registry, fixture('creatively', 'a table with legs', 'adverb'));
  assert.equal(matches.find(item => item.headword === 'creatively')!.category, 'no_reliable_candidate');
});

test('different POS and missing English do not borrow another sense translation', () => {
  const wrong = matchEcdict(registry, fixture('creatively', 'in a creative manner', 'noun')).find(item => item.headword === 'creatively')!;
  assert.equal(wrong.posMismatch, true); assert.deepEqual(wrong.candidates, []);
  const index = fixture('make sense', '', 'verb'); index.records[0].definitions = []; index.records[0].translations[0].partOfSpeech = [];
  const matches = matchEcdict(registry, index).filter(item => item.headword === 'make sense');
  assert.ok(matches.every(item => item.reason === 'missing_english_definition' && !item.candidates.length));
});

test('definition and translation arrays may be reordered independently without index pairing', () => {
  const index = fixture('create', 'bring into existence', 'verb');
  index.records[0].definitions.push({ sourceLine: 2, text: 'invest with a new title, office, or rank', partOfSpeech: ['verb'], originalText: 'test' });
  index.records[0].translations.push({ sourceLine: 2, text: '无对齐测试', partOfSpeech: ['verb'], originalText: 'test' });
  const before = matchEcdict(registry, index);
  index.records[0].definitions.reverse(); index.records[0].translations.reverse();
  const after = matchEcdict(registry, index);
  assert.deepEqual(after.map(item => [item.senseId, item.category, item.candidates.map(candidate => [candidate.englishSourceLine, candidate.score])]), before.map(item => [item.senseId, item.category, item.candidates.map(candidate => [candidate.englishSourceLine, candidate.score])]));
  for (const match of after.filter(item => item.candidates.length)) for (const candidate of match.candidates) assert.equal(candidate.bilingualAlignment, 'unverified');
});

test('God/person and negation conflicts cannot pass through token similarity', () => {
  const matches = matchEcdict(registry, fixture('creator', 'a person who created the world', 'noun'));
  assert.deepEqual(matches.find(item => item.englishText === 'The deity that created the world.')!.candidates, []);
  const negated = matchEcdict(registry, fixture('creatively', 'not in a creative manner', 'adverb'));
  assert.equal(negated.find(item => item.headword === 'creatively')!.category, 'no_reliable_candidate');
});

test('ambiguous multiple English definitions never become high confidence by position', () => {
  const index = fixture(); index.records[0].definitions.push({ ...index.records[0].definitions[0], sourceLine: 2 });
  const match = matchEcdict(registry, index).find(item => item.headword === 'creatively')!;
  assert.equal(match.category, 'ambiguous_candidate'); assert.equal(match.candidates[0].evidence.competingDefinitions, 2);
});

test('imported local lookup index rejects duplicate or dangling record references', () => {
  const index = fixture(); index.index.creatively = ['not-a-record']; assert.throws(() => validateEcdictIndex(index));
  const duplicate = fixture(); duplicate.records.push(duplicate.records[0]); assert.throws(() => validateEcdictIndex(duplicate));
});

test('committed real-data summary accounts for all 113 senses without claiming correct-match rate', () => {
  const report = JSON.parse(readFileSync(new URL('../content/ecdict-match-summary.json', import.meta.url), 'utf8'));
  assert.equal(report.senses.length, 113); assert.equal(new Set(report.senses.map((item: { senseId: string }) => item.senseId)).size, 113);
  assert.equal(report.statistics.candidateSenses + report.statistics.noReliableCandidate, 113);
  assert.equal(report.statistics.coveredEntries, 10); assert.equal(report.statistics.verifiedCorrectMatchRate, null);
  assert.equal(report.statistics.publishedEcdictTranslations, 0);
});
