import { expect, test } from '@playwright/test';
import { installAudioDouble } from './audioDouble.ts';
import { installPollyFixture } from './pollyFixture.ts';

test('Joanna is default, Polly precedes Commons and no AWS call leaves the browser', async ({ page }) => {
  await installAudioDouble(page); await installPollyFixture(page);
  const cloud: string[] = []; page.on('request', r => { if (/amazonaws|speech.microsoft|googleapis/.test(r.url())) cloud.push(r.url()); });
  await page.goto('/#/entry/create', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('朗读音色')).toHaveValue('Joanna'); await expect(page.getByLabel('朗读口音')).toHaveCount(0);
  await page.getByRole('button', { name: '朗读词条：create', exact: true }).click(); await expect(page.locator('.audio-status')).toContainText('Joanna');
  const state = await page.evaluate(() => window.__audioTest);
  expect(state.audio[0].url).toContain('/audio/polly/en-US/neural/joanna/'); expect(state.audio).toHaveLength(1); expect(state.speech).toHaveLength(0); expect(cloud).toEqual([]);
});
test('Stephen and speed apply to word, phrase, examples, navigation and reload', async ({ page }) => {
  test.setTimeout(60000);
  await installAudioDouble(page); await installPollyFixture(page); await page.goto('/#/entry/create', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('朗读音色').selectOption('Stephen'); await page.getByLabel('朗读语速').selectOption('0.75');
  await page.getByRole('button', { name: '朗读词条：create', exact: true }).click(); await expect(page.locator('.audio-status')).toContainText('Stephen');
  await page.goto('/#/entry/make-sense', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '朗读词条：make sense', exact: true }).click(); await expect(page.locator('.audio-status')).toContainText('Stephen');
  await page.locator('.example-audio').first().click(); await expect(page.locator('.audio-status')).toContainText('播放结束');
  const state = await page.evaluate(() => window.__audioTest);
  expect(state.audio).toHaveLength(3); expect(state.audio.every(r => r.url.includes('/audio/rates/stephen/75/') && r.rate === 1)).toBe(true); expect(new Set(state.audio.map(r => r.url)).size).toBe(3);
  await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.getByLabel('朗读音色')).toHaveValue('Stephen'); await expect(page.getByLabel('朗读语速')).toHaveValue('0.75');
});
test('rapid clicks, voice switch, speed switch, stop and navigation cancel old audio', async ({ page }) => {
  await installAudioDouble(page, { hold: true }); await installPollyFixture(page); await page.goto('/#/entry/create', { waitUntil: 'domcontentloaded' });
  const play = page.getByRole('button', { name: '朗读词条：create', exact: true });
  await play.click(); await expect(page.locator('.audio-status')).toContainText('正在播放');
  await play.click(); expect(await page.evaluate(() => window.__audioTest.pauses)).toBeGreaterThan(0);
  await page.getByLabel('朗读音色').selectOption('Stephen'); await expect(page.locator('.audio-status')).toContainText('已停止');
  await play.click(); await expect(page.locator('.audio-status')).toContainText('Stephen');
  await page.getByLabel('朗读语速').selectOption('0.75'); await expect(page.locator('.audio-status')).toContainText('已停止');
  await play.click(); await page.getByRole('button', { name: '停止朗读' }).click(); await expect(page.locator('.audio-status')).toContainText('已停止');
  await play.click(); await page.locator('.family-list').getByRole('link', { name: 'creation', exact: true }).click(); await expect(page.locator('.audio-status')).toContainText('已停止');
});
test('missing Polly file falls back to legal human recording, preserving credit', async ({ page }) => {
  await installAudioDouble(page, { failPolly: true }); await installPollyFixture(page); await page.goto('/#/entry/create', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '朗读词条：create', exact: true }).click(); await expect(page.locator('.audio-status')).toContainText('真人录音播放结束');
  const state = await page.evaluate(() => window.__audioTest); expect(state.audio[0].url).toContain('/polly/'); expect(state.audio[1].url).toContain('En-us-create.ogg'); expect(state.speech).toHaveLength(0);
  await page.getByText('内容来源、许可与录音署名', { exact: true }).click(); await expect(page.locator('.source')).toContainText('Dvortygirl');
});
test('no usable audio always requires explicit TTS, failures are visible and consent is per request', async ({ page }) => {
  await installAudioDouble(page, { failAudio: true, failTts: true }); await installPollyFixture(page); await page.goto('/#/entry/create', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '朗读词条：create', exact: true }).click(); await expect(page.locator('.audio-status')).toContainText('未自动启用'); expect(await page.evaluate(() => window.__audioTest.speech.length)).toBe(0);
  await page.getByRole('button', { name: '本次使用备用 TTS（可能失真）' }).click(); await expect(page.locator('.audio-status')).toContainText('synthesis-failed');
  await page.evaluate(() => { window.__audioTest.failTts = false; }); await page.locator('.example-audio').first().click(); await expect(page.locator('.audio-status')).toContainText('未自动启用');
  await page.getByRole('button', { name: '本次使用备用 TTS（可能失真）' }).click(); await expect(page.locator('.audio-status')).toContainText('TTS US 朗读结束');
});
test('empty voices and late voices remain explicit', async ({ page }) => {
  await installAudioDouble(page, { emptyVoices: true }); await installPollyFixture(page, false); await page.goto('/#/entry/creation', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '朗读词条：creation', exact: true }).click(); await page.getByRole('button', { name: '本次使用备用 TTS（可能失真）' }).click(); await expect(page.locator('.audio-status')).toContainText('未提供 en-US 声音');
  await page.getByRole('button', { name: '朗读词条：creation', exact: true }).click(); await page.getByRole('button', { name: '本次使用备用 TTS（可能失真）' }).click();
  await page.evaluate(() => { window.__audioTest.emptyVoices = false; window.speechSynthesis.dispatchEvent(new Event('voiceschanged')); }); await expect(page.locator('.audio-status')).toContainText('TTS US 朗读结束');
});
test('legacy UK preference migrates into existing settings with Joanna and unchanged rate', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dictionary.audio-settings.v1', JSON.stringify({ accent: 'UK', rate: .75 })));
  await page.goto('/', { waitUntil: 'domcontentloaded' }); await expect(page.getByLabel('朗读音色')).toHaveValue('Joanna'); await expect(page.getByLabel('朗读语速')).toHaveValue('0.75');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dictionary.audio-settings.v1')!))).toEqual({ accent: 'US', voice: 'Joanna', rate: .75 });
});
test('hidden page cancels playback', async ({ page }) => {
  await installAudioDouble(page, { hold: true }); await installPollyFixture(page); await page.goto('/#/entry/create', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '朗读词条：create', exact: true }).click(); await expect(page.locator('.audio-status')).toContainText('正在播放');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }); await expect(page.locator('.audio-status')).toContainText('已停止');
});
