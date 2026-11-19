import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadSenseHistory } from '../senseTranslations.ts';
import { atomic, Transport, azureTranslate, geminiCall } from './clients.mjs';
import { PROMPT_VERSION, RECHECK_POLICY_VERSION, digest, assert, generationInput, comparisonInput, validateGeneration, validateRecheck, localTriage } from './model.mjs';

export function initialize(root, settings) {
  const { inventory, history } = loadSenseHistory();
  const indexPath = join(root, 'artifacts/ecdict/index.json');
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : null;
  const summary = JSON.parse(readFileSync(join(root, 'content/ecdict-match-summary.json'), 'utf8'));
  assert(summary.dictionaryVersion === history.dictionaryVersion, 'STALE_ECDICT_SUMMARY');
  const current = history.records.filter(r => history.currentRecordIds.includes(r.id));
  const identities = inventory.registry.targets.filter(t => t.target.kind === 'sense');
  const now = new Date().toISOString();
  const tasks = identities.map(identity => {
    const record = current.find(r => r.senseId === identity.target.senseId);
    const match = summary.senses.find(r => r.senseId === identity.target.senseId);
    const ecdict = (match?.candidates ?? []).flatMap(candidate => {
      const source = index?.records.find(r => r.recordId === candidate.sourceRecordId);
      return source ? [{ source_record_id: source.recordId, english: source.definitions.filter(d => d.sourceLine === candidate.englishSourceLine), chinese: source.translations.filter(t => candidate.chineseContextLineRefs.includes(t.sourceLine)), warning: 'unaligned_candidate_upstream_license_unresolved' }] : [];
    });
    const adjacent = identities.filter(t => t.target.entryId === identity.target.entryId && t.target.senseId !== identity.target.senseId && t.context.partOfSpeech === identity.context.partOfSpeech).map(t => ({ sense_id: t.target.senseId, definition: t.englishText, tags: t.context.tags }));
    const task = { sense_id: identity.target.senseId, entry_id: identity.target.entryId, word: identity.context.headword, pos: identity.context.partOfSpeech, english_definition: identity.englishText, examples: identity.context.examples, tags: identity.context.tags, sourceFingerprint: identity.sourceFingerprint, sourceRefs: identity.englishSourceRefs, adjacent_senses: adjacent, ecdict_candidates: ecdict, ecdictAvailability: index ? 'loaded' : 'local_index_missing', dataset_version: history.dictionaryVersion, model: settings.model, prompt_version: PROMPT_VERSION, status: record.review.status === 'approved' ? 'user_accepted' : 'queued', translation_status: record.review.status === 'approved' ? 'complete' : 'missing', accepted_content: record.review.status === 'approved' ? { glosses: record.glosses, explanation: record.explanation, recordId: record.id } : null, azure: null, gemini: null, comparison: null, recheck: null, quality_flags: [], confidence: null, events: [], created_at: now, updated_at: now };
    task.jobKey = digest({ sense_id: task.sense_id, sourceFingerprint: task.sourceFingerprint, dataset: task.dataset_version, model: task.model, prompt: PROMPT_VERSION, ecdict, adjacent });
    return task;
  });
  return { schemaVersion: 1, datasetVersion: history.dictionaryVersion, promptVersion: PROMPT_VERSION, model: settings.model, createdAt: now, pilot: null, tasks };
}

export function loadJob(root, settings) {
  const directory = join(root, '.translation-state/dual-v1'); mkdirSync(directory, { recursive: true });
  const path = join(directory, 'job.json'), fresh = initialize(root, settings);
  if (!existsSync(path)) { atomic(path, fresh); return { job: fresh, path, directory }; }
  const prior = JSON.parse(readFileSync(path, 'utf8'));
  // Reject identity/model drift; never archive and rebuild an existing job implicitly.
  assert(prior.schemaVersion === 1 && prior.datasetVersion === fresh.datasetVersion && prior.promptVersion === fresh.promptVersion && prior.model === fresh.model && prior.tasks.length === fresh.tasks.length && prior.tasks.every(t => fresh.tasks.some(f => f.sense_id === t.sense_id && f.jobKey === t.jobKey)), 'JOB_IDENTITY_CHANGED_CREATE_NEW_VERSION');
  for (const freshTask of fresh.tasks.filter(t => t.status === 'user_accepted')) {
    const task = prior.tasks.find(t => t.sense_id === freshTask.sense_id);
    task.status = 'user_accepted'; task.accepted_content = freshTask.accepted_content; task.translation_status = 'complete';
  }
  return { job: prior, path, directory };
}
export function stats(job, ledger = { calls: [] }) {
  const tasks = job.tasks, calls = ledger.calls;
  return { entries: new Set(tasks.map(t => t.entry_id)).size, totalSenses: tasks.length, existingUserAccepted: tasks.filter(t => t.status === 'user_accepted').length, azureSuccess: tasks.filter(t => t.azure?.text).length, geminiSuccess: tasks.filter(t => t.gemini).length, consistent: tasks.filter(t => t.comparison?.core_consistent).length, conflictRechecked: tasks.filter(t => t.recheck).length, autoPass: tasks.filter(t => t.status === 'auto_pass').length, needsReview: tasks.filter(t => t.status === 'needs_review').length, failed: tasks.filter(t => t.status === 'failed').length, queued: tasks.filter(t => t.status === 'queued').length, statusCounts: Object.fromEntries([...new Set(tasks.map(t => t.status))].map(s => [s, tasks.filter(t => t.status === s).length])), apiRequests: calls.length, successfulRequests: calls.filter(c => c.status === 'success').length, activeProvider: job.provider ?? 'gemini', deepseekInputTokens: calls.filter(c => c.provider === 'deepseek').reduce((n,c) => n + (c.usage?.prompt_tokens ?? 0), 0), deepseekOutputTokens: calls.filter(c => c.provider === 'deepseek').reduce((n,c) => n + (c.usage?.completion_tokens ?? 0), 0), googleInputTokens: calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0), googleOutputTokens: calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0), googleThoughtTokens: calls.reduce((n, c) => n + (c.thoughtTokens ?? 0), 0), azureSubmittedCharacters: calls.reduce((n, c) => n + c.translatedCharacters, 0), actualCostUsd: null, costNote: job.provider === 'deepseek' ? 'DeepSeek metered API; usage is recorded, actual billing is not returned. No top-up or plan changes.' : 'F0 / Express free-tier eligibility supplied by user; actual billing unavailable from these APIs. No plan upgrades or credit operations.' };
}

export async function processTasks(job, selected, transport, persist) {
  const update = (task, status) => { task.status = status; task.updated_at = new Date().toISOString(); persist(); };
  const failed = (tasks, error) => { for (const task of tasks) { task.events.push({ type: 'failure', code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_PROCESSING_ERROR', errorType: error.name, localFrames: String(error.stack).split('\n').slice(1, 4).filter(s => s.includes('/scripts/') || s.includes('\\scripts\\')), at: new Date().toISOString() }); update(task, 'failed'); } };
  const mustStop = error => /DEEPSEEK_|BUDGET|MISSING_.*KEY|HTTP_40[134]|HTTP_429|NETWORK_ERROR|RETRY_LATER|RETRY_LIMIT|COOLDOWN|PAUSED|DISABLED/.test(error.message);
  // Azure arrays have a stable input order; save each valid row before retrying a failed row.
  for (let offset = 0; offset < selected.length; offset += 20) {
    const batch = selected.slice(offset, offset + 20).filter(t => !t.azure?.text);
    if (!batch.length) continue;
    try {
      for (const row of await azureTranslate(transport, batch)) {
        const task = batch.find(t => t.sense_id === row.sense_id);
        if (row.text) { task.azure = row; update(task, task.gemini ? 'gemini_completed' : 'azure_completed'); }
        else failed([task], new Error('AZURE_RECORD_MISSING'));
      }
    } catch (error) { failed(batch, error); if (mustStop(error)) throw error; }
  }
  const generate = async (batch, variant = '') => {
    try {
      const result = await geminiCall(transport, 'generate', batch.map(generationInput), variant);
      const rows = validateGeneration(result.data, batch);
      for (const row of rows) {
        const task = batch.find(t => t.sense_id === row.sense_id);
        task.gemini = row; task.translation_status = 'candidate'; task.generationMetadata = { requestHash: result.requestHash, modelVersion: result.modelVersion, receivedAt: result.receivedAt, ...(result.provider ? { provider: result.provider, service: result.service, promptVersion: result.promptVersion } : {}) };
        update(task, 'gemini_completed');
      }
    } catch (error) {
      if (mustStop(error)) { failed(batch, error); throw error; }
      if (batch.length > 1 && /SCHEMA|MISSING_OR_EXTRA|DUPLICATE|SOURCE_ECHO|INVALID_GENERATION|INCOMPLETE/.test(error.message)) {
        for (const task of batch) await generate([task], 'split-single');
      } else failed(batch, error);
    }
  };
  const pending = selected.filter(t => !t.gemini && t.status !== 'failed');
  for (let offset = 0; offset < pending.length; offset += transport.settings.batch) await generate(pending.slice(offset, offset + transport.settings.batch));
  // No blanket comparison calls. Local rules flag risk; they cannot certify meaning.
  for (const task of selected.filter(t => t.azure?.text && t.gemini && t.status !== 'failed')) {
    if (task.status === 'user_accepted') continue;
    task.localCheck = localTriage(task);
    if (task.localCheck.priorSemanticPass && !task.recheck) {
      update(task, 'auto_pass'); continue;
    }
    task.quality_flags = [...task.localCheck.flags, 'semantic_review_not_confirmed'];
    update(task, 'needs_review');
    if (!task.localCheck.needsGeminiRecheck) continue;
    try {
      const result = await geminiCall(transport, 'recheck', [comparisonInput(task)]);
      task.recheck = validateRecheck(result.data, [task])[0];
      task.recheckMetadata = { requestHash: result.requestHash, previousCandidateHash: digest(task.gemini), modelVersion: result.modelVersion, policyVersion: RECHECK_POLICY_VERSION, ...(result.provider ? { provider: result.provider, service: result.service, promptVersion: result.promptVersion } : {}) };
      task.original_gemini = structuredClone(task.gemini);
      if (task.recheck.resolved && !task.recheck.unresolved.length && task.recheck.preferred !== 'neither') {
        task.gemini = { ...task.gemini, glosses: task.recheck.glosses, explanation: task.recheck.explanation, uncertainties: [] };
        task.candidateMetadata = { ...task.recheckMetadata, receivedAt: result.receivedAt };
      }
      task.localCheck = localTriage(task);
      task.quality_flags = [...task.localCheck.flags, task.recheck.resolved ? 'recheck_requires_review' : 'recheck_unresolved'];
      // Preserve evidence and stop here. No compare-after-recheck loop and no
      // unverified auto approval merely because the same model revised itself.
      update(task, 'needs_review');
    } catch (error) { failed([task], error); if (mustStop(error)) throw error; }
  }
  for (const task of selected) { task.translation_status = task.gemini ? 'candidate' : 'missing'; }
  persist();
}

export async function execute(root, settings, { pilot = false, retry = [], preflight = false, retryFailed = false } = {}) {
  assert(settings.allowGemini === true, 'GEMINI_DISABLED_PENDING_USER_CONFIRMATION');
  assert(!settings.dry, 'SET_M3_DRY_RUN_FALSE_FOR_EXECUTION');
  assert(settings.geminiKey && settings.azureKey, 'MISSING_API_KEYS');
  const loaded = loadJob(root, settings), { job, path, directory } = loaded;
  const lock = join(directory, 'run.lock'); writeFileSync(lock, String(process.pid), { flag: 'wx' });
  try {
    const transport = new Transport({ ...settings, retryFailed }, directory);
    if (preflight) {
      const task = job.tasks.find(t => t.status !== 'user_accepted');
      if (task.status === 'failed') task.status = task.gemini ? 'gemini_completed' : task.azure ? 'azure_completed' : 'queued';
      await processTasks(job, [task], transport, () => atomic(path, job));
      assert(task.azure?.text && task.gemini, 'PREFLIGHT_DID_NOT_COMPLETE');
      job.preflight = { completedAt: new Date().toISOString(), sense_id: task.sense_id, expressEndpointVerified: true, structuredJsonVerified: true, azureVerified: true };
    } else {
      assert(job.preflight, 'RUN_PREFLIGHT_FIRST');
      if (!pilot) assert(job.pilot?.passed, 'PILOT_MUST_PASS_BEFORE_FULL_RUN');
      const all = job.tasks.filter(t => t.status !== 'user_accepted' && t.status !== 'user_rejected');
      if (retry.length) {
        assert(retry.every(id => all.some(t => t.sense_id === id)), 'RETRY_IDS_UNKNOWN_OR_ACCEPTED');
        for (const task of all.filter(t => retry.includes(t.sense_id))) { task.events.push({ type: 'explicit_retry', at: new Date().toISOString() }); task.status = task.gemini ? 'gemini_completed' : task.azure ? 'azure_completed' : 'queued'; }
      }
      const scope = retry.length ? all.filter(t => retry.includes(t.sense_id)) : pilot ? all.slice(0, 10) : all;
      if (retryFailed || retry.length) for (const task of scope.filter(t => t.status === 'failed')) task.status = task.comparison ? 'needs_review' : task.gemini ? 'gemini_completed' : task.azure ? 'azure_completed' : 'queued';
      if (pilot && retry.length === 0) for (const task of scope.filter(t => t.status === 'failed' && t.events.at(-1)?.code === 'LOCAL_PROCESSING_ERROR')) task.status = task.gemini ? 'gemini_completed' : task.azure ? 'azure_completed' : 'queued';
      const selected = scope.filter(t => !['auto_pass', 'failed'].includes(t.status) && (t.status !== 'needs_review' || retryFailed || retry.length));
      await processTasks(job, selected, transport, () => atomic(path, job));
      if (pilot) job.pilot = { senseIds: scope.map(t => t.sense_id), completedAt: new Date().toISOString(), passed: scope.length === 10 && scope.every(t => t.azure?.text && t.gemini && ['auto_pass', 'needs_review'].includes(t.status)), acceptance: 'not_user_accepted' };
    }
    atomic(path, job); return { ...loaded, summary: stats(job, transport.ledger) };
  } finally { unlinkSync(lock); }
}
