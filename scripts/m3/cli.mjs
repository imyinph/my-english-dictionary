import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './clients.mjs';
import { execute, loadJob } from './pipeline.mjs';
import { exportReport } from './report.mjs';
import { accept } from './acceptance.mjs';
import { qualityGate } from './model.mjs';
import { atomic } from './clients.mjs';
import { executeAzureOnly } from './azureOnly.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
try {
  const envPath = join(root, '.env.m3.local'); if (existsSync(envPath)) loadEnvFile(envPath);
  const settings = config();
  const [command = 'plan', ...args] = process.argv.slice(2);
  if (command === 'azure') {
    if (!args.includes('--execute')) throw new Error('EXPLICIT_EXECUTE_FLAG_REQUIRED');
    if (process.env.M3_DRY_RUN === 'true') throw new Error('M3_DRY_RUN_IS_TRUE');
    settings.dry = false;
    const result = await executeAzureOnly(root, settings, progress => console.log(JSON.stringify({ azureProgress: progress })));
    console.log(JSON.stringify({ ...result, senses: undefined }, null, 2));
  } else if (['preflight', 'pilot', 'run', 'retry'].includes(command)) {
    throw new Error('GEMINI_RETIRED_USE_DEEPSEEK_CLI');
  } else if (command === 'accept') {
    if (args.length !== 2 || args[0] !== '--file') throw new Error('ACCEPT_REQUIRES_EXPORTED_USER_FILE');
    const bytes = readFileSync(args[1]); if (bytes.length > 1024 * 1024) throw new Error('ACCEPTANCE_FILE_TOO_LARGE');
    const loaded = loadJob(root, settings);
    console.log(JSON.stringify(accept(root, loaded, JSON.parse(bytes.toString('utf8'))), null, 2));
    exportReport(root, loaded.job, loaded.directory);
  } else if (['plan', 'report', 'audit'].includes(command)) {
    const result = loadJob(root, settings);
    if (command === 'audit') {
      for (const task of result.job.tasks.filter(t => ['auto_pass', 'needs_review'].includes(t.status))) {
        const quality = qualityGate(task, task.postRecheckComparison ?? task.comparison, { rechecked: !!task.recheck });
        task.status = quality.status; task.quality_flags = quality.flags;
      }
      atomic(result.path, result.job);
    }
    const summary = exportReport(root, result.job, result.directory);
    console.log(JSON.stringify({ ...summary, configured: { gemini: !!settings.geminiKey, azure: !!settings.azureKey }, mode: 'offline', report: 'artifacts/m3-dual/acceptance.html' }, null, 2));
  } else throw new Error('UNKNOWN_COMMAND');
} catch (error) {
  // Never print raw fetch exceptions, URLs with credentials or response error bodies.
  const code = /^[A-Z0-9_]+$/.test(error.message) ? error.message : (error.code === 'EEXIST' ? 'ANOTHER_RUN_LOCK_EXISTS' : 'LOCAL_PIPELINE_ERROR');
  console.error(code); process.exitCode = 1;
}
