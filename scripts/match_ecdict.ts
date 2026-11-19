import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { verifyContent } from './chineseContent.ts';
import { atomicJson } from './audioFiles.ts';
import { matchEcdict, matchingStatistics, validateEcdictIndex } from './ecdictMatching.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const verify = process.argv[2] === '--verify';
if (process.argv.length > (verify ? 3 : 2)) throw new Error('Usage: node scripts/match_ecdict.ts [--verify]');
const { inventory } = verifyContent();
const index = validateEcdictIndex(JSON.parse(readFileSync(join(root, 'artifacts/ecdict/index.json'), 'utf8')));
const matches = matchEcdict(inventory.registry, index);
const stats = matchingStatistics(matches, index);
const full = { schemaVersion: 1, algorithmVersion: 'conservative-evidence-v1', dictionaryVersion: inventory.registry.dictionaryVersion, ecdictDatasetVersion: index.datasetVersion, ecdictSha256: index.source.sha256, statistics: stats, senses: matches };
// Public-safe metadata only: no ECDICT definition/translation text or unresolved source payload.
const summary = { ...full, senses: matches.map(({ context: _context, candidates, ...match }) => ({ ...match, candidates: candidates.map(candidate => ({ sourceRecordId: candidate.sourceRecordId, englishSourceLine: candidate.englishSourceLine, chineseContextLineRefs: candidate.chineseContextLineRefs, score: candidate.score, bilingualAlignment: candidate.bilingualAlignment, ambiguity: candidate.evidence.ambiguity })) })) };
for (const [path, value] of [['artifacts/ecdict/matches.json', full], ['content/ecdict-match-summary.json', summary]] as const) {
  if (verify) {
    if (!isDeepStrictEqual(JSON.parse(readFileSync(join(root, path), 'utf8')), value)) throw new Error(`Stale matching report: ${path}`);
  } else atomicJson(join(root, path), value);
}
console.log(JSON.stringify(stats, null, 2));
