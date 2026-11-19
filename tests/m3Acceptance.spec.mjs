import { test, expect } from '@playwright/test';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialize } from '../scripts/m3/pipeline.mjs';
import { config } from '../scripts/m3/clients.mjs';
import { exportReport } from '../scripts/m3/report.mjs';

// Explicit UI-only fixture in a temp directory. It is never imported into real authoring.
const directory = mkdtempSync(join(tmpdir(), 'm3-acceptance-ui-'));
const fixture = initialize(fileURLToPath(new URL('../', import.meta.url)), config({}));
const sample = fixture.tasks.find(t => t.status === 'queued');
sample.gemini = { glosses: ['界面测试简释'], explanation: '仅用于 UI 交互测试，不是正式译文。' };
sample.status = 'auto_pass';
const exception = fixture.tasks.find(t => t.status === 'queued');
exception.status = 'needs_review';
exception.quality_flags = ['ui_fixture_only'];
exportReport(directory, fixture, directory);
const report = readFileSync(join(directory, 'artifacts/m3-dual/acceptance.html'), 'utf8');

test('local acceptance report renders all real sense statuses and filters exceptions', async ({ page }) => {
  await page.route('**/m3-acceptance-test', route => route.fulfill({ contentType: 'text/html', body: report }));
  await page.goto('/m3-acceptance-test');
  await expect(page.locator('article')).toHaveCount(113);
  await expect(page.getByText('此前用户已接受，保持原样。', { exact: true })).toHaveCount(15);
  await page.locator('#filter').selectOption('exceptions');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText('ui_fixture_only');
  await page.locator('#filter').selectOption('all');
  await expect(page.locator('article')).toHaveCount(113);
});

test('acceptance decisions require user action and export a file without publishing or API calls', async ({ page }) => {
  const requests = [];
  page.on('request', req => requests.push(req.url()));
  await page.route('**/m3-acceptance-test', route => route.fulfill({ contentType: 'text/html', body: report }));
  await page.goto('/m3-acceptance-test');
  await page.locator('#reviewer').fill('自动测试用户（仅测试导出，不导入）');
  const candidate = page.locator('article').filter({ has: page.getByRole('button', { name: '接受此义项（含我的修正）', exact: true }).and(page.locator('button:enabled')) }).first();
  await candidate.getByRole('button', { name: '接受此义项（含我的修正）', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出我的验收决定', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('m3-acceptance.json');
  await expect(page.locator('#status')).toContainText('没有修改线上数据');
  expect(requests.every(url => url.startsWith('http://127.0.0.1:4173/'))).toBe(true);
});
