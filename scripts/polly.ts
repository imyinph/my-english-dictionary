import { PollyClient, DescribeVoicesCommand, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { atomicJson } from './audioFiles.ts';
import { loadPollyPlan, root, voices } from './pollyPlan.ts';
import { pendingJobs, restore, runBatch, safeError, summarize } from './pollyBatch.ts';

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { generate: { type: 'boolean' }, preflight: { type: 'boolean' }, profile: { type: 'string' }, region: { type: 'string' }, 'budget-usd': { type: 'string', default: '5' }, 'retry-failed': { type: 'boolean' }, 'retry-uncertain': { type: 'boolean' }, limit: { type: 'string' } } });
  const region = values.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'ap-southeast-2';
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)) throw new Error('Invalid AWS region');
  const budget = Number(values['budget-usd']), limit = values.limit === undefined ? undefined : Number(values.limit);
  if (!Number.isFinite(budget) || budget <= 0 || (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))) throw new Error('Invalid budget/limit');
  const plan = loadPollyPlan();
  const options = { directory: join(root, 'public'), stateDirectory: join(root, '.audio-state/polly'), manifestPath: join(root, 'public/data/audio-manifest.json'), budgetUsd: budget, region, retryFailed: values['retry-failed'], retryUncertain: values['retry-uncertain'], limit };
  mkdirSync(options.stateDirectory, { recursive: true });
  const lockPath = join(options.stateDirectory, 'generation.lock');
  const lock = openSync(lockPath, 'wx');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    const events = restore(plan.resources, options), pending = pendingJobs(plan.resources, options), summary = summarize(plan.resources, events, pending, plan.resources.filter(r => r.generation.status === 'ready').length);
    console.log(JSON.stringify({ mode: values.generate ? 'generate' : values.preflight ? 'preflight' : 'dry-run', region, scannedContents: plan.scannedContents, contentTypes: plan.contentTypes, budgetUsd: budget, ...summary }, null, 2));
    atomicJson(options.manifestPath, { schemaVersion: 1, resources: plan.resources });
    atomicJson(join(root, 'docs/M2-audio-report.json'), { generatedAt: new Date().toISOString(), region, scannedContents: plan.scannedContents, contentTypes: plan.contentTypes, ...summary });
    if (!values.generate && !values.preflight) return;
    if (summary.withThreeAttemptsUsd > budget) throw new Error('BudgetExceeded: adjust --budget-usd explicitly. No synthesis sent.');
    if (values.generate && pending.length === 0) return;
    // Standard AWS credential chain. Disable SDK retries: every synthesis retry must be rate/cost accounted.
    const client = new PollyClient({ region, ...(values.profile ? { profile: values.profile } : {}), maxAttempts: 1, requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 } });
    try {
      const found = new Set<string>(); let NextToken: string | undefined;
      do {
        const response = await client.send(new DescribeVoicesCommand({ Engine: 'neural', LanguageCode: 'en-US', NextToken }), { abortSignal: controller.signal });
        response.Voices?.filter(v => v.LanguageCode === 'en-US' && v.SupportedEngines?.includes('neural')).forEach(v => found.add(v.Id!));
        NextToken = response.NextToken;
      } while (NextToken);
      if (!voices.every(voice => found.has(voice))) throw new Error('Selected Joanna/Stephen Neural voices unavailable in this region. No alternate engine used.');
      console.log('Credential and DescribeVoices checks passed. SynthesizeSpeech permission is verified by the first accounted request.');
      if (!values.generate) return;
      const report = await runBatch(plan.resources, { ...options, signal: controller.signal }, async (resource, signal) => {
        const s = resource.synthesis!;
        const result = await client.send(new SynthesizeSpeechCommand({ Engine: s.engine, VoiceId: resource.voice as 'Joanna' | 'Stephen', LanguageCode: s.languageCode, OutputFormat: 'mp3', SampleRate: s.sampleRate, Text: s.requestText, TextType: s.textType }), { abortSignal: signal });
        if (!result.AudioStream || result.ContentType !== 'audio/mpeg') throw Object.assign(new Error(), { name: 'InvalidAudioResponse' });
        return { bytes: Buffer.from(await result.AudioStream.transformToByteArray()), requestCharacters: result.RequestCharacters };
      });
      atomicJson(join(root, 'docs/M2-audio-report.json'), { generatedAt: new Date().toISOString(), region, scannedContents: plan.scannedContents, contentTypes: plan.contentTypes, ...report });
      console.log(JSON.stringify(report, null, 2));
      if (report.ready !== report.totalResources) process.exitCode = 2;
    } finally { client.destroy(); }
  } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); closeSync(lock); unlinkSync(lockPath); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error && error.name === 'Error' ? error.message : safeError(error)); process.exitCode = 1; });
}
