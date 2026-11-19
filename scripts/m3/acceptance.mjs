import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assert, digest, validChinese } from './model.mjs';
import { acceptanceHash } from './report.mjs';
import { atomic } from './clients.mjs';
import { loadSenseHistory } from '../senseTranslations.ts';
import { importSenseCandidates, applySenseReview, publishSenseTranslations } from '../senseTranslationModel.ts';
import { candidateIds } from '../senseTranslations.ts';
import { contentSha256 } from '../chineseContentModel.ts';

export function candidateProvenance(task) {
  const metadata = task.candidateMetadata ?? task.generationMetadata;
  const original = task.generationMetadata?.provider === 'deepseek' || /^DeepSeek/.test(task.generationMetadata?.modelVersion ?? '') ? 'DeepSeek' : '历史 Gemini';
  const provider = metadata?.provider === 'codex' ? `Codex AI 修订（基于 ${original} 候选）` : metadata?.provider === 'deepseek' ? (metadata.service === 'scnet-token-plan' ? 'DeepSeek · SCNet Token Plan' : 'DeepSeek') : 'Google Gemini Express';
  return { provider, modelVersion: metadata.modelVersion, hashes: [...new Set([task.generationMetadata.requestHash, ...(metadata.upstreamRequestHashes ?? []), metadata.requestHash])], promptVersion: metadata.promptVersion, evidenceUrls: metadata.evidenceUrls ?? [] };
}

export function validateAcceptance(job, input) {
  assert(input?.schemaVersion === 1 && input.datasetVersion === job.datasetVersion && typeof input.reviewer === 'string' && input.reviewer.trim() && typeof input.reviewedAt === 'string' && Number.isFinite(Date.parse(input.reviewedAt)) && Array.isArray(input.items) && input.items.length, 'INVALID_USER_ACCEPTANCE');
  const seen = new Set();
  for (const item of input.items) {
    const task = job.tasks.find(t => t.sense_id === item.sense_id);
    assert(task && !seen.has(item.sense_id) && task.status !== 'user_accepted' && item.expectedHash === acceptanceHash(task), 'STALE_OR_DUPLICATE_ACCEPTANCE');
    assert(['user_accepted', 'user_rejected', 'regenerate'].includes(item.decision), 'UNKNOWN_ACCEPTANCE_DECISION');
    if (item.decision === 'user_accepted') {
      assert(task.gemini && validChinese(item.glosses, item.explanation), 'ACCEPTANCE_NEEDS_REAL_CONTENT');
      const edited = !isDeepStrictEqual(item.glosses, task.gemini.glosses) || item.explanation !== task.gemini.explanation;
      assert(item.manualCorrection === edited, 'CORRECTION_FLAG_MISMATCH');
    }
    seen.add(item.sense_id);
  }
  return input;
}

export function accept(root, loaded, input) {
  const { job, path } = loaded;
  const packageHash = digest(input);
  if (job.acceptancePackages?.includes(packageHash)) return { repeated: true, accepted: 0 };
  validateAcceptance(job, input);
  const { inventory, history } = loadSenseHistory();
  const items = input.items.filter(i => i.decision === 'user_accepted');
  let next = history;
  const reviewDirectory = join(root, 'content/reviews'), importDirectory = join(root, 'content/imports');
  mkdirSync(reviewDirectory, { recursive: true }); mkdirSync(importDirectory, { recursive: true });
  if (items.length) {
    const imported = { schemaVersion: 1, dictionaryVersion: history.dictionaryVersion, baseRevision: history.revision, createdAt: input.reviewedAt, items: items.map(item => {
      const task = job.tasks.find(t => t.sense_id === item.sense_id), prior = history.records.find(r => history.currentRecordIds.includes(r.id) && r.senseId === item.sense_id);
      assert(prior?.translationStatus === 'missing', 'DO_NOT_OVERWRITE_EXISTING_TRANSLATION');
      const origin = candidateProvenance(task);
      return { senseId: item.sense_id, sourceFingerprint: task.sourceFingerprint, expectedVersion: prior.version, glosses: item.glosses, explanation: item.explanation,
        source: { type: 'ai', name: `${origin.provider} · ${origin.modelVersion}${item.manualCorrection ? ' · 用户修订' : ''}`, recordIds: [...origin.hashes, `user-acceptance:${packageHash}`, ...task.sourceRefs.map(r => r.jsonPointer)], datasetVersion: job.datasetVersion, licenseStatus: 'cleared', license: 'CC BY-SA 4.0', attribution: task.sourceRefs[0].attribution + ` 中文为 ${origin.provider} 翻译与解释改编；用户最终验收。Azure 为独立对照，不作为正式译文。`, urls: [...new Set([...task.sourceRefs.map(r => r.referenceUrl), ...origin.evidenceUrls])], transformations: [origin.promptVersion ?? job.promptVersion, `dual-engine-job:${task.jobKey}`, item.manualCorrection ? '用户在验收页面修订后接受' : '用户接受双引擎候选；不等同模型自评', 'Azure/ECDICT 原始参考仅留本地，不打包到静态词典'] } };
    }) };
    next = importSenseCandidates(history, imported, inventory);
    const review = { schemaVersion: 1, dictionaryVersion: history.dictionaryVersion, baseRevision: next.revision, reviewer: input.reviewer, reviewedAt: input.reviewedAt, acceptancePackageHash: packageHash, items: imported.items.map(item => ({ ...item, expectedVersion: item.expectedVersion + 1, decision: 'approved' })) };
    next = applySenseReview(next, review, inventory);
    const backupDirectory = join(root, 'artifacts/content-backups'); mkdirSync(backupDirectory, { recursive: true });
    for (const file of ['content/zh-senses-v2.json', 'public/data/chinese-senses.json']) {
      const bytes = readFileSync(join(root, file)), backup = join(backupDirectory, contentSha256(bytes) + '.json');
      if (!existsSync(backup)) writeFileSync(backup, bytes, { flag: 'wx' });
    }
    atomic(join(importDirectory, contentSha256(JSON.stringify(imported)) + '.json'), imported);
    atomic(join(reviewDirectory, contentSha256(JSON.stringify(review)) + '.json'), review);
    // Evidence precedes authoring; publication is always derived, and a stale file fails build.
    atomic(join(root, 'content/zh-senses-v2.json'), next);
    atomic(join(root, 'public/data/chinese-senses.json'), publishSenseTranslations(next, candidateIds(next.dictionaryVersion)));
  }
  for (const item of input.items) {
    const task = job.tasks.find(t => t.sense_id === item.sense_id);
    if (item.decision === 'regenerate') {
      task.previousAttempts ??= []; task.previousAttempts.push({ gemini: task.gemini, comparison: task.comparison, recheck: task.recheck, generationMetadata: task.generationMetadata });
      task.generationRevision = (task.generationRevision ?? 1) + 1;
      task.gemini = null; task.comparison = null; task.recheck = null; task.postRecheckComparison = null; task.quality_flags = []; task.status = task.azure?.text ? 'azure_completed' : 'queued';
    } else {
      task.status = item.decision;
      if (item.decision === 'user_accepted') task.accepted_content = { glosses: item.glosses, explanation: item.explanation, reviewer: input.reviewer, reviewedAt: input.reviewedAt };
    }
    task.events.push({ type: 'user_decision', decision: item.decision, packageHash, at: input.reviewedAt });
  }
  job.acceptancePackages ??= []; job.acceptancePackages.push(packageHash);
  atomic(join(loaded.directory, `acceptance-${packageHash}.json`), input); atomic(path, job);
  return { accepted: items.length, rejected: input.items.filter(i => i.decision === 'user_rejected').length, regenerate: input.items.filter(i => i.decision === 'regenerate').length, deployment: 'not_performed' };
}
