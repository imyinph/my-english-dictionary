import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectContentInventory, contentSha256, summarizeContent, validateContentFiles } from './chineseContentModel.ts';

export const contentDirectory = 'data/content-v1';
const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
const loadJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const conciseSummary = (summary: ReturnType<typeof summarizeContent>) => {
  const { missingTargetIds, ...counts } = summary;
  return { ...counts, missingTargets: missingTargetIds.length };
};

export function loadFrozenInventory(root = rootDirectory, directory = 'public') {
  const baseline = loadJson(join(root, 'config/m3-content-baseline.json')) as {
    schemaVersion: number; dictionarySha256: string; audioManifestSha256: string; initialMigrationAt: string;
    entries: number; senses: number; examples: number;
  };
  if (baseline.schemaVersion !== 1) throw new Error('Unsupported M3 baseline');
  const snapshot = readFileSync(join(root, directory, 'data/kaikki-subset.json'));
  const audio = readFileSync(join(root, directory, 'data/audio-manifest.json'));
  if (contentSha256(snapshot) !== baseline.dictionarySha256 || contentSha256(audio) !== baseline.audioManifestSha256) throw new Error('M2 dictionary/audio baseline changed; explicit migration required. Do not regenerate audio.');
  const inventory = collectContentInventory(snapshot, baseline.initialMigrationAt);
  if (inventory.registry.entries.length !== baseline.entries || inventory.registry.targets.filter(item => item.target.kind === 'sense').length !== baseline.senses || inventory.registry.targets.filter(item => item.target.kind === 'example').length !== baseline.examples) throw new Error('Content counts differ from approved baseline');
  return inventory;
}

export function verifyContent(root = rootDirectory, directory = 'public') {
  const inventory = loadFrozenInventory(root, directory);
  const targetDirectory = join(root, directory, contentDirectory);
  const registry = loadJson(join(targetDirectory, 'identity-registry.json'));
  const bundle = validateContentFiles(registry, loadJson(join(targetDirectory, 'chinese-content.json')), inventory);
  return { inventory, bundle, summary: summarizeContent(inventory, bundle) };
}

/** Initial two-file migration is installed by one directory rename. Existing history is never overwritten. */
export function initializeContent(root = rootDirectory) {
  const inventory = loadFrozenInventory(root);
  const destination = join(root, 'public', contentDirectory);
  if (existsSync(destination)) return { created: false, ...verifyContent(root) };
  const stagingParent = join(root, 'artifacts/content-staging');
  mkdirSync(stagingParent, { recursive: true });
  const staging = mkdtempSync(join(stagingParent, 'initial-'));
  writeFileSync(join(staging, 'identity-registry.json'), json(inventory.registry), { flag: 'wx' });
  writeFileSync(join(staging, 'chinese-content.json'), json(inventory.initialContent), { flag: 'wx' });
  validateContentFiles(loadJson(join(staging, 'identity-registry.json')), loadJson(join(staging, 'chinese-content.json')), inventory);
  // Same-volume rename; a concurrent installation fails instead of replacing an existing directory.
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(staging, destination);
  return { created: true, ...verifyContent(root) };
}

function writeReport(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, json(value)); renameSync(`${path}.tmp`, path);
}

function main() {
  const [command = 'scan', ...flags] = process.argv.slice(2);
  if (!['scan', 'verify', 'init'].includes(command) || flags.some(flag => !(command === 'scan' && flag === '--report') && !(command === 'verify' && flag === '--dist'))) throw new Error('Usage: chineseContent.ts scan [--report] | verify [--dist] | init');
  if (command === 'init') {
    const result = initializeContent();
    console.log(json({ created: result.created, ...conciseSummary(result.summary) })); return;
  }
  const directory = flags.includes('--dist') ? 'dist' : 'public';
  const result = command === 'scan' && !existsSync(join(rootDirectory, 'public', contentDirectory))
    ? (() => { const inventory = loadFrozenInventory(); return { inventory, bundle: inventory.initialContent, summary: summarizeContent(inventory, inventory.initialContent) }; })()
    : verifyContent(rootDirectory, directory);
  if (directory === 'dist') for (const file of ['identity-registry.json', 'chinese-content.json']) {
    if (!readFileSync(join(rootDirectory, directory, contentDirectory, file)).equals(readFileSync(join(rootDirectory, 'public', contentDirectory, file)))) throw new Error(`Stale dist content: ${file}`);
  }
  if (flags.includes('--report')) {
    writeReport(join(rootDirectory, 'artifacts/m3-1a-content-scan.json'), result.summary);
    writeReport(join(rootDirectory, 'artifacts/m3-1a-source-candidates.json'), result.inventory.candidates);
  }
  console.log(json({ mode: command, directory, dryRun: command === 'scan', ...conciseSummary(result.summary) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
