import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { atomicJson } from './audioFiles.ts';
import { verifyContent } from './chineseContent.ts';
import { contentSha256 } from './chineseContentModel.ts';
import { applySenseReview, importSenseCandidates, verifyCandidateEvidence, migrateSenseTranslations, publishSenseTranslations, validateSenseHistory, verifyReviewEvidence } from './senseTranslationModel.ts';

import { addReviewedExplanations, type ExplanationBatch } from './reviewedExplanations.ts';
import type { SenseTranslationHistory } from '../src/domain/senseTranslation.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
export const authoringPath = 'content/zh-senses-v2.json';
const publishedPath = 'data/chinese-senses.json';
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown;
function backup(path: string) {
  if (!existsSync(path)) return;
  const bytes = readFileSync(path), destination = join(root, 'artifacts/content-backups', `${contentSha256(bytes)}.json`);
  mkdirSync(dirname(destination), { recursive: true });
  if (!existsSync(destination)) writeFileSync(destination, bytes, { flag: 'wx' });
}

export function loadSenseHistory() {
  const { inventory } = verifyContent();
  const history = validateSenseHistory(read(join(root, authoringPath)), inventory);
  const reviewDirectory = join(root, 'content/reviews');
  const packages = existsSync(reviewDirectory) ? readdirSync(reviewDirectory).filter(file => file.endsWith('.json')).map(file => read(join(reviewDirectory, file))) : [];
  verifyReviewEvidence(history, packages);
  const importDirectory = join(root, 'content/imports');
  verifyCandidateEvidence(history, existsSync(importDirectory) ? readdirSync(importDirectory).filter(file => file.endsWith('.json')).map(file => read(join(importDirectory, file))) : []);
  return { inventory, history };
}

export function candidateIds(dictionaryVersion: string): Set<string> {
  const path = join(root, 'content/ecdict-match-summary.json');
  if (!existsSync(path)) return new Set();
  const summary = read(path) as { schemaVersion: number; dictionaryVersion: string; senses: { senseId: string; category: string }[] };
  const { inventory } = verifyContent();
  const known = new Set(inventory.registry.targets.filter(record => record.target.kind === 'sense').map(record => record.target.senseId));
  if (summary.schemaVersion !== 1 || summary.dictionaryVersion !== dictionaryVersion || !Array.isArray(summary.senses) || summary.senses.length !== known.size || new Set(summary.senses.map(record => record.senseId)).size !== known.size || summary.senses.some(record => !known.has(record.senseId) || !['high_confidence_candidate', 'ambiguous_candidate', 'no_reliable_candidate'].includes(record.category))) throw new Error('Invalid/stale ECDICT summary');
  return new Set(summary.senses.filter(record => record.category !== 'no_reliable_candidate').map(record => record.senseId));
}

export function buildChinesePublication(history: SenseTranslationHistory) {
  const base = publishSenseTranslations(history, candidateIds(history.dictionaryVersion));
  const batches = read(join(root, 'content/reviews/explanations-v1.json')) as ExplanationBatch[];
  return addReviewedExplanations(base, batches);
}

export function verifyPublished(directory = 'public') {
  const { history } = loadSenseHistory();
  const expected = buildChinesePublication(history);
  if (!isDeepStrictEqual(read(join(root, directory, publishedPath)), expected)) throw new Error('Chinese publication is stale; run pnpm zh:publish after review/matching');
  if (directory === 'dist' && !readFileSync(join(root, directory, publishedPath)).equals(readFileSync(join(root, 'public', publishedPath)))) throw new Error('Dist Chinese file differs from public');
  return { senses: expected.senses.length, explanations: expected.senses.filter(record => record.explanation).length, approved: expected.senses.filter(record => record.reviewStatus === 'approved').length, aiApproved: expected.senses.filter(record => record.reviewStatus === 'ai_approved').length, candidate: expected.senses.filter(record => record.translationStatus === 'candidate').length, missing: expected.senses.filter(record => record.translationStatus === 'missing').length, revision: history.revision };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'migrate' && !args.length) {
    const { inventory, bundle } = verifyContent();
    const path = join(root, authoringPath);
    if (existsSync(path)) validateSenseHistory(read(path), inventory);
    else atomicJson(path, validateSenseHistory(migrateSenseTranslations(inventory, bundle), inventory));
    console.log('113 sense identities migrated/validated; existing reviews preserved.');
  } else if (command === 'review-template' && !args.length) {
    const { history } = loadSenseHistory();
    const current = new Set(history.currentRecordIds);
    const template = {
      schemaVersion: 1, dictionaryVersion: history.dictionaryVersion, baseRevision: history.revision,
      reviewer: '', reviewedAt: '',
      items: history.records.filter(record => current.has(record.id) && record.translationStatus === 'candidate').map(record => ({ senseId: record.senseId, expectedVersion: record.version, sourceFingerprint: record.sourceFingerprint, englishText: record.englishText, partOfSpeech: record.partOfSpeech, glosses: record.glosses, explanation: record.explanation, decision: 'pending' })),
    };
    atomicJson(join(root, 'artifacts/chinese-review-template.json'), template);
    console.log(`Review template written: ${template.items.length} candidates; fill reviewer/time and explicit decisions.`);
  } else if (command === 'import' && args.length === 2 && args[0] === '--file') {
    const { inventory, history } = loadSenseHistory();
    const inputPath = resolve(args[1]);
    if (readFileSync(inputPath).length > 1024 * 1024) throw new Error('Candidate package exceeds 1 MiB');
    const bundle = read(inputPath), next = importSenseCandidates(history, bundle, inventory);
    if (next !== history) {
      atomicJson(join(root, 'content/imports', `${contentSha256(JSON.stringify(bundle))}.json`), bundle);
      backup(join(root, authoringPath)); atomicJson(join(root, authoringPath), next);
    }
    console.log(`Candidates imported pending review; revision ${next.revision}.`);
  } else if (command === 'review' && args.length === 2 && args[0] === '--file') {
    const { inventory, history } = loadSenseHistory();
    const inputPath = resolve(args[1]);
    if (readFileSync(inputPath).length > 1024 * 1024) throw new Error('Review package exceeds 1 MiB');
    const review = read(inputPath), next = applySenseReview(history, review, inventory);
    if (next !== history) {
      // Save evidence first; interruption leaves an unused package, never an untraceable approval.
      atomicJson(join(root, 'content/reviews', `${contentSha256(JSON.stringify(review))}.json`), review);
      backup(join(root, authoringPath)); atomicJson(join(root, authoringPath), next);
    }
    console.log(`Review imported; revision ${next.revision}. Repeated import is a no-op. Run zh:publish to update static data.`);
  } else if (command === 'publish' && !args.length) {
    const { history } = loadSenseHistory();
    const path = join(root, 'public', publishedPath);
    const publication = buildChinesePublication(history);
    if (!existsSync(path) || !isDeepStrictEqual(read(path), publication)) { backup(path); atomicJson(path, publication); }
    console.log(JSON.stringify(verifyPublished()));
  } else if (command === 'verify' && (!args.length || (args.length === 1 && args[0] === '--dist'))) console.log(JSON.stringify(verifyPublished(args.length ? 'dist' : 'public')));
  else throw new Error('Usage: senseTranslations.ts migrate | import --file <json> | review-template | review --file <json> | publish | verify [--dist]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
