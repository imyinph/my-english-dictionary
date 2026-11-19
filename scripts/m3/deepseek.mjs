import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { atomic, sanitize, retryTiming, sleep } from './clients.mjs';
import { assert, digest, schemas, prompts, validateGeneration, validateComparison, validateRecheck } from './model.mjs';

const promptConfig = JSON.parse(readFileSync(new URL('../../config/deepseek-prompt.json', import.meta.url), 'utf8'));
export const DEEPSEEK_PROMPT_VERSION = promptConfig.version;
export const DEEPSEEK_RECHECK_PROMPT_VERSION = 'deepseek-recheck-source-bound-zh-v3';
export function remainingScope(base, job) {
  const ids = new Set(base.tasks.filter(t => t.status === 'queued' && !t.gemini && !t.events.length).map(t => t.sense_id));
  const selected = job.tasks.filter(t => ids.has(t.sense_id));
  assert(selected.length === ids.size, 'REMAINING_SCOPE_IDENTITY_MISMATCH');
  return selected.filter(t => !['user_accepted', 'user_rejected', 'auto_pass'].includes(t.status));
}
export function deepseekConfig(env = process.env) {
  const integer = (key, fallback, max) => { const n = Number(env[key] ?? fallback); assert(Number.isSafeInteger(n) && n > 0 && n <= max, `INVALID_${key}`); return n; };
  const endpoint = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  assert(['https://api.deepseek.com', 'https://api.scnet.cn/api/llm/v1'].includes(endpoint), 'UNVERIFIED_DEEPSEEK_ENDPOINT');
  const service = endpoint === 'https://api.scnet.cn/api/llm/v1' ? 'scnet-token-plan' : 'deepseek-direct';
  const model = env.DEEPSEEK_MODEL || (service === 'scnet-token-plan' ? 'DeepSeek-V4.1-Flash' : 'deepseek-flash');
  assert((service === 'scnet-token-plan' ? ['DeepSeek-V4.1-Flash', 'DeepSeek-V4.1-Flash-1017-Event'] : ['deepseek-flash', 'deepseek-v4-pro']).includes(model), 'UNVERIFIED_DEEPSEEK_MODEL');
  return { provider: 'deepseek', service, key: env.DEEPSEEK_API_KEY || '', model, endpoint: endpoint + '/chat/completions', batch: integer('DEEPSEEK_BATCH_SIZE', 5, 5), rpm: integer('DEEPSEEK_MAX_RPM', 4, 8), maxRequests: integer('DEEPSEEK_MAX_REQUESTS', 120, 500), maxTokens: integer('DEEPSEEK_TOKEN_LIMIT', 300000, 1000000) };
}
function example(schema) {
  if (schema.type === 'OBJECT') return Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, example(v)]));
  if (schema.type === 'ARRAY') return [example(schema.items)];
  if (schema.type === 'NUMBER') return .8;
  if (schema.type === 'BOOLEAN') return false;
  return schema.enum?.[0] ?? '...';
}
export function deepseekBody(settings, stage, inputs) {
  assert(['generate', 'compare', 'recheck'].includes(stage), 'INVALID_AI_STAGE');
  assert(inputs.length > 0 && inputs.length <= settings.batch, 'INVALID_AI_BATCH');
  let instruction = stage === 'generate' ? promptConfig.generate : prompts[stage].replaceAll('Gemini', 'the candidate model');
  if (stage === 'recheck') instruction += '\nFIELD SEPARATION: explanation must be a concise reader-facing dictionary explanation of this English sense, never a review report. Put ALL provider comparisons, translation critiques, reasoning, and correction rationale in evidence, not explanation or glosses. Never mention Azure, Gemini, DeepSeek, candidate models or which translation is preferable in explanation. Use 1-3 nonredundant glosses. Every claim in explanation must be supported by the current definition, original examples or tags; do not introduce specialist background, inferred scenarios or new example sentences. Do not treat plausible background as source evidence. If unresolved, keep a conservative source-bound explanation and put uncertainties in unresolved. When source_context is supplied, its verified rawGlosses, topics, rawTags and source notes are evidence for this exact sense, not new unrelated meanings. Supplementary research excerpts may clarify grammar but must not be copied into user examples. Judge the current corrected candidate, not superseded historical drafts; the absence of an example alone does not prove a clear definition untranslatable. The enum value gemini means the AI candidate for legacy schema compatibility, not its actual provider.';
  const normalized = inputs.map(({ gemini_result, ...rest }) => ({ ...rest, ...(gemini_result ? { ai_candidate: gemini_result } : {}) }));
  return { model: settings.model, messages: [{ role: 'system', content: instruction + '\nNo tools, browsing or grounding. Return JSON only. Required schema (type names follow the supplied schema): ' + JSON.stringify(schemas[stage]) + '\nExample JSON shape (placeholders, not content): ' + JSON.stringify(example(schemas[stage])) }, { role: 'user', content: JSON.stringify({ senses: normalized }) }], thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 8192, temperature: .2, stream: false, tool_choice: 'none' };
}

/** Single-concurrency; automatic retries require an explicit per-run setting. */
export class DeepSeekTransport {
  constructor(settings, directory, { fetcher = fetch, wait = sleep, now = Date.now, random = Math.random } = {}) {
    Object.assign(this, { settings, directory, fetcher, wait, now, random }); mkdirSync(directory, { recursive: true });
    assert(Number.isInteger(settings.maxRetries ?? 0) && (settings.maxRetries ?? 0) >= 0 && (settings.maxRetries ?? 0) <= 6, 'INVALID_RETRY_LIMIT');
    this.path = join(directory, 'calls.json');
    this.ledger = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : { calls: [], reservedTokens: 0 };
    this.busy = false;
  }
  persist() { atomic(this.path, sanitize(this.ledger, [this.settings.key])); }
  async request() { throw new Error('DEEPSEEK_ONLY_NO_AZURE_OR_GOOGLE'); }
  async aiCall(stage, inputs, variant = '') {
    assert(!this.busy, 'DEEPSEEK_CONCURRENT_CALL_BLOCKED'); this.busy = true;
    try {
      let rootHash;
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await this.single(stage, inputs, attempt ? `${variant}:auto-retry-${attempt}` : variant, attempt);
          // Reuse a validated retry on future calls without reissuing the failed original.
          if (rootHash) atomic(join(this.directory, rootHash + '.json'), result);
          return result;
        } catch (error) {
          const c = this.ledger.calls.at(-1);
          const transient = /^DEEPSEEK_(NETWORK_OR_BODY_ERROR|HTTP_(408|429|5\d\d))$/.test(error.message);
          const invalidOutput = /^DEEPSEEK_(SCHEMA_INVALID|EMPTY_JSON|INCOMPLETE_OR_BLOCKED|TOO_MANY_GLOSSES|REVIEW_COMMENTARY)$/.test(error.message);
          const limit = invalidOutput ? Math.min(2, this.settings.maxRetries ?? 0) : (this.settings.maxRetries ?? 0);
          if (!c || (!transient && !invalidOutput) || attempt >= limit) throw error;
          rootHash ??= c.requestHash;
          const timing = retryTiming(new Headers(c.responseHeaders), c.response, this.now(), attempt, this.random);
          c.retryPlan = { ...timing, retryAttempt: attempt + 1, nextRetryAt: new Date(this.now() + timing.delayMs).toISOString() };
          // A server minimum over ten minutes pauses instead of retrying too early.
          this.persist();
          if (timing.pause) throw error;
          while (this.now() < Date.parse(c.retryPlan.nextRetryAt)) await this.wait(Math.min(60000, Date.parse(c.retryPlan.nextRetryAt) - this.now()));
          this.ledger.pauseHistory ??= [];
          this.ledger.pauseHistory.push({ ...this.ledger.paused, automaticResume: true, at: new Date(this.now()).toISOString() });
          delete this.ledger.paused;
          this.persist();
        }
      }
    } finally { this.busy = false; }
  }
  async single(stage, inputs, variant, retryAttempt = 0) {
    assert(this.settings.key && !/^your[_-]|paste|替换/i.test(this.settings.key), 'MISSING_DEEPSEEK_KEY');
    if (this.settings.service === 'scnet-token-plan') assert(this.settings.key.startsWith('sk-tp-'), 'SCNET_TOKEN_PLAN_KEY_REQUIRED_NO_PAYG_FALLBACK');
    const body = deepseekBody(this.settings, stage, inputs);
    const promptVersion = stage === 'recheck' ? DEEPSEEK_RECHECK_PROMPT_VERSION : DEEPSEEK_PROMPT_VERSION;
    const requestHash = digest({ provider: 'deepseek', service: this.settings.service, endpoint: this.settings.endpoint, promptVersion, stage, body, variant });
    const cache = join(this.directory, requestHash + '.json');
    if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
    assert(!this.ledger.paused, 'DEEPSEEK_PAUSED');
    assert(!this.ledger.calls.some(c => c.requestHash === requestHash), 'DEEPSEEK_PREVIOUS_ATTEMPT_REQUIRES_REVIEW');
    assert(this.ledger.calls.length < this.settings.maxRequests, 'DEEPSEEK_REQUEST_BUDGET');
    const reserve = Buffer.byteLength(JSON.stringify(body)) + 1024 + body.max_tokens;
    assert(this.ledger.reservedTokens + reserve <= this.settings.maxTokens, 'DEEPSEEK_TOKEN_BUDGET');
    const last = this.ledger.calls.at(-1);
    const waitUntil = last ? Date.parse(last.startedAt) + Math.ceil(60000 / this.settings.rpm) : 0;
    while (this.now() < waitUntil) await this.wait(Math.min(60000, waitUntil - this.now()));
    const record = { provider: 'deepseek', service: this.settings.service, purpose: stage, requestHash, requestedModel: this.settings.model, actualModel: null, endpoint: this.settings.endpoint, api: 'chat/completions', promptVersion: DEEPSEEK_PROMPT_VERSION, request: body, senseIds: inputs.map(t => t.sense_id), startedAt: new Date(this.now()).toISOString(), completedAt: null, httpStatus: null, durationMs: null, status: 'in_flight', automaticRetries: 0, responseHeaders: {}, requestIds: {}, retryAfter: null, retryDelay: [], errorDetails: null, tokenReservation: reserve };
    record.automaticRetries = retryAttempt;
    record.promptVersion = promptVersion;
    this.ledger.calls.push(record); this.ledger.reservedTokens += reserve; this.persist();
    const started = performance.now();
    let errorCode = null;
    try {
      const response = await this.fetcher(this.settings.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${this.settings.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(60000) });
      record.httpStatus = response.status;
      record.responseHeaders = Object.fromEntries([...response.headers].filter(([k]) => !/auth|cookie|api.?key|token|credential|secret|password/i.test(k)));
      record.requestIds = Object.fromEntries(Object.entries(record.responseHeaders).filter(([k]) => /request.?id|trace|correlation/i.test(k)));
      record.retryAfter = response.headers.get('retry-after');
      const raw = await response.text();
      try { record.response = JSON.parse(raw); } catch { record.responseText = raw; }
      record.retryDelay = retryTiming(response.headers, record.response, this.now(), 0, () => 0).retryDelay;
      record.errorDetails = record.response?.error?.details ?? null;
      record.actualModel = record.response?.model ?? null;
      record.usage = record.response?.usage ?? null;
      if (Number.isSafeInteger(record.usage?.total_tokens)) this.ledger.reservedTokens += record.usage.total_tokens - reserve;
      if (!response.ok) errorCode = `DEEPSEEK_HTTP_${response.status}`;
      else {
        try {
          const choice = record.response?.choices?.[0];
          assert(choice?.finish_reason === 'stop' && !choice.message?.tool_calls?.length && !choice.message?.server_tool_calls?.length && !choice.message?.refusal, 'DEEPSEEK_INCOMPLETE_OR_BLOCKED');
          const content = choice.message.content;
          assert(typeof content === 'string' && content.trim(), 'DEEPSEEK_EMPTY_JSON');
          const data = JSON.parse(content);
          if (stage === 'generate') { validateGeneration(data, inputs); assert(data.results.every(r => r.glosses.length <= 3), 'DEEPSEEK_TOO_MANY_GLOSSES'); }
          else if (stage === 'compare') validateComparison(data, inputs);
          else { validateRecheck(data, inputs); assert(data.results.every(r => r.glosses.length <= 3), 'DEEPSEEK_TOO_MANY_GLOSSES'); assert(data.results.every(r => !/Azure|Gemini|DeepSeek|候选|译文|译法/i.test(r.explanation)), 'DEEPSEEK_REVIEW_COMMENTARY'); }
          record.validatedData = data;
        } catch (error) { record.validationError = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'INVALID_JSON'; errorCode = /^DEEPSEEK_[A-Z_]+$/.test(error.message) ? error.message : 'DEEPSEEK_SCHEMA_INVALID'; }
      }
    } catch (error) {
      // Store diagnostics without messages/URLs that could contain credentials.
      const safeCode = v => typeof v === 'string' && /^[A-Za-z0-9_]+$/.test(v) ? v : null;
      record.networkError = { name: safeCode(error.name), code: safeCode(error.code), causeCode: safeCode(error.cause?.code), causeName: safeCode(error.cause?.name) };
      errorCode = 'DEEPSEEK_NETWORK_OR_BODY_ERROR';
    }
    record.completedAt = new Date(this.now()).toISOString(); record.durationMs = Math.round(performance.now() - started);
    record.status = errorCode ? 'failed' : 'success'; record.errorCode = errorCode;
    if (errorCode) this.ledger.paused = { reason: errorCode, requestHash, at: record.completedAt };
    this.persist();
    if (errorCode) throw new Error(errorCode);
    const result = sanitize({ data: record.validatedData, requestHash, provider: 'deepseek', service: this.settings.service, modelVersion: record.actualModel ?? this.settings.model, promptVersion, receivedAt: record.completedAt }, [this.settings.key]);
    atomic(cache, result); return result;
  }
}
