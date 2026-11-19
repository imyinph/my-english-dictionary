// Offline publication only. No provider clients, network calls or job/checkpoint writes.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadSenseHistory, buildChinesePublication, verifyPublished } from '../senseTranslations.ts';
import { importSenseCandidates, applySenseReview } from '../senseTranslationModel.ts';
import { AI_REVIEWER } from '../aiReviewEvidence.ts';
import { candidateProvenance } from './acceptance.mjs';
import { loadSourceContext } from './sourceContext.mjs';
import { atomic } from './clients.mjs';
import { assert, digest, validateGeneration } from './model.mjs';
import { contentSha256 } from '../chineseContentModel.ts';

export function publishReviewed(root, closeout = false) {
  const directory = join(root, '.translation-state/deepseek-scnet-v1');
  assert(!existsSync(join(directory, 'run.lock')), 'TASK_IS_RUNNING');
  const job = JSON.parse(readFileSync(join(directory, 'job.json'), 'utf8'));
  const scope = JSON.parse(readFileSync(join(root, closeout ? 'artifacts/m3-closeout78-package.json' : 'artifacts/m3-editorial20-decisions-20261117.json'), 'utf8'));
  const ids = (closeout ? scope.items : scope.decisions).map(i => i.sense_id);
  const selected = ids.map(id => job.tasks.find(t => t.sense_id === id));
  assert(ids.length === (closeout ? 78 : 20) && new Set(ids).size === ids.length && selected.every(t => t?.status === 'auto_pass' && t.reviewOutcome?.status === 'ai_editorial_review_passed'), 'EXPECTED_COMPLETE_REVIEWED_SCOPE');
  const { history, inventory } = loadSenseHistory();
  const current = t => history.records.find(r => history.currentRecordIds.includes(r.id) && r.senseId === t.sense_id);
  if (selected.every(t => current(t)?.review.status === 'ai_approved')) {
    assert(selected.every(t => isDeepStrictEqual(current(t).glosses, t.gemini.glosses) && current(t).explanation === t.gemini.explanation), 'PUBLISHED_CONTENT_CHANGED');
    return { repeated: true, ...verifyPublished() };
  }
  const at = new Date().toISOString();
  const imported = { schemaVersion: 1, dictionaryVersion: history.dictionaryVersion, baseRevision: history.revision, createdAt: at, items: [] };
  const evidence = new Map();
  for (const task of selected) {
    const prior = current(task), r = task.editorialReview;
    assert(prior?.translationStatus === 'missing' && task.sourceFingerprint === prior.sourceFingerprint && job.datasetVersion === history.dictionaryVersion, 'DO_NOT_OVERWRITE_EXISTING_CONTENT');
    validateGeneration({ results: [task.gemini] }, [task]);
    assert(task.quality_flags.length === 0 && task.reviewOutcome.finalCandidateHash === digest(task.gemini) && task.reviewOutcome.userApproved === false, 'INVALID_REVIEW_OUTCOME');
    const raw = loadSourceContext(root, task);
    for (const [key, value] of Object.entries(raw)) assert(isDeepStrictEqual(value, task.sourceContext[key]), 'STALE_SOURCE_CONTEXT');
    const cacheDirectory = closeout ? join(root, '.translation-state/closeout78-v1') : directory;
    const cache = JSON.parse(readFileSync(join(cacheDirectory, `${r.requestHash}.json`), 'utf8'));
    assert(cache.requestHash === r.requestHash && cache.provider === 'deepseek' && cache.modelVersion === r.model && cache.promptVersion === r.promptVersion && isDeepStrictEqual(cache.data.results.find(v => v.sense_id === task.sense_id), r.result), 'MISSING_INDEPENDENT_RESPONSE');
    const origin = candidateProvenance(task);
    imported.items.push({ senseId: task.sense_id, sourceFingerprint: prior.sourceFingerprint, expectedVersion: prior.version, glosses: task.gemini.glosses, explanation: task.gemini.explanation,
      source: { type: 'ai', name: `${origin.provider} · DeepSeek 交叉复核`, recordIds: [...origin.hashes, ...task.sourceRefs.map(ref => ref.jsonPointer)], datasetVersion: job.datasetVersion, licenseStatus: 'cleared', license: 'CC BY-SA 4.0', attribution: `${task.sourceRefs[0].attribution} 中文为源义项的 AI 翻译与解释改编：Codex 修订、DeepSeek 独立复核、Codex 根据原始来源裁定分歧；未经用户逐条人工审核。`, urls: [...new Set([...task.sourceRefs.map(ref => ref.referenceUrl), ...origin.evidenceUrls])], transformations: [origin.promptVersion, 'DeepSeek-V4.1-Flash-1017-Event / deepseek-recheck-source-bound-zh-v3', '保留独立复核前文本及最终裁定哈希；不将后续裁定冒充独立模型已审版本', 'Codex 具体模型版本未记录；无人工批准；Azure/ECDICT 对照不进入前端'] } });
    evidence.set(task.sense_id, { sourceFingerprint: prior.sourceFingerprint, candidate: task.gemini, reviewedCandidate: task.editorialHistory.at(-1).candidate, independentReview: r, editorialDecision: task.editorialDecision, sourceContext: task.sourceContext });
  }
  let next = importSenseCandidates(history, imported, inventory);
  const review = { schemaVersion: 1, dictionaryVersion: history.dictionaryVersion, baseRevision: next.revision, reviewer: AI_REVIEWER, reviewedAt: at, authorization: '用户允许通过自动复核的 AI 辅助释义展示，并于 2026-11-17 授权更新正式版；不等于逐条人工审核。', items: imported.items.map(item => ({ senseId: item.senseId, expectedVersion: item.expectedVersion + 1, sourceFingerprint: item.sourceFingerprint, glosses: item.glosses, explanation: item.explanation, decision: 'ai_approved', aiEvidence: evidence.get(item.senseId) })) };
  next = applySenseReview(next, review, inventory);
  const publication = buildChinesePublication(next);
  const backupDirectory = join(root, 'artifacts/content-backups'); mkdirSync(backupDirectory, { recursive: true });
  const backups = {};
  for (const file of ['content/zh-senses-v2.json', 'public/data/chinese-senses.json']) {
    const bytes = readFileSync(join(root, file)); const hash = contentSha256(bytes);
    const backup = join(backupDirectory, `${hash}.json`);
    if (!existsSync(backup)) writeFileSync(backup, bytes, { flag: 'wx' });
    backups[file] = hash;
  }
  atomic(join(root, 'content/imports', `${digest(imported)}.json`), imported);
  atomic(join(root, 'content/reviews', `${digest(review)}.json`), review);
  atomic(join(root, 'content/zh-senses-v2.json'), next);
  atomic(join(root, 'public/data/chinese-senses.json'), publication);
  const result = { at, addedAiReviewed: selected.length, ...verifyPublished(), backups, importPackage: digest(imported), reviewPackage: digest(review), taskStateModified: false, historicalAutoPassHeld: closeout ? 0 : 7, notReleased: publication.senses.filter(s => !s.glosses.length).length };
  atomic(join(root, closeout ? 'artifacts/m3-closeout78-publication.json' : 'artifacts/m3-production-publication-20261117.json'), result);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert(process.argv.slice(2).every(a => a === '--closeout78'), 'UNKNOWN_PUBLICATION_ARGUMENT');
  console.log(JSON.stringify(publishReviewed(resolve('.'), process.argv.includes('--closeout78')), null, 2));
}
