import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseKaikkiDataset, normalizeQuery } from '../src/providers/kaikkiAdapter.ts';
import type { SenseLocation } from '../src/providers/kaikkiAdapter.ts';
import type { Sense } from '../src/domain/dictionary.ts';
import type { ChineseContentBundle, ChineseRecord, ChineseTarget, ContentIdentity, ContentIdentityRegistry, ContentReference, TranslationContext } from '../src/domain/chineseContent.ts';
import { chineseRecordId, chineseTargetId } from '../src/domain/chineseContent.ts';

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const normalizedGloss = (value: string) => normalizeQuery(value).replace(/[.;:]+$/u, '');
export const contentSha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sorted = (values: string[]) => [...new Set(values)].sort();
const requireThat = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };

export interface SourceCandidate {
  id: string;
  headword: string;
  partOfSpeech: string;
  chineseText: string;
  sourceSense: string | null;
  sourceRef: ContentReference;
  exactTargetIds: string[];
  contextTargetIds: string[];
  disposition: 'exact_unique' | 'unmatched' | 'ambiguous';
}

export interface ContentInventory {
  registry: ContentIdentityRegistry;
  initialContent: ChineseContentBundle;
  candidates: SourceCandidate[];
}

/** No position/legacy ID is included; the parent sense context prevents cross-sense reuse. */
export function identityFingerprint(target: Pick<ContentIdentity, 'target' | 'englishText' | 'context'>): string {
  return contentSha256(JSON.stringify({ kind: target.target.kind, englishText: target.englishText, context: target.context }));
}

export function collectContentInventory(snapshotBytes: string | Uint8Array, migratedAt: string): ContentInventory {
  const snapshotSha = contentSha256(snapshotBytes);
  const snapshot = row(JSON.parse(typeof snapshotBytes === 'string' ? snapshotBytes : Buffer.from(snapshotBytes).toString('utf8')));
  const records = rows(snapshot.records);
  const provenance = rows(snapshot.provenance);
  const observed: { sense: Sense; location: SenseLocation }[] = [];
  const entries = parseKaikkiDataset(snapshot, (sense, location) => observed.push({ sense, location }));
  const targets: ContentIdentity[] = [];
  const candidates: SourceCandidate[] = [];
  const sourceCandidates = new Map<string, SourceCandidate>();

  for (const { sense, location } of observed) {
    const { entryId, recordIndex, senseIndex } = location;
    const record = records[recordIndex], raw = rows(record.senses)[senseIndex];
    const meta = provenance.find(item => item.word === record.word);
    const reference = (pointer: string): ContentReference => {
      requireThat(sense.source.referenceUrl && sense.source.licenseUrl && meta?.url && /^[a-f0-9]{64}$/.test(text(meta?.sha256)), 'Missing source provenance');
      return {
        snapshotPath: 'data/kaikki-subset.json', snapshotSha256: snapshotSha, jsonPointer: pointer,
        referenceUrl: sense.source.referenceUrl!, extractionUrl: text(meta!.url), extractedFileSha256: text(meta!.sha256),
        license: sense.source.license, licenseUrl: sense.source.licenseUrl!, attribution: sense.source.attribution,
      };
    };
    const basePointer = `/records/${recordIndex}/senses/${senseIndex}`;
    const context: TranslationContext = {
      headword: text(record.word), partOfSpeech: sense.partOfSpeech, glosses: strings(raw.glosses),
      tags: sorted(sense.tags ?? []), examples: sorted(sense.examples.map(example => example.text)),
      sourceSenseIds: sorted([text(raw.id), ...strings(raw.id), text(raw.senseid), ...strings(raw.senseid)].filter(Boolean)),
      etymologyNumber: typeof record.etymology_number === 'number' || typeof record.etymology_number === 'string' ? record.etymology_number : null,
    };
    const addTarget = (target: ChineseTarget, englishText: string, pointers: string[]) => {
      const identity = { target, englishText, context, sourceFingerprint: '', englishSourceRefs: pointers.map(reference) };
      identity.sourceFingerprint = identityFingerprint(identity);
      targets.push(identity);
    };
    addTarget({ kind: 'sense', entryId, senseId: sense.id }, sense.definition, [`${basePointer}/glosses`]);
    for (const example of sense.examples) {
      const pointers = rows(raw.examples).flatMap((item, index) => item.type === 'example' && !text(item.ref) && text(item.text) === example.text ? [`${basePointer}/examples/${index}`] : []);
      requireThat(pointers.length, `Missing example origin: ${example.id}`);
      addTarget({ kind: 'example', entryId, senseId: sense.id, exampleId: example.id }, example.text, pointers);
    }
    for (const [items, pointer, direct] of [
      [record.translations, `/records/${recordIndex}/translations`, false],
      [raw.translations, `${basePointer}/translations`, true],
    ] as const) {
      rows(items).forEach((item, index) => {
        if (!['zh', 'cmn'].includes(text(item.code)) || !text(item.word)) return;
        const jsonPointer = `${pointer}/${index}`;
        let candidate = sourceCandidates.get(jsonPointer);
        if (!candidate) {
          candidate = {
            id: `source:${snapshotSha}:${jsonPointer}`, headword: context.headword, partOfSpeech: context.partOfSpeech,
            chineseText: text(item.word), sourceSense: text(item.sense) || null, sourceRef: reference(jsonPointer),
            exactTargetIds: [], contextTargetIds: [], disposition: 'unmatched',
          };
          candidates.push(candidate); sourceCandidates.set(jsonPointer, candidate);
        }
        candidate.contextTargetIds.push(sense.id);
        if (direct || (text(item.sense) && normalizedGloss(text(item.sense)) === normalizedGloss(sense.definition))) candidate.exactTargetIds.push(sense.id);
      });
    }
  }
  for (const candidate of candidates) {
    candidate.exactTargetIds = sorted(candidate.exactTargetIds);
    candidate.contextTargetIds = sorted(candidate.contextTargetIds);
    candidate.disposition = candidate.exactTargetIds.length === 1 ? 'exact_unique' : candidate.exactTargetIds.length ? 'ambiguous' : 'unmatched';
  }
  const allIds = targets.map(identity => chineseTargetId(identity.target));
  requireThat(new Set(allIds).size === allIds.length, 'Duplicate target identity');
  requireThat(new Set(targets.map(identity => identity.sourceFingerprint)).size === targets.length, 'Ambiguous source identity; explicit reconciliation required');
  const initialRecords: ChineseRecord[] = targets.map(identity => {
    const legacy = observed.find(item => item.sense.id === identity.target.senseId)!;
    const original = identity.target.kind === 'sense' ? legacy.sense.translation : undefined;
    const allMatches = candidates.filter(item => item.exactTargetIds.includes(chineseTargetId(identity.target)));
    // Preserve the adapter's preference for sense-level translations over record-level rows.
    const direct = allMatches.filter(item => /\/senses\/\d+\/translations\//u.test(item.sourceRef.jsonPointer));
    const matches = direct.length ? direct : allMatches;
    if (original) requireThat([...new Set(matches.map(item => item.chineseText))].join('；') === original, `Chinese provenance mismatch: ${identity.target.senseId}`);
    const ambiguous = matches.some(item => item.disposition !== 'exact_unique');
    return {
      id: chineseRecordId(identity.target, 1), revision: 1, target: identity.target, englishText: identity.englishText, context: identity.context,
      sourceFingerprint: identity.sourceFingerprint, sourceSnapshotSha256: snapshotSha, locale: 'zh', chineseText: original ?? null,
      status: original ? ambiguous ? 'needs_review' : 'source_verified' : 'unavailable', origin: original ? 'source' : null,
      sourceRefs: original ? matches.map(item => item.sourceRef) : [], generator: null, review: null,
      publication: original && !ambiguous ? 'released' : 'draft', updatedAt: migratedAt,
      reason: original ? ambiguous ? '来源行对应多个义项，需人工核对。' : '源中文与当前义项精确对应；未声称经过人工语义审核。' : '当前快照未提供可可靠对应的中文内容，待补充。',
    };
  });
  return {
    registry: { schemaVersion: 1, dictionaryVersion: snapshotSha, entries: entries.map(entry => ({ entryId: entry.id, headword: entry.headword, kind: entry.kind })), targets },
    initialContent: { schemaVersion: 1, dictionaryVersion: snapshotSha, contentRevision: 1, currentRecordIds: initialRecords.map(record => record.id), records: initialRecords },
    candidates,
  };
}

/** Staged-import plan only. Never rewrites production IDs, the registry, or audio. */
export function planIdentityReconciliation(previous: ContentIdentityRegistry, incoming: ContentIdentityRegistry) {
  const mappings: { incomingTarget: ChineseTarget; retainedTarget: ChineseTarget }[] = [];
  const unresolved: { target: ChineseTarget; reason: 'changed_or_new' | 'ambiguous' }[] = [];
  const matches = (registry: ContentIdentityRegistry, identity: ContentIdentity) => registry.targets.filter(other => other.sourceFingerprint === identity.sourceFingerprint);
  for (const identity of incoming.targets) {
    const old = matches(previous, identity);
    if (old.length === 1 && matches(incoming, identity).length === 1) mappings.push({ incomingTarget: identity.target, retainedTarget: old[0].target });
    else unresolved.push({ target: identity.target, reason: old.length > 1 || matches(incoming, identity).length > 1 ? 'ambiguous' : 'changed_or_new' });
  }
  const retained = new Set(mappings.map(item => chineseTargetId(item.retainedTarget)));
  return { mappings, unresolved, orphaned: previous.targets.filter(item => !retained.has(chineseTargetId(item.target))).map(item => item.target) };
}

function exactKeys(value: Row, keys: string[], label: string) {
  requireThat(isDeepStrictEqual(Object.keys(value).sort(), keys.sort()), `Invalid ${label} fields`);
}
function validTime(value: unknown) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/u.test(value) && Number.isFinite(Date.parse(value)); }

/** Validates untrusted JSON, immutable seed history, contextual references and release policy. */
export function validateContentFiles(registryInput: unknown, bundleInput: unknown, inventory: ContentInventory): ChineseContentBundle {
  requireThat(isDeepStrictEqual(registryInput, inventory.registry), 'Identity registry differs from frozen dictionary; reconcile explicitly');
  const input = row(bundleInput);
  exactKeys(input, ['schemaVersion', 'dictionaryVersion', 'contentRevision', 'currentRecordIds', 'records'], 'bundle');
  requireThat(input.schemaVersion === 1 && input.dictionaryVersion === inventory.registry.dictionaryVersion, 'Unsupported schema or stale dictionary version');
  requireThat(Number.isSafeInteger(input.contentRevision) && Number(input.contentRevision) >= 1, 'Invalid content revision');
  requireThat(Array.isArray(input.records) && Array.isArray(input.currentRecordIds), 'Missing records or current selections');
  const registry = new Map(inventory.registry.targets.map(identity => [chineseTargetId(identity.target), identity]));
  const seeds = new Map(inventory.initialContent.records.map(record => [chineseTargetId(record.target), record]));
  const validated = new Map<string, ChineseRecord>();
  const recordKeys = Object.keys(inventory.initialContent.records[0]);
  for (const unknownRecord of input.records as unknown[]) {
    const record = row(unknownRecord);
    exactKeys(record, [...recordKeys], 'record');
    const target = row(record.target);
    requireThat(target.kind === 'sense' || target.kind === 'example', 'Invalid target kind');
    const targetId = target.kind === 'sense' ? target.senseId : target.exampleId;
    const identity = registry.get(String(targetId));
    requireThat(identity && isDeepStrictEqual(target, identity.target), 'Orphaned or cross-sense target');
    requireThat(record.englishText === identity!.englishText && isDeepStrictEqual(record.context, identity!.context) && record.sourceFingerprint === identity!.sourceFingerprint && record.sourceSnapshotSha256 === inventory.registry.dictionaryVersion, 'Stale or mismatched English context');
    requireThat(Number.isSafeInteger(record.revision) && Number(record.revision) >= 1 && record.id === chineseRecordId(identity!.target, Number(record.revision)), 'Invalid revision identity');
    requireThat(!validated.has(String(record.id)), 'Duplicate translation revision');
    requireThat(record.locale === 'zh' && validTime(record.updatedAt) && text(record.reason), 'Invalid locale, date or reason');
    requireThat(['source_verified', 'human_reviewed', 'ai_draft', 'needs_review', 'unavailable'].includes(String(record.status)), 'Unknown translation status');
    requireThat(['draft', 'released'].includes(String(record.publication)), 'Invalid publication');
    requireThat(['source', 'ai', 'human', null].includes(record.origin as string | null), 'Invalid origin');
    requireThat(record.chineseText === null || (typeof record.chineseText === 'string' && text(record.chineseText)), 'Empty Chinese text is not completion');
    requireThat(Array.isArray(record.sourceRefs), 'Invalid source references');
    if (record.status !== 'unavailable' && record.status !== 'needs_review') requireThat(text(record.chineseText), 'Translation status requires content');
    if (record.publication === 'released') requireThat(['source_verified', 'human_reviewed'].includes(String(record.status)), 'Unreviewed content cannot be released');
    if (record.origin === 'source') {
      const seed = seeds.get(String(targetId))!;
      requireThat(seed.origin === 'source' && record.chineseText === seed.chineseText && isDeepStrictEqual(record.sourceRefs, seed.sourceRefs) && record.generator === null, 'Unverified or forged source translation');
    } else requireThat((record.sourceRefs as unknown[]).length === 0, 'Non-source translation cannot claim dictionary source');
    if (record.status === 'source_verified') requireThat(record.origin === 'source' && seeds.get(String(targetId))!.status === 'source_verified', 'False source verification');
    if (record.origin === 'ai') {
      const generator = row(record.generator);
      exactKeys(generator, ['provider', 'model', 'promptVersion', 'jobId', 'generatedAt'], 'generator');
      requireThat(['provider', 'model', 'promptVersion', 'jobId'].every(key => text(generator[key])) && validTime(generator.generatedAt), 'Missing AI provenance');
    } else requireThat(record.generator === null, 'Generator requires AI origin');
    if (record.status === 'ai_draft') requireThat(record.origin === 'ai', 'Draft must retain AI origin');
    if (record.review !== null) {
      const review = row(record.review);
      exactKeys(review, ['reviewer', 'reviewedAt', 'decision'], 'review');
      requireThat(text(review.reviewer) && validTime(review.reviewedAt) && ['approved', 'rejected'].includes(String(review.decision)), 'Invalid human review');
      if (review.decision === 'rejected') requireThat(record.status === 'needs_review', 'Rejected content requires review');
    }
    if (record.status === 'human_reviewed') requireThat(record.origin !== null && row(record.review).decision === 'approved', 'Missing human approval');
    if (record.status === 'unavailable') requireThat(record.chineseText === null && record.origin === null && record.generator === null && record.review === null, 'Unavailable content must remain absent');
    if (record.origin === null) requireThat(record.chineseText === null && ['unavailable', 'needs_review'].includes(String(record.status)), 'Missing translation origin');
    validated.set(String(record.id), record as unknown as ChineseRecord);
  }
  for (const seed of inventory.initialContent.records) requireThat(isDeepStrictEqual(validated.get(seed.id), seed), 'Original migration history changed or missing');
  for (const identity of inventory.registry.targets) {
    const revisions = [...validated.values()].filter(record => chineseTargetId(record.target) === chineseTargetId(identity.target)).sort((a, b) => a.revision - b.revision);
    revisions.forEach((record, index) => {
      requireThat(record.revision === index + 1, 'Missing intermediate revision history');
      requireThat(Number(input.contentRevision) >= record.revision, 'Bundle revision must advance with record revisions');
      if (index) requireThat(Date.parse(record.updatedAt) >= Date.parse(revisions[index - 1].updatedAt), 'Revision date precedes history');
    });
  }
  const currentTargets = new Set<string>();
  for (const id of input.currentRecordIds as unknown[]) {
    const record = typeof id === 'string' ? validated.get(id) : undefined;
    requireThat(record, 'Unknown current revision');
    const targetId = chineseTargetId(record!.target);
    requireThat(!currentTargets.has(targetId), 'Multiple current revisions for one target');
    currentTargets.add(targetId);
  }
  requireThat(currentTargets.size === registry.size, 'Incomplete target status coverage');
  return bundleInput as ChineseContentBundle;
}

/** Later import/edit tools must supply the persisted bundle to protect ALL prior revisions. */
export function validateContentUpdate(previous: unknown, proposed: unknown, inventory: ContentInventory): ChineseContentBundle {
  const before = validateContentFiles(inventory.registry, previous, inventory);
  const after = validateContentFiles(inventory.registry, proposed, inventory);
  if (isDeepStrictEqual(before, after)) return after;
  requireThat(after.contentRevision === before.contentRevision + 1, 'Content update must advance bundle revision by one');
  const records = new Map(after.records.map(record => [record.id, record]));
  for (const old of before.records) requireThat(isDeepStrictEqual(records.get(old.id), old), 'Cannot overwrite or remove prior revision history');
  return after;
}

export function summarizeContent(inventory: ContentInventory, bundle: ChineseContentBundle) {
  const selected = new Set(bundle.currentRecordIds);
  const current = bundle.records.filter(record => selected.has(record.id));
  const statuses = Object.fromEntries(['source_verified', 'human_reviewed', 'ai_draft', 'needs_review', 'unavailable'].map(status => [status, current.filter(record => record.status === status).length]));
  return {
    schemaVersion: 1, dictionaryVersion: bundle.dictionaryVersion, contentRevision: bundle.contentRevision,
    entries: inventory.registry.entries.length, senses: current.filter(record => record.target.kind === 'sense').length,
    examples: current.filter(record => record.target.kind === 'example').length, statusTargets: current.length,
    reliableTranslations: current.filter(record => record.publication === 'released').length, statuses,
    missingTargetIds: current.filter(record => record.chineseText === null).map(record => chineseTargetId(record.target)),
    sourceCandidates: { total: inventory.candidates.length, exactUnique: inventory.candidates.filter(item => item.disposition === 'exact_unique').length, unmatched: inventory.candidates.filter(item => item.disposition === 'unmatched').length, ambiguous: inventory.candidates.filter(item => item.disposition === 'ambiguous').length },
    translationApiRequests: 0, pollyRequests: 0,
  };
}
