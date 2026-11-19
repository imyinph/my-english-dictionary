import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { atomic, Transport, azureTranslate } from './clients.mjs';
import { assert } from './model.mjs';

export function azureCoverage(job) {
  const completed = job.tasks.filter(t => t.azure?.text).length;
  const failed = job.tasks.filter(t => !t.azure?.text && t.azure_stage?.status === 'failed').length;
  return { totalSenses: job.tasks.length, completed, failed, missing: job.tasks.length - completed, coverage: completed / job.tasks.length, geminiGenerated: job.tasks.filter(t => t.gemini).length, statusCounts: job.tasks.reduce((r, t) => { r[t.status] = (r[t.status] ?? 0) + 1; return r; }, {}), senses: job.tasks.map(t => ({ sense_id: t.sense_id, azure: t.azure?.text ? 'complete' : t.azure_stage?.status ?? 'missing', requestHash: t.azure?.requestHash ?? null, taskStatus: t.status })) };
}

export async function processAzureOnly(job, transport, persist, onProgress = () => {}) {
  assert(transport.settings.allowGemini === false, 'AZURE_ONLY_REQUIRES_GEMINI_DISABLED');
  const missing = job.tasks.filter(t => !t.azure?.text);
  for (let offset = 0; offset < missing.length; offset += 20) {
    const batch = missing.slice(offset, offset + 20);
    try {
      const rows = await azureTranslate(transport, batch);
      for (const row of rows) {
        const task = batch.find(t => t.sense_id === row.sense_id);
        if (row.text?.trim()) {
          task.azure = row;
          task.azure_stage = { status: 'complete', completedAt: row.receivedAt };
        } else {
          task.azure_stage = { status: 'failed', code: 'AZURE_RECORD_MISSING', at: new Date().toISOString() };
          task.events.push({ type: 'azure_failure', ...task.azure_stage });
        }
        // Azure reference data never rewrites human approval, Gemini content,
        // quality flags, overall task status, or historical comparison evidence.
        persist();
      }
      onProgress({ completed: job.tasks.filter(t => t.azure?.text).length, total: job.tasks.length });
    } catch (error) {
      const code = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'AZURE_LOCAL_ERROR';
      for (const task of batch.filter(t => !t.azure?.text)) {
        task.azure_stage = { status: 'failed', code, at: new Date().toISOString() };
        task.events.push({ type: 'azure_failure', ...task.azure_stage });
      }
      persist(); throw new Error(code);
    }
  }
  return azureCoverage(job);
}

export async function executeAzureOnly(root, settings, onProgress = () => {}) {
  assert(!settings.dry, 'SET_M3_DRY_RUN_FALSE_FOR_EXECUTION');
  assert(settings.azureKey, 'MISSING_AZURE_KEY');
  const directory = join(root, '.translation-state/dual-v1'), path = join(directory, 'job.json');
  assert(existsSync(path), 'EXISTING_JOB_REQUIRED');
  const lock = join(directory, 'run.lock'); writeFileSync(lock, String(process.pid), { flag: 'wx' });
  try {
    // Read the existing checkpoint directly: no initialize, migration or model reset.
    const job = JSON.parse(readFileSync(path, 'utf8'));
    assert(job.schemaVersion === 1 && job.model === 'gemini-3-flash-preview' && job.tasks.length === 113 && new Set(job.tasks.map(t => t.sense_id)).size === 113, 'EXISTING_JOB_INVALID');
    const transport = new Transport({ ...settings, allowGemini: false }, directory);
    const run = { startedAt: new Date().toISOString(), missingAtStart: job.tasks.filter(t => !t.azure?.text).length, callsBefore: transport.ledger.calls.length, status: 'running' };
    job.azureRuns ??= []; job.azureRuns.push(run); atomic(path, job);
    try {
      await processAzureOnly(job, transport, () => atomic(path, job), onProgress);
      run.status = job.tasks.some(t => !t.azure?.text) ? 'incomplete' : 'complete';
    } catch (error) { run.status = 'paused'; run.errorCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'AZURE_LOCAL_ERROR'; }
    finally {
      run.completedAt = new Date().toISOString(); run.callsAfter = transport.ledger.calls.length;
      atomic(path, job);
      const report = { generatedAt: run.completedAt, run, ...azureCoverage(job), newGeminiRequests: transport.ledger.calls.slice(run.callsBefore).filter(c => c.provider === 'gemini').length };
      const destination = join(root, 'artifacts/m3-dual'); mkdirSync(destination, { recursive: true });
      atomic(join(destination, 'azure-coverage.json'), report);
      writeFileSync(join(destination, 'azure-coverage.md'), `# Azure 独立翻译覆盖率\n\n完成 ${report.completed}/${report.totalSenses}；失败 ${report.failed}；缺失 ${report.missing}。本次新增 Gemini 请求：${report.newGeminiRequests}。\n\nAzure 结果仅为参考，不代表正式中文审核通过。\n\n|Sense ID|Azure|原任务状态|\n|---|---|---|\n${report.senses.map(t => `|${t.sense_id}|${t.azure}|${t.taskStatus}|`).join('\n')}\n`);
    }
    if (run.errorCode) throw new Error(run.errorCode);
    return { ...azureCoverage(job), run, newGeminiRequests: 0 };
  } finally { unlinkSync(lock); }
}
