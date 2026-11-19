import type { ContentIdentityRegistry, ContentIdentity } from '../src/domain/chineseContent.ts';

export interface EcdictSection { sourceLine: number; text: string; partOfSpeech: string[]; originalText: string }
export interface EcdictRecord {
  recordId: string; word: string; definitions: EcdictSection[]; translations: EcdictSection[];
  raw: Record<string, string>; locator: { dataRecordNumber: number; physicalEndLine: number; recordSha256: string };
  duplicateLocations: unknown[]; issues: string[]; bilingualAlignment: 'not_provided'; upstreamRecordOrigin: 'not_provided';
}
export interface EcdictIndex {
  schemaVersion: 1; datasetVersion: string;
  source: { name: string; url: string | null; sha256: string; bytes: number; contentLicenseStatus: 'upstream_unresolved'; distribution: 'local-review-only'; repositoryLicense: string };
  index: Record<string, string[]>; records: EcdictRecord[]; scope: string[];
  statistics: { csvRecordsScanned: number; invalidColumnRows: number; blankWords: number; selectedUniqueRecords: number; duplicateSelectedRows: number; selectedRecordsWithIssues: number; duplicateScope: string };
}

export type MatchCategory = 'high_confidence_candidate' | 'ambiguous_candidate' | 'no_reliable_candidate';
export interface SenseMatch {
  senseId: string; entryId: string; headword: string; partOfSpeech: string; englishText: string; sourceFingerprint: string;
  context: { glosses: string[]; tags: string[]; examples: string[] };
  category: MatchCategory; reviewStatus: 'pending'; translationStatus: 'candidate' | 'missing';
  reason: string; wordCovered: boolean; posMismatch: boolean;
  candidates: {
    sourceRecordId: string; englishSourceLine: number; chineseContextLineRefs: number[];
    score: number; scoreMeaning: 'heuristic_not_probability'; bilingualAlignment: 'unverified';
    evidence: { tokenOverlap: string[]; concepts: string[]; exampleSupport: string[]; exactDefinition: boolean; competingDefinitions: number; ambiguity: string[] };
  }[];
}

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/gu, ' ');
const stop = new Set('a an the to of in on by with or and be being is as that which for from at into something someone somebody one such sometimes particular especially usually'.split(' '));
const inflections: Record<string, string> = { created: 'create', creates: 'create', creating: 'create', made: 'make', makes: 'make', making: 'make', killed: 'kill', killing: 'kill', destroys: 'destroy', destroyed: 'destroy', destroying: 'destroy', produces: 'produce', produced: 'produce', producing: 'produce', things: 'thing', words: 'word', expressions: 'expression', invents: 'invent', grows: 'grow' };
function tokens(text: string, headword: string) {
  const headwords = new Set(normalize(headword).split(' '));
  return new Set((normalize(text).match(/[a-z]+/gu) ?? []).map(token => inflections[token] ?? token).filter(token => !stop.has(token) && !headwords.has(token)));
}
const conceptRules: [string, RegExp][] = [
  ['existence-production', /bring.*existence|brought.*existence|produce.*(?:new|novel)|(?:new|novel).*produc/u],
  ['creative-capacity', /(?:ability|power|capacity).*creat|creativ.*(?:ability|power|capacity)/u],
  ['creative-manner', /creative manner|creatively/u],
  ['causation-result', /cause.*(?:be|become)|give certain properties/u],
  ['semantic-meaning', /meaning.*(?:word|expression)|interpret.*(?:word|expression)|(?:word|expression).*interpret/u],
  ['animal-killing', /(?:animal|animals).*(?:death|kill|euthan)|(?:kill|euthan).*animal/u],
  ['irreparable-damage', /(?:ruin|destr|damage|undoing).*(?:complete|irrepar)|(?:complete|irrepar).*(?:ruin|destr|damage)|do away with/u],
];
const concepts = (text: string) => conceptRules.filter(([, pattern]) => pattern.test(normalize(text))).map(([name]) => name);
function conflict(left: string, right: string): boolean {
  const deity = /\b(?:deity|god|divine|universe)\b/u, human = /\b(?:person|people|human|someone)\b/u;
  const negation = /\b(?:not|never|without|lacking)\b/u;
  return (deity.test(left) && human.test(right) && !deity.test(right)) || (deity.test(right) && human.test(left) && !deity.test(left)) || negation.test(left) !== negation.test(right);
}

function compare(identity: ContentIdentity, english: EcdictSection) {
  const left = normalize(identity.englishText), right = normalize(english.text);
  const a = tokens(left, identity.context.headword), b = tokens(right, identity.context.headword);
  const tokenOverlap = [...a].filter(token => b.has(token));
  const sharedConcepts = concepts(left).filter(concept => concepts(right).includes(concept));
  const exampleTokens = tokens(identity.context.examples.join(' '), identity.context.headword);
  const exampleSupport = [...b].filter(token => exampleTokens.has(token));
  const exactDefinition = left.replace(/[^a-z0-9]+/gu, ' ').trim() === right.replace(/[^a-z0-9]+/gu, ' ').trim();
  const overlap = a.size + b.size ? 2 * tokenOverlap.length / (a.size + b.size) : 0;
  const excluded = conflict(left, right);
  const score = excluded ? 0 : exactDefinition ? 1 : Math.min(0.94, Math.max(overlap, sharedConcepts.length ? 0.7 : 0) + (exampleSupport.length && overlap >= 0.3 ? 0.04 : 0));
  return { score: Math.round(score * 1000) / 1000, tokenOverlap, concepts: sharedConcepts, exampleSupport, exactDefinition, excluded };
}

export function validateEcdictIndex(input: unknown): EcdictIndex {
  const index = input as EcdictIndex;
  if (!index || index.schemaVersion !== 1 || typeof index.datasetVersion !== 'string' || !index.datasetVersion || !/^[a-f0-9]{64}$/u.test(index.source?.sha256) || index.source?.contentLicenseStatus !== 'upstream_unresolved' || index.source?.distribution !== 'local-review-only' || !Array.isArray(index.records) || index.records.length > 100 || !Array.isArray(index.scope)) throw new Error('Invalid bounded ECDICT index');
  const ids = new Set<string>();
  for (const record of index.records) {
    if (typeof record.recordId !== 'string' || ids.has(record.recordId) || !index.scope.includes(record.word) || !record.raw || record.bilingualAlignment !== 'not_provided' || !Array.isArray(record.definitions) || !Array.isArray(record.translations)) throw new Error('Invalid ECDICT record identity');
    ids.add(record.recordId);
    for (const section of [...record.definitions, ...record.translations]) if (typeof section.text !== 'string' || !section.text.trim() || !Number.isSafeInteger(section.sourceLine) || section.sourceLine < 1 || !Array.isArray(section.partOfSpeech) || !section.partOfSpeech.every(pos => typeof pos === 'string')) throw new Error('Invalid ECDICT segment');
  }
  for (const word of index.scope) {
    const actual = index.records.filter(record => record.word === word).map(record => record.recordId).sort();
    const listed = index.index[word] ?? [];
    if (!Array.isArray(listed) || JSON.stringify([...listed].sort()) !== JSON.stringify(actual)) throw new Error('ECDICT local index is inconsistent');
  }
  return index;
}

/** Candidate retrieval only: it NEVER writes glosses or approves semantic/licensing claims. */
export function matchEcdict(registry: ContentIdentityRegistry, input: unknown): SenseMatch[] {
  const index = validateEcdictIndex(input);
  return registry.targets.filter(identity => identity.target.kind === 'sense').map(identity => {
    const { headword, partOfSpeech, glosses, tags, examples } = identity.context;
    const records = index.records.filter(record => normalize(record.word) === normalize(headword));
    const base = { senseId: identity.target.senseId, entryId: identity.target.entryId, headword, partOfSpeech, englishText: identity.englishText, sourceFingerprint: identity.sourceFingerprint, context: { glosses, tags, examples }, reviewStatus: 'pending' as const, wordCovered: records.length > 0 };
    const scored = records.flatMap(record => {
      const definitions = record.definitions.filter(section => section.partOfSpeech.includes(partOfSpeech));
      const chinese = record.translations.filter(section => section.partOfSpeech.includes(partOfSpeech));
      if (!chinese.length) return [];
      return definitions.map(english => ({ record, english, chinese, definitions, ...compare(identity, english) }));
    }).sort((a, b) => b.score - a.score || a.record.recordId.localeCompare(b.record.recordId) || a.english.sourceLine - b.english.sourceLine);
    const posMismatch = records.length > 0 && !records.some(record => record.definitions.some(section => section.partOfSpeech.includes(partOfSpeech)) && record.translations.some(section => section.partOfSpeech.includes(partOfSpeech)));
    const plausible = scored.filter(item => item.score >= 0.45 && !item.excluded && (item.tokenOverlap.length > 0 || item.concepts.length > 0));
    if (!plausible.length) return { ...base, posMismatch, category: 'no_reliable_candidate' as const, translationStatus: 'missing' as const, reason: !records.length ? 'word_not_found' : records.every(record => !record.definitions.length) ? 'missing_english_definition' : posMismatch ? 'no_pos_aligned_bilingual_evidence' : 'insufficient_semantic_evidence_or_conflict', candidates: [] };
    const top = plausible[0];
    const competing = scored.filter(item => item.score >= top.score - 0.15).length;
    const high = top.score >= 0.88 && competing === 1 && top.definitions.length === 1 && top.chinese.length === 1 && !tags.some(tag => ['archaic', 'obsolete', 'rare', 'slang'].includes(tag));
    const candidates = plausible.map(item => ({
      sourceRecordId: item.record.recordId, englishSourceLine: item.english.sourceLine,
      // References are context for a reviewer, not a line-to-line translation assignment.
      chineseContextLineRefs: item.chinese.map(section => section.sourceLine), score: item.score,
      scoreMeaning: 'heuristic_not_probability' as const, bilingualAlignment: 'unverified' as const,
      evidence: { tokenOverlap: item.tokenOverlap, concepts: item.concepts, exampleSupport: item.exampleSupport, exactDefinition: item.exactDefinition, competingDefinitions: competing,
        ambiguity: ['upstream_bilingual_alignment_absent', 'upstream_license_unresolved', ...(item.definitions.length > 1 ? ['multiple_english_definitions'] : []), ...(item.chinese.some(section => /[,;，；]/u.test(section.text)) ? ['chinese_group_may_span_meanings'] : [])] },
    }));
    return { ...base, posMismatch, category: high ? 'high_confidence_candidate' as const : 'ambiguous_candidate' as const, translationStatus: 'candidate' as const, reason: high ? 'strong_english_evidence_single_pos_group_still_requires_review' : 'english_evidence_found_bilingual_alignment_requires_review', candidates };
  });
}

export function matchingStatistics(matches: SenseMatch[], index: EcdictIndex) {
  return {
    totalEntries: new Set(matches.map(match => match.entryId)).size, totalSenses: matches.length,
    coveredEntries: new Set(matches.filter(match => match.wordCovered).map(match => match.entryId)).size,
    candidateSenses: matches.filter(match => match.candidates.length).length,
    highConfidence: matches.filter(match => match.category === 'high_confidence_candidate').length,
    ambiguous: matches.filter(match => match.category === 'ambiguous_candidate').length,
    awaitingReview: matches.filter(match => match.candidates.length).length,
    noReliableCandidate: matches.filter(match => match.category === 'no_reliable_candidate').length,
    posMismatchSenses: matches.filter(match => match.posMismatch).length,
    duplicateSelectedRows: index.statistics.duplicateSelectedRows, abnormalSelectedRecords: index.statistics.selectedRecordsWithIssues,
    importedCsvRows: index.statistics.csvRecordsScanned, invalidCsvRows: index.statistics.invalidColumnRows,
    automaticApprovals: 0, publishedEcdictTranslations: 0, verifiedCorrectMatchRate: null,
    warning: '候选覆盖率不是正确匹配率；分数是未校准的检索指标，不是翻译正确概率。',
  };
}
