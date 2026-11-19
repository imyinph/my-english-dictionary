import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parsePollyManifest } from '../src/providers/pollyManifest.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = new URL(process.argv[2]);
if (base.protocol !== 'https:') throw new Error('Provide the deployment HTTPS URL.');
if (!base.pathname.endsWith('/')) base.pathname += '/';
const local = parsePollyManifest(JSON.parse(readFileSync(join(root, 'dist/data/audio-manifest.json'), 'utf8')));
let networkRetries = 0;
async function get(path, headers) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(new URL(path, base), { headers, signal: AbortSignal.timeout(30000) });
      assert.ok(response.ok, `${path}: HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (!(error instanceof TypeError) || attempt === 2) throw error;
      networkRetries++; await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}
const index = await get('');
const html = await index.text();
assert.match(html, /M2/);
for (const file of [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)].map(m => m[1])) await (await get(file)).arrayBuffer();
const manifestResponse = await get('data/audio-manifest.json');
assert.match(manifestResponse.headers.get('cache-control') ?? '', /no-cache/);
assert.deepEqual(parsePollyManifest(await manifestResponse.json()), local, 'Online manifest differs from release build');
const results = []; let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < local.resources.length) {
    const resource = local.resources[cursor++];
    assert.equal(resource.generation.status, 'ready');
    const response = await get(resource.asset.path);
    assert.match(response.headers.get('content-type') ?? '', /audio\/mpeg/);
    assert.match(response.headers.get('cache-control') ?? '', /immutable/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, resource.asset.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), resource.asset.sha256);
    results.push({ id: resource.id, bytes: bytes.length, status: response.status });
  }
}));
const rangeChecks = [];
for (const voice of ['Joanna', 'Stephen']) {
  const resource = local.resources.find(r => r.voice === voice);
  const response = await get(resource.asset.path, { Range: 'bytes=0-63' });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status === 206) {
    assert.equal(bytes.length, 64);
    assert.equal(response.headers.get('content-range'), `bytes 0-63/${resource.asset.bytes}`);
  } else {
    // Pages documents full 200 responses to Range requests. Record this limit; do not claim 206 support.
    assert.equal(response.status, 200); assert.equal(bytes.length, resource.asset.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), resource.asset.sha256);
  }
  rangeChecks.push({ voice, status: response.status, bytes: bytes.length, partialContent: response.status === 206 });
}
mkdirSync(join(root, 'artifacts'), { recursive: true });
writeFileSync(join(root, 'artifacts/m2-deployment-validation.json'), JSON.stringify({ checkedAt: new Date().toISOString(), baseUrl: base.href, resources: results, rangeChecks, networkRetries }, null, 2));
console.log(`Verified online release: ${results.length}/${local.resources.length} MP3 files, full hashes, content types and cache headers. Range responses: ${rangeChecks.map(r => `${r.voice}=${r.status}`).join(', ')}; 200 means full-file fallback, not partial-content support.`);
