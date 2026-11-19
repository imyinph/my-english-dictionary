import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { deepseekConfig, DeepSeekTransport, DEEPSEEK_PROMPT_VERSION, remainingScope } from './deepseek.mjs';
import { atomic } from './clients.mjs';
import { assert, digest, generationInput, sourceScopeFlags } from './model.mjs';
import { processTasks } from './pipeline.mjs';
import { exportReport } from './report.mjs';
import { accept } from './acceptance.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseDirectory = join(root, '.translation-state/dual-v1');
let directory, jobPath;
const pilotIds = ['creative:noun:3:46afaac9:0', 'make:verb:1:fed3eac9:1', 'make:verb:1:3ed13b76:8', 'destroy:verb:13:717e425b:0', 'sense:verb:16:c7c6175a:1'];
try {
  const env = join(root, '.env.deepseek.local'); if (existsSync(env)) loadEnvFile(env);
  const settings = deepseekConfig();
  directory = join(root, settings.service === 'scnet-token-plan' ? '.translation-state/deepseek-scnet-v1' : '.translation-state/deepseek-v1');
  jobPath = join(directory, 'job.json');
  const [command = 'plan', ...args] = process.argv.slice(2);
  const base = JSON.parse(readFileSync(join(baseDirectory, 'job.json'), 'utf8'));
  const load = () => {
    if (existsSync(jobPath)) {
      const job = JSON.parse(readFileSync(jobPath, 'utf8'));
      assert(job.provider === 'deepseek' && (job.service ?? 'deepseek-direct') === settings.service && job.model === settings.model && job.datasetVersion === base.datasetVersion, 'DEEPSEEK_JOB_IDENTITY_CHANGED');
      return job;
    }
    // Additive branch, never edits or renames the historical Gemini checkpoint/cache.
    const job = structuredClone(base);
    job.provider = 'deepseek'; job.service = settings.service; job.model = settings.model; job.promptVersion = DEEPSEEK_PROMPT_VERSION;
    job.branchedFrom = { file: '.translation-state/dual-v1/job.json', digest: digest(base), at: new Date().toISOString() };
    job.preflight = null; job.pilot = null;
    for (const task of job.tasks.filter(t => !t.gemini && t.status !== 'user_accepted')) {
      task.model = settings.model; task.prompt_version = DEEPSEEK_PROMPT_VERSION;
      task.jobKey = digest({ oldJobKey: task.jobKey, provider: 'deepseek', service: settings.service, model: settings.model, prompt: DEEPSEEK_PROMPT_VERSION });
    }
    return job;
  };
  if (command === 'plan') {
    const job = load();
    console.log(JSON.stringify({ provider: 'deepseek', service: settings.service, model: settings.model, configured: !!settings.key, total: job.tasks.length, azureCached: job.tasks.filter(t => t.azure?.text).length, existingAIResults: job.tasks.filter(t => t.gemini).length, missingAI: job.tasks.filter(t => t.status !== 'user_accepted' && !t.gemini).length, mode: 'offline' }, null, 2));
  } else if (['pilot', 'preflight', 'probe'].includes(command)) {
    assert(args.includes('--execute'), 'EXPLICIT_EXECUTE_FLAG_REQUIRED');
    assert(settings.key, 'MISSING_DEEPSEEK_KEY');
    const attempt = args.find(a => a.startsWith('--attempt='))?.split('=')[1];
    assert(attempt === undefined || /^[2-9]\d*$/.test(attempt), 'INVALID_EXPLICIT_ATTEMPT');
    const name = (settings.service === 'scnet-token-plan' ? 'scnet-' : '') + (command === 'pilot' ? 'deepseek-five-v1' : 'deepseek-single-v1') + (attempt ? `-attempt-${attempt}` : '');
    const staging = join(root, '.translation-state/staging', name);
    assert(!existsSync(staging), 'STAGING_EXISTS_REVIEW_BEFORE_NEW_REQUEST');
    assert(!existsSync(join(baseDirectory, 'run.lock')) && !existsSync(join(directory, 'run.lock')), 'ANOTHER_RUN_LOCK_EXISTS');
    const tasks = (command === 'pilot' ? pilotIds : pilotIds.slice(0, 1)).map(id => base.tasks.find(t => t.sense_id === id));
    assert(tasks.every(t => t?.status === 'queued' && !t.gemini && !t.events.length), 'PILOT_TASK_NOT_ELIGIBLE');
    mkdirSync(staging, { recursive: true });
    const tr = new DeepSeekTransport({ ...settings, maxRequests: 1 }, staging);
    // Only one generation call; no Azure, comparison or recheck call in the staging path.
    const result = await tr.aiCall('generate', tasks.map(t => {
      const value = generationInput(t); value.adjacent_senses = t.adjacent_senses.slice(0, 2); return value;
    }));
    const report = { provider: 'deepseek', service: result.service, model: result.modelVersion, promptVersion: DEEPSEEK_PROMPT_VERSION, senseIds: tasks.map(t => t.sense_id), requestHash: result.requestHash, schemaPassed: true, userAccepted: false, results: result.data.results.map(row => ({ ...row, sourceScopeFlags: sourceScopeFlags({ ...tasks.find(t => t.sense_id === row.sense_id), gemini: row }) })) };
    atomic(join(staging, 'report.json'), report);
    writeFileSync(join(staging, 'review.md'), '# DeepSeek 小批量待验收\n\n未写入正式中文或原断点。\n\n' + report.results.map(r => `## ${r.sense_id}\n\n${r.english_definition}\n\n简释：${r.glosses.join('；')}\n\n解释：${r.explanation}\n\n风险标记：${r.sourceScopeFlags.join('；') || '本地规则未检出；不等于语义审核通过'}\n`).join('\n'));
    console.log(JSON.stringify({ staging, ...report, httpStatus: tr.ledger.calls.at(-1)?.httpStatus, durationMs: tr.ledger.calls.at(-1)?.durationMs }, null, 2));
  } else if (['run', 'retry', 'accept'].includes(command)) {
    // Explicit batch opt-in is separate from the already authorized pilot.
    assert(args.includes('--execute'), 'EXPLICIT_EXECUTE_FLAG_REQUIRED');
    if (command !== 'accept') { assert(args.includes('--allow-batch'), 'BATCH_REQUIRES_USER_ACCEPTANCE'); assert(settings.key, 'MISSING_DEEPSEEK_KEY'); }
    mkdirSync(directory, { recursive: true }); const lock = join(directory, 'run.lock'); writeFileSync(lock, String(process.pid), { flag: 'wx' });
    try {
      const job = load();
      if (command === 'accept') {
        const file = args[args.indexOf('--file') + 1]; assert(args.includes('--file') && file, 'ACCEPT_REQUIRES_EXPORTED_USER_FILE');
        const input = readFileSync(file); assert(input.length <= 1024 * 1024, 'ACCEPTANCE_FILE_TOO_LARGE');
        console.log(JSON.stringify(accept(root, { job, path: jobPath, directory }, JSON.parse(input)), null, 2));
      } else {
        const tr = new DeepSeekTransport({ ...settings, maxRetries: args.includes('--auto-retry') ? 6 : 0 }, directory);
        let selected = job.tasks.filter(t => !['user_accepted', 'user_rejected', 'auto_pass'].includes(t.status));
        if (args.includes('--remaining')) {
          selected = remainingScope(base, job);
          assert(selected.length === 88, 'EXPECTED_88_REMAINING_TASKS');
          job.executionScope = { type: 'original_88_queued', senseIds: selected.map(t => t.sense_id), promptVersion: DEEPSEEK_PROMPT_VERSION };
        }
        if (command === 'retry') {
          const ids = args.filter(a => !a.startsWith('--')); assert(ids.length && ids.every(id => selected.some(t => t.sense_id === id)), 'INVALID_RETRY_IDS');
          selected = selected.filter(t => ids.includes(t.sense_id));
          for (const task of selected) { task.generationRevision = (task.generationRevision ?? 1) + 1; task.events.push({ type: 'explicit_deepseek_retry', at: new Date().toISOString() }); }
          tr.ledger.pauseHistory ??= []; if (tr.ledger.paused) tr.ledger.pauseHistory.push(tr.ledger.paused); delete tr.ledger.paused; tr.persist();
        }
        assert(selected.every(t => t.azure?.text), 'AZURE_CACHE_REQUIRED_NO_AUTOMATIC_AZURE_CALLS');
        for (const t of selected.filter(t => t.status === 'failed')) t.status = t.gemini ? 'gemini_completed' : 'azure_completed';
        atomic(jobPath, job);
        await processTasks(job, selected, tr, () => atomic(jobPath, job));
        console.log(JSON.stringify(exportReport(join(root, 'artifacts/deepseek'), job, directory), null, 2));
      }
    } finally { unlinkSync(lock); }
  } else if (command === 'report') {
    console.log(JSON.stringify(exportReport(join(root, 'artifacts/deepseek'), load(), directory), null, 2));
  } else throw new Error('UNKNOWN_DEEPSEEK_COMMAND');
} catch (error) {
  console.error(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'DEEPSEEK_LOCAL_ERROR'); process.exitCode = 1;
}
