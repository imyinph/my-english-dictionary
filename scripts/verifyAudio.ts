import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePollyManifest } from '../src/providers/pollyManifest.ts';
import { verifiedAudio, validatePollyMp3 } from './audioFiles.ts';
import { loadPollyPlan } from './pollyPlan.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, process.argv.includes('--dist') ? 'dist' : 'public');
const manifest = parsePollyManifest(JSON.parse(readFileSync(join(directory, 'data/audio-manifest.json'), 'utf8')));
const current = loadPollyPlan();
if (current.resources.length !== manifest.resources.length || current.resources.some(r => !manifest.resources.some(m => m.id === r.id && JSON.stringify(m.targets) === JSON.stringify(r.targets)))) throw new Error('Manifest is stale. Run pnpm audio:plan / audio:generate before building.');
for (const r of manifest.resources) {
  if (process.argv.includes('--complete') && r.review.status === 'rejected') throw new Error(`Rejected pronunciation: ${r.id}`);
  if (r.generation.status === 'ready') {
    if (!verifiedAudio(r.asset, directory)) throw new Error(`Missing/corrupt audio ${r.id}`);
    validatePollyMp3(readFileSync(join(directory, r.asset!.path)));
  } else if (process.argv.includes('--complete')) throw new Error(`Incomplete audio: ${r.id} (${r.generation.status})`);
}
if (process.argv.includes('--dist')) {
  function check(dir: string) {
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, file.name);
      if (file.name.startsWith('.env') || /credentials|generation\.lock|ledger\.jsonl/.test(file.name)) throw new Error('Private config/state in build');
      if (file.isDirectory()) check(path);
      else if (/\.(js|json|html|map)$/.test(file.name)) {
        const text = readFileSync(path, 'utf8');
        if (/AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|aws_secret_access_key|SynthesizeSpeechCommand|@aws-sdk\/client-polly|(?:AKIA|ASIA)[A-Z0-9]{16}/.test(text)) throw new Error('AWS credential material or synthesis implementation in frontend');
        for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) if (process.env[name] && text.includes(process.env[name]!)) throw new Error('Environment credential found in build');
      }
    }
  }
  check(directory);
}
console.log(`Verified ${manifest.resources.filter(r => r.generation.status === 'ready').length}/${manifest.resources.length} ready audio resources; paths, hashes and current content mapping valid.`);
