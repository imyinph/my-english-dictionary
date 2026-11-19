import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildPlan, root, sha256, synthesisBody } from './audio-plan.mjs';
import { atomicJson, isMp3 } from './audioFiles.ts';
export { atomicJson, isMp3 } from './audioFiles.ts';

const manifestPath = join(root, 'public/data/audio-audition.json');
const publicRoot = join(root, 'public');
export function verifiedAsset(resource, directory = publicRoot) {
  if (!resource.asset || !/^audio\/audition\/[a-f0-9]{64}\.mp3$/.test(resource.asset.path)) return false;
  try { const data = readFileSync(join(directory, resource.asset.path)); return data.length === resource.asset.bytes && sha256(data) === resource.asset.sha256; } catch { return false; }
}
export function estimate(resources, samples, price) {
  // Conservative estimate: count the full serialized request (including SSML and config),
  // and reserve three billable attempts. This is NOT a provider billing meter or hard cloud cap.
  const characters = resources.reduce((n, r) => n + [...JSON.stringify(synthesisBody(r, samples.find(s => s.id === r.target.contentId)))].length, 0);
  return { jobs: resources.length, conservativeCharacters: characters, oneAttemptUsd: characters * price / 1e6, threeAttemptsUsd: characters * price * 3 / 1e6 };
}
export async function synthesize(resource, sample, env, fetcher = fetch) {
  let url, headers, body;
  if (resource.provider === 'azure') {
    if (!env.AZURE_SPEECH_KEY || !/^[a-z0-9-]+$/.test(env.AZURE_SPEECH_REGION ?? '') || env.AZURE_SPEECH_TIER !== 'S0') throw new Error('Configure AZURE_SPEECH_KEY, AZURE_SPEECH_REGION and AZURE_SPEECH_TIER=S0 locally.');
    url = `https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
    headers = { 'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3', 'User-Agent': 'PersonalDictionaryAudition' };
    body = synthesisBody(resource, sample);
  } else {
    if (!env.GOOGLE_ACCESS_TOKEN || !/^[a-z][a-z0-9-]{4,62}$/.test(env.GOOGLE_CLOUD_PROJECT ?? '')) throw new Error('Configure a short-lived GOOGLE_ACCESS_TOKEN and GOOGLE_CLOUD_PROJECT locally.');
    url = 'https://texttospeech.googleapis.com/v1/text:synthesize';
    headers = { Authorization: `Bearer ${env.GOOGLE_ACCESS_TOKEN}`, 'x-goog-user-project': env.GOOGLE_CLOUD_PROJECT, 'Content-Type': 'application/json' };
    body = JSON.stringify(synthesisBody(resource, sample));
  }
  const response = await fetcher(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    // Do not log response bodies, headers, requests, tokens or provider diagnostic URLs.
    const error = new Error(`HTTP ${response.status}`);
    error.retryable = response.status === 429 || response.status >= 500;
    const retryAfter = response.headers.get('retry-after');
    error.retryAfter = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : retryAfter ? Math.max(0, (Date.parse(retryAfter) - Date.now()) / 1000) : 2;
    throw error;
  }
  const data = resource.provider === 'azure' ? Buffer.from(await response.arrayBuffer()) : Buffer.from((await response.json()).audioContent ?? '', 'base64');
  if (!isMp3(data)) throw new Error('Provider returned invalid MP3; no audio published.');
  return data;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { generate: { type: 'boolean', default: false }, provider: { type: 'string' }, voice: { type: 'string' }, limit: { type: 'string', default: '8' }, 'budget-usd': { type: 'string', default: '0.25' }, 'usd-per-million': { type: 'string' } } });
  if (values.generate) throw new Error('M1 provider synthesis retired. Use scripts/polly.ts with the selected Neural voices.');
  const limit = Number(values.limit), budget = Number(values['budget-usd']);
  if (!Number.isInteger(limit) || limit < 1 || limit > 96 || !Number.isFinite(budget) || budget <= 0 || budget > 1) throw new Error('Audition limits: 1–96 jobs; budget > 0 and <= USD 1.');
  if (values.provider && !['azure', 'google'].includes(values.provider)) throw new Error('Provider must be azure or google.');
  if (values.generate && !values.provider) throw new Error('Select exactly one --provider before synthesis.');
  const plan = buildPlan();
  if (values.voice && !plan.candidates.some(c => c.voice === values.voice && (!values.provider || c.provider === values.provider))) throw new Error('Voice is not in this audition plan.');
  let old;
  try { old = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* First plan. */ }
  for (const resource of plan.resources) {
    const previous = old?.resources?.find(r => r.id === resource.id);
    if (previous && verifiedAsset(previous)) { resource.asset = previous.asset; resource.generation = previous.generation; resource.review = previous.review; }
  }
  const selected = plan.resources.filter(r => (!values.provider || r.provider === values.provider) && (!values.voice || r.voice === values.voice));
  const pending = selected.filter(r => !verifiedAsset(r)).slice(0, limit);
  const estimates = ['azure', 'google'].map(provider => {
    const rate = values['usd-per-million'] ? Number(values['usd-per-million']) : provider === 'azure' ? 15 : 30;
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Unit price must be positive.');
    return { provider, usdPerMillion: rate, ...estimate(pending.filter(r => r.provider === provider), plan.samples, rate) };
  });
  console.log(JSON.stringify({ mode: values.generate ? 'generate-audition' : 'dry-run', planJobs: plan.resources.length, selectedPendingJobs: pending.length, estimates, budgetUsd: budget, note: 'No free allowance deducted. Includes three attempts; excludes tax/storage/egress. No bulk dictionary generation.' }, null, 2));
  if (values.generate && estimates.reduce((sum, e) => sum + e.threeAttemptsUsd, 0) > budget) throw new Error('Estimate exceeds budget; reduce --limit.');
  if (!values.generate) { atomicJson(manifestPath, plan); return; }
  // Validate every credential requirement before any HTTP request or manifest mutation.
  if (values.provider === 'azure' && (!process.env.AZURE_SPEECH_KEY || !/^[a-z0-9-]+$/.test(process.env.AZURE_SPEECH_REGION ?? '') || process.env.AZURE_SPEECH_TIER !== 'S0')) throw new Error('Missing Azure local settings (KEY, REGION, TIER=S0). No requests sent.');
  if (values.provider === 'google' && (!process.env.GOOGLE_ACCESS_TOKEN || !/^[a-z][a-z0-9-]{4,62}$/.test(process.env.GOOGLE_CLOUD_PROJECT ?? ''))) throw new Error('Missing Google local settings (ACCESS_TOKEN, CLOUD_PROJECT). No requests sent.');
  let failed = 0;
  for (const resource of pending) {
    const sample = plan.samples.find(s => s.id === resource.target.contentId);
    for (let attempt = 1; attempt <= 3; attempt++) {
      resource.generation.attempts++;
      try {
        const data = await synthesize(resource, sample, process.env);
        const checksum = sha256(data), path = `audio/audition/${checksum}.mp3`;
        mkdirSync(join(publicRoot, 'audio/audition'), { recursive: true });
        writeFileSync(join(publicRoot, `${path}.tmp`), data); renameSync(join(publicRoot, `${path}.tmp`), join(publicRoot, path));
        resource.asset = { path, format: 'mp3', sha256: checksum, bytes: data.length };
        resource.generation = { status: 'ready', generatedAt: new Date().toISOString(), attempts: resource.generation.attempts };
        resource.review = { status: 'pending' };
        console.log(`Saved ${resource.voice} / ${sample.id}; listening review pending.`); break;
      } catch (error) {
        const safeError = /^HTTP \d+$/.test(error.message) ? error.message : 'Synthesis/network/MP3 validation failed';
        resource.generation.status = 'failed'; resource.generation.error = safeError;
        if (!error.retryable || attempt === 3 || !Number.isFinite(error.retryAfter) || error.retryAfter > 30) { failed++; console.error(`Failed ${resource.voice} / ${sample.id}: ${safeError}`); break; }
        await new Promise(resolve => setTimeout(resolve, Math.max(error.retryAfter, 2 ** attempt) * 1000));
      }
    }
    atomicJson(manifestPath, plan);
    // Stop the run on a failed item rather than hammering a bad credential/unsupported voice.
    if (failed) break;
  }
  if (failed) throw new Error('Stopped after a failed sample. Successful verified files are retained; rerun explicitly after diagnosis.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Cross-process lock also prevents dry-run from overwriting an in-flight manifest.
  const lock = join(root, 'artifacts/audio-generation.lock');
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  let fd;
  try { fd = openSync(lock, 'wx'); await main(); }
  catch (error) { console.error(error.code === 'EEXIST' ? 'Another generator is running (or a stale artifacts/audio-generation.lock needs inspection).' : error.message); process.exitCode = 1; }
  finally { if (fd !== undefined) { closeSync(fd); if (existsSync(lock)) unlinkSync(lock); } }
}
