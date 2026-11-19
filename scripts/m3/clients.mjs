import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { digest, assert, schemas, prompts } from './model.mjs';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function atomic(path, value) {
  const temporary = path + '.tmp'; writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n'); renameSync(temporary, path);
}
export function config(env = process.env) {
  const integer = (key, fallback, min, max) => { const n = Number(env[key] ?? fallback); assert(Number.isSafeInteger(n) && n >= min && n <= max, `INVALID_${key}`); return n; };
  const endpoint = env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com';
  assert(endpoint.replace(/\/$/, '') === 'https://api.cognitive.microsofttranslator.com', 'UNVERIFIED_AZURE_ENDPOINT');
  assert((env.AZURE_TRANSLATOR_API_VERSION || '3.0') === '3.0', 'UNVERIFIED_AZURE_VERSION');
  const model = env.GOOGLE_GEMINI_MODEL || 'gemini-3-flash-preview';
  assert(model === 'gemini-3-flash-preview', 'UNVERIFIED_GEMINI_MODEL');
  return { allowGemini: false, geminiKey: env.GOOGLE_GEMINI_API_KEY || '', azureKey: env.AZURE_TRANSLATOR_KEY || '', model, endpoint: endpoint.replace(/\/$/, ''), region: env.AZURE_TRANSLATOR_REGION || '', version: '3.0', rpm: integer('M3_GEMINI_MAX_RPM', 8, 1, 8), batch: integer('M3_GEMINI_BATCH_SIZE', 5, 1, 5), maxRequests: integer('M3_MAX_REQUESTS', 120, 1, 500), maxCharacters: integer('M3_AZURE_CHARACTER_LIMIT', 30000, 1, 100000), maxTokens: integer('M3_GEMINI_TOKEN_LIMIT', 300000, 1000, 1000000), dry: env.M3_DRY_RUN !== 'false' };
}

export const MAX_RETRY_WAIT_MS = 600000;
export function sanitize(value, secrets = []) {
  const cleanString = value => {
    let text = value;
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[REDACTED]');
    return text.replace(/AIza[\w-]+/g, '[REDACTED]')
      .replace(/\b(Bearer|Basic)\s+[^\s"'<>]+/gi, '$1 [REDACTED]')
      .replace(/((?:[?&]|\b)(?:key|api[_-]?key|access_token|authorization|x-goog-api-key|ocp-apim-subscription-key)\s*[=:]\s*)[^\s&"'<>]+/gi, '$1[REDACTED]');
  };
  if (typeof value === 'string') return cleanString(value);
  if (Array.isArray(value)) return value.map(v => sanitize(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /authorization|cookie|api.?key|subscription.?key|access.?token|refresh.?token|secret|password|credential/i.test(k) ? '[REDACTED]' : sanitize(v, secrets)]));
  return value;
}
function retryDurations(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Object.hasOwn(value, 'retryDelay')) found.push(value.retryDelay);
  for (const item of Object.values(value)) if (item && typeof item === 'object') retryDurations(item, found);
  return found;
}
export function retryTiming(headers, body, now, retryIndex, random = Math.random) {
  const raw = headers.get('retry-after');
  const headerMs = raw === null ? NaN : /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) * 1000 : Date.parse(raw) - now;
  const durations = retryDurations(body);
  const millis = durations.map(v => typeof v === 'string' && /^\d+(\.\d+)?s$/.test(v) ? Number(v.slice(0, -1)) * 1000 : v && typeof v === 'object' && v.seconds !== undefined ? Number(v.seconds) * 1000 + Number(v.nanos ?? 0) / 1e6 : NaN);
  const waits = [headerMs, ...millis].filter(v => Number.isFinite(v) && v >= 0);
  // Use the longest server minimum. Never truncate a server wait and retry early.
  const delayMs = waits.length ? Math.ceil(Math.max(...waits)) : Math.min(MAX_RETRY_WAIT_MS, Math.round(30000 * 2 ** retryIndex * (1 + .25 * random())));
  return { delayMs, source: waits.length ? 'server' : 'exponential_jitter', retryAfter: raw, retryDelay: durations, pause: delayMs > MAX_RETRY_WAIT_MS };
}

/** Serial transport with persistent cache, rate history and conservative reservations. */
export class Transport {
  constructor(settings, directory, { fetcher = fetch, wait = sleep, now = Date.now, random = Math.random } = {}) {
    Object.assign(this, { settings, directory, fetcher, wait, now, random }); mkdirSync(directory, { recursive: true });
    this.ledgerPath = join(directory, 'calls.json');
    this.ledger = existsSync(this.ledgerPath) ? JSON.parse(readFileSync(this.ledgerPath, 'utf8')) : { calls: [], googleTokens: 0, azureCharacters: 0 };
  }
  redact(value) { return sanitize(value, [this.settings.geminiKey, this.settings.azureKey]); }
  persist() { atomic(this.ledgerPath, this.redact(this.ledger)); }
  async waitUntil(timestamp) { while (this.now() < timestamp) await this.wait(Math.min(60000, timestamp - this.now())); }
  pauseGemini(reason, call) {
    this.ledger.geminiPause = { reason, requestHash: call.requestHash, at: new Date(this.now()).toISOString(), notBefore: call.nextRetryAt ?? null, requiresExplicitResume: true };
    this.persist(); throw new Error(reason);
  }
  async request(provider, purpose, body, { characters = 0, variant = '' } = {}) {
    assert(!this.settings.dry, 'DRY_RUN_NO_NETWORK');
    const isGoogle = provider === 'gemini', key = isGoogle ? this.settings.geminiKey : this.settings.azureKey;
    if (isGoogle) assert(this.fetcher !== fetch, 'GEMINI_RETIRED_USE_DEEPSEEK');
    if (isGoogle) { assert(this.settings.allowGemini === true, 'GEMINI_DISABLED_PENDING_USER_CONFIRMATION'); assert(!this.ledger.geminiPause, 'GEMINI_PAUSED'); }
    assert(key, `MISSING_${provider.toUpperCase()}_KEY`);
    const requestHash = digest({ provider, purpose, body, model: this.settings.model, apiVersion: this.settings.version, variant });
    const cachePath = join(this.directory, requestHash + '.json');
    if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'));
    // Every attempt is counted, including interrupted and uncertain attempts.
    const priorAttempts = this.ledger.calls.filter(c => c.requestHash === requestHash).length;
    // Initial attempt + at most six retries, persisted across process restarts.
    const attemptLimit = isGoogle ? 7 : this.settings.retryFailed ? 6 : 3;
    assert(priorAttempts < attemptLimit, 'RETRY_LIMIT_REACHED');
    const inputReservation = Buffer.byteLength(JSON.stringify(body), 'utf8') + 1024;
    const tokenReservation = isGoogle ? inputReservation + body.generationConfig.maxOutputTokens : 0;
    const previous = this.ledger.calls.filter(c => c.requestHash === requestHash).at(-1);
    if (isGoogle && previous?.nextRetryAt && Date.parse(previous.nextRetryAt) - this.now() > MAX_RETRY_WAIT_MS) this.pauseGemini('GEMINI_SERVER_WAIT_PAUSED', previous);
    if (previous?.nextRetryAt) await this.waitUntil(Date.parse(previous.nextRetryAt));
    for (let attempt = priorAttempts; attempt < (isGoogle ? attemptLimit : Math.min(priorAttempts + 3, attemptLimit)); attempt++) {
      assert(this.ledger.calls.length < this.settings.maxRequests, 'REQUEST_BUDGET_REACHED');
      assert(this.ledger.azureCharacters + characters <= this.settings.maxCharacters, 'AZURE_CHARACTER_BUDGET_REACHED');
      assert(this.ledger.googleTokens + tokenReservation <= this.settings.maxTokens, 'GEMINI_TOKEN_BUDGET_REACHED');
      if (isGoogle) {
        const history = this.ledger.calls.filter(c => c.provider === 'gemini'), last = history.at(-1);
        const rpm = history.some(c => c.httpStatus === 429) ? Math.min(4, this.settings.rpm) : this.settings.rpm;
        const delay = last ? last.startedAtMs + Math.ceil(60000 / rpm) + 100 - this.now() : 0;
        if (delay > 0) await this.waitUntil(this.now() + delay);
      }
      const url = isGoogle ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${this.settings.model}:generateContent` : `${this.settings.endpoint}/translate?api-version=3.0&from=en&to=zh-Hans`;
      const call = { provider, purpose, requestHash, model: isGoogle ? this.settings.model : null, apiVersion: isGoogle ? 'v1' : '3.0', endpoint: url, senseCount: isGoogle ? JSON.parse(body.contents[0].parts[0].text).senses.length : body.length, attempt: attempt + 1, startedAtMs: this.now(), startedAt: new Date(this.now()).toISOString(), status: 'in_flight', httpStatus: null, reservedTokens: tokenReservation, translatedCharacters: characters };
      this.ledger.calls.push(call); this.ledger.googleTokens += tokenReservation; this.ledger.azureCharacters += characters; this.persist();
      let response;
      try {
        const headers = isGoogle ? { 'x-goog-api-key': key } : { 'Ocp-Apim-Subscription-Key': key, ...(this.settings.region ? { 'Ocp-Apim-Subscription-Region': this.settings.region } : {}) };
        response = await this.fetcher(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
      } catch { call.status = 'network_error'; call.completedAt = new Date(this.now()).toISOString(); this.persist(); throw new Error(`${provider.toUpperCase()}_NETWORK_ERROR`); }
      call.httpStatus = response.status;
      call.responseHeaders = this.redact(Object.fromEntries([...response.headers].filter(([name]) => /^(retry-after|date|server|content-type|request-id|x-request-id|x-correlation-id|traceparent|x-cloud-trace-context|x-goog-.*|x-google-.*|x-ms-.*)$/.test(name) && !/auth|cookie|key|token|credential|secret/i.test(name))));
      call.requestIds = Object.fromEntries(Object.entries(call.responseHeaders).filter(([name]) => /request.?id|trace|correlation/i.test(name)));
      if (!response.ok) {
        let detail;
        try {
          const raw = await response.text();
          try { detail = JSON.parse(raw); call.errorResponse = this.redact(detail); }
          catch { call.errorResponseText = this.redact(raw); }
          call.error = this.redact(detail?.error ?? { code: response.status, status: null, message: 'Non-JSON error body; see errorResponseText' });
        } catch { call.error = { code: response.status, status: null, message: 'Error body could not be read' }; }
        const timing = retryTiming(response.headers, detail, this.now(), attempt, this.random);
        call.retryAfter = timing.retryAfter; call.retryDelay = timing.retryDelay;
        call.status = 'http_error'; call.completedAt = new Date(this.now()).toISOString(); this.persist();
        if (isGoogle && (response.status === 429 || response.status >= 500)) {
          call.retryPolicy = timing;
          call.nextRetryAt = new Date(this.now() + timing.delayMs).toISOString(); this.persist();
          if (attempt === attemptLimit - 1) this.pauseGemini('GEMINI_RETRY_EXHAUSTED_PAUSED', call);
          if (timing.pause) this.pauseGemini('GEMINI_SERVER_WAIT_PAUSED', call);
          await this.waitUntil(Date.parse(call.nextRetryAt)); continue;
        }
        if ((response.status === 429 || response.status >= 500) && attempt < Math.min(priorAttempts + 3, attemptLimit) - 1) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const delay = Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, Math.min(30000, (response.status === 429 ? 15000 : 1000) * 2 ** (attempt - priorAttempts) + Math.floor(this.random() * 500)));
          if (delay > 30000) throw new Error(`${provider.toUpperCase()}_RETRY_LATER`);
          await this.wait(delay); continue;
        }
        throw new Error(`${provider.toUpperCase()}_HTTP_${response.status}`);
      }
      let data;
      try { data = await response.json(); } catch { call.status = 'invalid_json'; this.persist(); throw new Error(`${provider.toUpperCase()}_INVALID_JSON`); }
      call.status = 'success'; call.completedAt = new Date(this.now()).toISOString();
      if (isGoogle) {
        const usage = data.usageMetadata ?? {};
        call.inputTokens = usage.promptTokenCount ?? null; call.outputTokens = usage.candidatesTokenCount ?? null; call.thoughtTokens = usage.thoughtsTokenCount ?? null; call.modelVersion = data.modelVersion ?? this.settings.model;
        if (Number.isSafeInteger(usage.totalTokenCount)) this.ledger.googleTokens += usage.totalTokenCount - tokenReservation;
      }
      this.persist();
      const result = this.redact({ provider, purpose, requestHash, request: body, response: data, receivedAt: call.completedAt });
      atomic(cachePath, result); return result;
    }
    throw new Error('RETRY_LIMIT_REACHED');
  }
}

export function azureText(task) { return `${task.word} (${task.pos})\n${task.english_definition}`; }
export async function azureTranslate(transport, tasks) {
  const texts = tasks.map(azureText), characters = texts.reduce((n, t) => n + t.length, 0);
  assert(tasks.length <= 1000 && characters <= 50000, 'AZURE_REQUEST_LIMIT');
  const result = await transport.request('azure', 'translate', texts.map(Text => ({ Text })), { characters });
  assert(Array.isArray(result.response) && result.response.length === tasks.length, 'AZURE_RESPONSE_ALIGNMENT');
  return tasks.map((task, index) => {
    const translations = result.response[index]?.translations;
    const translation = translations?.find(t => t.to === 'zh-Hans');
    return { sense_id: task.sense_id, text: typeof translation?.text === 'string' ? translation.text : null, requestHash: result.requestHash, inputText: texts[index], originalDefinition: task.english_definition, apiVersion: '3.0', receivedAt: result.receivedAt };
  });
}
export async function geminiCall(transport, stage, inputs, variant = '') {
  // Legacy field/function names remain for immutable historical records.
  if (transport.settings.provider === 'deepseek') return transport.aiCall(stage, inputs, variant);
  const body = { systemInstruction: { parts: [{ text: prompts[stage] }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify({ senses: inputs }) }] }], generationConfig: { temperature: transport.settings.model.startsWith('gemini-3') ? 1 : .1, maxOutputTokens: 8192, responseMimeType: 'application/json', responseSchema: schemas[stage] } };
  const result = await transport.request('gemini', stage, body, { variant });
  const candidate = result.response.candidates?.[0];
  assert(candidate?.finishReason === 'STOP', 'GEMINI_INCOMPLETE_OR_BLOCKED');
  const raw = candidate.content?.parts?.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  try { return { data: JSON.parse(raw), requestHash: result.requestHash, modelVersion: result.response.modelVersion ?? transport.settings.model, receivedAt: result.receivedAt }; }
  catch { throw new Error('GEMINI_SCHEMA_JSON_INVALID'); }
}
