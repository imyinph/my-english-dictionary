import { isDeepStrictEqual } from 'node:util';
import type { ContentInventory } from './chineseContentModel.ts';
import type { ChineseContentBundle } from '../src/domain/chineseContent.ts';
import type { PublishedTranslations, SenseTranslation, SenseTranslationHistory } from '../src/domain/senseTranslation.ts';
import { senseTranslationId } from '../src/domain/senseTranslation.ts';
import { parsePublishedTranslations } from '../src/providers/senseTranslations.ts';
import { contentSha256 } from './chineseContentModel.ts';
import { AI_REVIEWER, verifyAiReviewEvidence } from './aiReviewEvidence.ts';

function requireThat(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const time = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/u.test(value) && Number.isFinite(Date.parse(value));

export function migrateSenseTranslations(inventory: ContentInventory, legacy?: ChineseContentBundle): SenseTranslationHistory {
  if (legacy && !isDeepStrictEqual(legacy, inventory.initialContent)) throw new Error('Legacy content has later revisions; explicit migration required, no history discarded');
  const records: SenseTranslation[] = inventory.initialContent.records.filter(record => record.target.kind === 'sense').map(record => {
    const original = record.chineseText;
    // One documented source-form selection, not a language model translation.
    const glosses = original === '創作品 /创作品' ? ['创作品'] : original?.split('；').map(item => item.trim()).filter(Boolean) ?? [];
    return {
      id: senseTranslationId(record.target.senseId, 1), senseId: record.target.senseId, entryId: record.target.entryId,
      locale: 'zh-Hans', englishText: record.englishText, partOfSpeech: record.context.partOfSpeech, sourceFingerprint: record.sourceFingerprint,
      glosses, explanation: null,
      source: original ? { type: 'dictionary', name: 'English Wiktionary · Kaikki', recordIds: record.sourceRefs.map(ref => ref.jsonPointer), datasetVersion: record.sourceSnapshotSha256, licenseStatus: 'cleared', license: 'CC BY-SA 4.0', attribution: record.sourceRefs[0].attribution, urls: [...new Set(record.sourceRefs.map(ref => ref.referenceUrl))], transformations: original === '創作品 /创作品' ? ['选择源文本已有简体形式；去掉繁简重复；原文保存在 content-v1'] : ['按原分号拆分简释；未修改语义'] } : null,
      matching: { method: original ? 'source-exact' : 'none', confidence: null, evidence: [original ? '原源行与义项精确匹配；尚需人工审核' : '原快照无可靠逐义项中文'] },
      review: { status: 'pending', reviewer: null, reviewedAt: null, note: '迁移不等于人工批准' },
      translationStatus: original ? 'candidate' : 'missing', createdAt: record.updatedAt, updatedAt: record.updatedAt, version: 1,
    };
  });
  return { schemaVersion: 2, dictionaryVersion: inventory.registry.dictionaryVersion, revision: 1, records, currentRecordIds: records.map(record => record.id) };
}

export function validateSenseHistory(input: unknown, inventory: ContentInventory): SenseTranslationHistory {
  const data = object(input);
  requireThat(data.schemaVersion === 2 && data.dictionaryVersion === inventory.registry.dictionaryVersion && Number.isSafeInteger(data.revision) && Number(data.revision) >= 1 && Array.isArray(data.records) && Array.isArray(data.currentRecordIds), 'Invalid Chinese history schema/version');
  const identities = new Map(inventory.registry.targets.filter(identity => identity.target.kind === 'sense').map(identity => [identity.target.senseId, identity]));
  const records = new Map<string, SenseTranslation>();
  for (const unknownRecord of data.records as unknown[]) {
    const record = object(unknownRecord), review = object(record.review), matching = object(record.matching);
    const identity = identities.get(String(record.senseId));
    requireThat(identity && record.entryId === identity.target.entryId && record.englishText === identity.englishText && record.partOfSpeech === identity.context.partOfSpeech && record.sourceFingerprint === identity.sourceFingerprint, 'Wrong or stale sense mapping');
    requireThat(record.locale === 'zh-Hans' && Number.isSafeInteger(record.version) && Number(record.version) >= 1 && record.id === senseTranslationId(String(record.senseId), Number(record.version)) && !records.has(String(record.id)), 'Invalid or duplicate Chinese revision');
    requireThat(time(record.createdAt) && time(record.updatedAt) && Date.parse(String(record.updatedAt)) >= Date.parse(String(record.createdAt)), 'Invalid revision time');
    requireThat(Array.isArray(record.glosses) && record.glosses.every(text) && record.glosses.length <= 20 && record.glosses.every(gloss => gloss.length <= 300) && new Set(record.glosses).size === record.glosses.length && (record.explanation === null || (text(record.explanation) && record.explanation.length <= 3000)), 'Invalid Chinese text');
    requireThat(['pending', 'approved', 'ai_approved', 'rejected'].includes(String(review.status)) && typeof review.note === 'string' && ['missing', 'candidate', 'complete'].includes(String(record.translationStatus)), 'Invalid Chinese statuses');
    requireThat(['source-exact', 'manual-context', 'ecdict-evidence', 'none'].includes(String(matching.method)) && (matching.confidence === null || (typeof matching.confidence === 'number' && Number.isFinite(matching.confidence) && matching.confidence >= 0 && matching.confidence <= 1)) && Array.isArray(matching.evidence) && matching.evidence.every(text), 'Invalid matching evidence');
    if (review.status === 'pending') requireThat(review.reviewer === null && review.reviewedAt === null, 'Pending is not human approval');
    else requireThat(text(review.reviewer) && time(review.reviewedAt) && Date.parse(String(review.reviewedAt)) <= Date.parse(String(record.updatedAt)), 'Review lacks identity/time');
    if (record.translationStatus === 'missing') requireThat(record.glosses.length === 0 && record.explanation === null && record.source === null && review.status === 'pending', 'Missing content must stay absent');
    else requireThat(record.glosses.length > 0 && record.source !== null, 'Candidate requires actual source content');
    const reviewed = review.status === 'approved' || review.status === 'ai_approved';
    if (record.translationStatus === 'complete' || reviewed) requireThat(record.translationStatus === 'complete' && reviewed, 'Complete requires explicit approval');
    if (review.status === 'ai_approved') requireThat(review.reviewer === AI_REVIEWER && object(record.source).type === 'ai', 'AI approval requires distinct reviewer/provenance');
    if (record.source !== null) {
      const source = object(record.source);
      requireThat(['dictionary', 'human', 'ai'].includes(String(source.type)) && text(source.name) && text(source.datasetVersion) && text(source.attribution) && Array.isArray(source.recordIds) && source.recordIds.length && source.recordIds.every(text) && Array.isArray(source.urls) && source.urls.every(url => { try { return new URL(String(url)).protocol === 'https:'; } catch { return false; } }) && Array.isArray(source.transformations) && source.transformations.every(text) && ['cleared', 'upstream_unresolved'].includes(String(source.licenseStatus)) && (source.license === null || text(source.license)), 'Invalid Chinese provenance');
      if (reviewed) requireThat(source.licenseStatus === 'cleared' && text(source.license), 'Unresolved source license cannot be published');
    }
    records.set(String(record.id), record as unknown as SenseTranslation);
  }
  for (const seed of migrateSenseTranslations(inventory).records) requireThat(isDeepStrictEqual(records.get(seed.id), seed), 'Original v2 migration changed or missing');
  const selected = new Set<string>();
  for (const id of data.currentRecordIds as unknown[]) {
    const record = records.get(String(id));
    requireThat(record && !selected.has(record.senseId), 'Unknown or duplicated current translation');
    selected.add(record!.senseId);
  }
  requireThat(selected.size === identities.size, 'Every English sense requires a Chinese status');
  for (const senseId of identities.keys()) {
    const history = [...records.values()].filter(record => record.senseId === senseId).sort((a, b) => a.version - b.version);
    history.forEach((record, index) => {
      requireThat(record.version === index + 1 && Number(data.revision) >= record.version, 'Incomplete revision history');
      if (index) {
        const prior = history[index - 1];
        requireThat(record.createdAt === prior.createdAt && Date.parse(record.updatedAt) >= Date.parse(prior.updatedAt), 'Revision chronology changed');
        // In this bounded phase the source chain is fixed; no arbitrary provider/rights replacement.
        const ingestion = prior.translationStatus === 'missing' && prior.source === null && record.translationStatus === 'candidate' && record.review.status === 'pending' && record.review.note.startsWith('candidate-package:');
        requireThat(ingestion || isDeepStrictEqual(record.source, prior.source), 'Source provenance cannot be overwritten by review');
      }
    });
  }
  return input as SenseTranslationHistory;
}

/** Import real authored content as pending; publication still requires separate review. */
export function importSenseCandidates(history: SenseTranslationHistory, input: unknown, inventory: ContentInventory): SenseTranslationHistory {
  validateSenseHistory(history, inventory);
  const bundle = object(input);
  requireThat(bundle.schemaVersion === 1 && bundle.dictionaryVersion === history.dictionaryVersion && time(bundle.createdAt) && Array.isArray(bundle.items) && bundle.items.length > 0, 'Invalid candidate package');
  const marker = `candidate-package:${contentSha256(JSON.stringify(bundle))}`;
  if (history.records.some(record => record.review.note === marker)) return history;
  requireThat(bundle.baseRevision === history.revision, 'Candidate revision is stale');
  const next = structuredClone(history), seen = new Set<string>();
  for (const value of bundle.items) {
    const item = object(value);
    const prior = history.records.find(r => history.currentRecordIds.includes(r.id) && r.senseId === item.senseId);
    requireThat(prior && !seen.has(prior.senseId) && prior.translationStatus === 'missing' && prior.source === null && item.expectedVersion === prior.version && item.sourceFingerprint === prior.sourceFingerprint, 'Candidate would overwrite existing content or wrong sense');
    seen.add(prior.senseId);
    const record = { ...structuredClone(prior), id: senseTranslationId(prior.senseId, prior.version + 1), version: prior.version + 1, updatedAt: String(bundle.createdAt), glosses: item.glosses, explanation: item.explanation, source: item.source, matching: { method: 'manual-context', confidence: null, evidence: [marker] }, review: { status: 'pending', reviewer: null, reviewedAt: null, note: marker }, translationStatus: 'candidate' } as SenseTranslation;
    next.records.push(record); next.currentRecordIds[next.currentRecordIds.indexOf(prior.id)] = record.id;
  }
  next.revision++;
  return validateSenseHistory(next, inventory);
}

export function verifyCandidateEvidence(history: SenseTranslationHistory, packages: unknown[]): void {
  const byHash = new Map(packages.map(value => [`candidate-package:${contentSha256(JSON.stringify(value))}`, object(value)]));
  for (const record of history.records.filter(r => r.review.note.startsWith('candidate-package:'))) {
    const bundle = byHash.get(record.review.note);
    requireThat(bundle && bundle.dictionaryVersion === history.dictionaryVersion && bundle.createdAt === record.updatedAt && Array.isArray(bundle.items), 'Missing original candidate evidence');
    const item = bundle.items.map(object).find(item => item.senseId === record.senseId);
    requireThat(item && item.expectedVersion === record.version - 1 && item.sourceFingerprint === record.sourceFingerprint && isDeepStrictEqual(item.glosses, record.glosses) && item.explanation === record.explanation && isDeepStrictEqual(item.source, record.source), 'Candidate content differs from recorded source');
  }
}

export function publishSenseTranslations(history: SenseTranslationHistory, candidateSenseIds: Set<string> = new Set()): PublishedTranslations {
  const current = new Set(history.currentRecordIds);
  return parsePublishedTranslations({
    schemaVersion: 2, dictionaryVersion: history.dictionaryVersion, revision: history.revision, locale: 'zh-Hans',
    senses: history.records.filter(record => current.has(record.id)).map(record => {
      const approved = ['approved', 'ai_approved'].includes(record.review.status) && record.translationStatus === 'complete' && record.source?.licenseStatus === 'cleared';
      return {
        senseId: record.senseId, entryId: record.entryId, englishText: record.englishText, partOfSpeech: record.partOfSpeech,
        sourceFingerprint: record.sourceFingerprint, locale: record.locale, version: record.version,
        glosses: approved ? record.glosses : [], explanation: approved ? record.explanation : null, source: approved ? record.source : null,
        reviewStatus: record.review.status, translationStatus: record.translationStatus === 'missing' && candidateSenseIds.has(record.senseId) ? 'candidate' : record.translationStatus,
      };
    }),
  });
}

/** Review deliberately approves/rejects existing content only; it does not invent explanations. */
export function applySenseReview(history: SenseTranslationHistory, input: unknown, inventory: ContentInventory): SenseTranslationHistory {
  validateSenseHistory(history, inventory);
  const review = object(input);
  requireThat(review.schemaVersion === 1 && review.dictionaryVersion === history.dictionaryVersion && text(review.reviewer) && time(review.reviewedAt) && Array.isArray(review.items) && review.items.length > 0, 'Invalid review package');
  const packageHashKey = contentSha256(JSON.stringify(review));
  const marker = `review-package:${packageHashKey}`;
  if (history.records.some(record => record.review.note === marker)) return history;
  requireThat(review.baseRevision === history.revision, 'Review base revision is stale; regenerate template');
  const updated = structuredClone(history), current = new Map(history.records.filter(record => history.currentRecordIds.includes(record.id)).map(record => [record.senseId, record]));
  const seen = new Set<string>();
  for (const value of review.items) {
    const item = object(value), previous = current.get(String(item.senseId));
    requireThat(previous && !seen.has(previous.senseId) && item.expectedVersion === previous.version && item.sourceFingerprint === previous.sourceFingerprint, 'Review sense, fingerprint or revision mismatch');
    requireThat(['approved', 'ai_approved', 'rejected'].includes(String(item.decision)) && previous!.glosses.length && previous!.source, 'Review needs existing candidate and explicit decision');
    if (item.decision === 'ai_approved') {
      requireThat(review.reviewer === AI_REVIEWER && previous!.review.status === 'pending', 'AI review cannot overwrite an existing review');
      verifyAiReviewEvidence(item.aiEvidence, previous!);
    } else requireThat(review.reviewer !== AI_REVIEWER, 'AI reviewer cannot create human approval');
    // Reviewer sees the exact proposed content; no approvals detached from text.
    requireThat(isDeepStrictEqual(item.glosses, previous!.glosses) && item.explanation === previous!.explanation, 'Reviewed content differs from current candidate');
    if (item.decision !== 'rejected') requireThat(previous!.source!.licenseStatus === 'cleared', 'Source license unresolved; approval cannot authorize redistribution');
    seen.add(previous!.senseId);
    const record: SenseTranslation = { ...structuredClone(previous!), id: senseTranslationId(previous!.senseId, previous!.version + 1), version: previous!.version + 1, updatedAt: String(review.reviewedAt), review: { status: item.decision as 'approved' | 'ai_approved' | 'rejected', reviewer: String(review.reviewer), reviewedAt: String(review.reviewedAt), note: marker }, translationStatus: item.decision !== 'rejected' ? 'complete' : 'candidate' };
    updated.records.push(record); updated.currentRecordIds[updated.currentRecordIds.indexOf(previous!.id)] = record.id;
  }
  updated.revision++;
  return validateSenseHistory(updated, inventory);
}

/** Build-time audit: edits cannot retain an old approval for different Chinese text. */
export function verifyReviewEvidence(history: SenseTranslationHistory, packages: unknown[]): void {
  const byHash = new Map(packages.map(value => [`review-package:${contentSha256(JSON.stringify(value))}`, object(value)]));
  for (const record of history.records.filter(item => item.review.status !== 'pending')) {
    const evidence = byHash.get(record.review.note);
    requireThat(evidence && evidence.dictionaryVersion === history.dictionaryVersion && evidence.reviewer === record.review.reviewer && evidence.reviewedAt === record.review.reviewedAt && Array.isArray(evidence.items), 'Missing original review evidence');
    const item = evidence.items.map(object).find(item => item.senseId === record.senseId);
    requireThat(item && item.expectedVersion === record.version - 1 && item.sourceFingerprint === record.sourceFingerprint && item.decision === record.review.status && isDeepStrictEqual(item.glosses, record.glosses) && item.explanation === record.explanation, 'Approved content differs from recorded review');
    if (record.review.status === 'ai_approved') {
      requireThat(evidence.reviewer === AI_REVIEWER, 'AI reviewer identity missing');
      verifyAiReviewEvidence(item.aiEvidence, record);
    }
  }
}
