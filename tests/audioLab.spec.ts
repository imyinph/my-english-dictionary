import { expect, test } from '@playwright/test';
import { installAudioDouble } from './audioDouble.ts';
import { installPollyFixture } from './pollyFixture.ts';
test.setTimeout(60000);

test('diagnostics filters chosen voices and shows honest missing states', async ({ page }, info) => {
  await installAudioDouble(page);
  await installPollyFixture(page, false); await page.goto('/#/audio-lab', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '双音色与资源诊断' })).toBeVisible(); await expect(page.locator('.lab-count')).toContainText('0 / 210');
  await page.getByLabel('筛选音频文本').fill('make sense'); await expect(page.locator('.lab-sample').first()).toContainText('Joanna'); await expect(page.locator('.lab-sample button').first()).toBeDisabled();
  await page.getByLabel('朗读音色').selectOption('Stephen'); await expect(page.locator('.lab-sample').first()).toContainText('Stephen');
  await page.screenshot({ path: `artifacts/m2-audio-${info.project.name}.png`, fullPage: false });
  await page.setViewportSize({ width: 320, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: '搜索词典', exact: true }).click(); await expect(page.locator('.entry-card')).toHaveCount(10, { timeout: 15000 });
});
test('diagnostic audio shares rate and fails without TTS substitution', async ({ page }) => {
  await installAudioDouble(page); await installPollyFixture(page); await page.goto('/#/audio-lab', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('朗读语速').selectOption('0.75'); await page.locator('.lab-sample button').first().click(); await expect(page.locator('.audio-status')).toContainText('试听结束'); expect(await page.evaluate(() => window.__audioTest.audio[0])).toMatchObject({url: expect.stringContaining('/audio/rates/joanna/75/'), rate: 1});
  await page.getByLabel('朗读音色').selectOption('Stephen'); await page.evaluate(() => { window.__audioTest.failAudio = true; }); await page.locator('.lab-sample button').first().click(); await expect(page.locator('.audio-status')).toContainText('加载或播放失败'); expect(await page.evaluate(() => window.__audioTest.speech)).toEqual([]);
});
test('malformed manifest is recoverable without damaging dictionary', async ({ page }) => {
  await installAudioDouble(page);
  await page.route('**/data/audio-manifest.json', route => route.fulfill({ json: { schemaVersion: 1, resources: [null] } })); await page.goto('/#/audio-lab', { waitUntil: 'domcontentloaded' }); await expect(page.getByRole('alert')).toContainText('加载失败');
  await page.getByRole('link', { name: '搜索词典', exact: true }).click(); await expect(page.locator('.entry-card')).toHaveCount(10, { timeout: 15000 });
});
