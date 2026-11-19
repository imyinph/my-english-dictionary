import { test, expect } from '@playwright/test';

// Windows WebKit occasionally delays rendering after a successful local response.
// Poll the real UI (no sleeps/retries); permit its observed scheduling latency.
test.use({ actionTimeout: 15000 });
test.beforeEach(async ({}, testInfo) => {
  if (testInfo.project.name === 'mobile-webkit') testInfo.setTimeout(60000);
});

test('12 real AI samples show English, collapsed explanation, truthful review and return navigation', async ({ page }) => {
  await page.goto('/#/chinese-samples');
  const cards = page.locator('.sample-card');
  await expect(cards).toHaveCount(12);
  await expect(page.getByText('AI 辅助释义 · 已人工审核', { exact: true })).toHaveCount(12);
  const first = cards.first();
  await expect(first.locator('.sample-english')).toBeVisible();
  await expect(first.locator('.chinese-glosses')).toHaveText('创造；使产生');
  await expect(first.locator('.translation p')).toBeHidden();
  await first.getByText('展开中文解释', { exact: true }).click();
  await expect(first.locator('.translation p')).toBeVisible();
  await first.getByText('展开中文解释', { exact: true }).click();
  await expect(first.locator('.translation p')).toBeHidden();
  await first.getByText('查看完整词条与发音 →').click();
  await expect(page.getByRole('heading', { name: 'create', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '← 返回', exact: true }).click();
  await expect(cards).toHaveCount(12);
  await expect(first.locator('.translation p')).toBeHidden();
});

test('sample request failure offers retry and keeps dictionary accessible', async ({ page }) => {
  let fail = true;
  await page.route('**/data/chinese-samples.json', route => fail ? route.fulfill({ status: 503, body: '' }) : route.continue());
  await page.goto('/#/chinese-samples');
  await expect(page.getByRole('alert')).toContainText('样本加载失败');
  fail = false;
  await page.getByRole('button', { name: '重试样本' }).click();
  await expect(page.locator('.sample-card')).toHaveCount(12, { timeout: 15000 });
});

test('320px sample layout and human-approved Chinese are available in formal entries', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#/chinese-samples');
  await expect(page.locator('.sample-card')).toHaveCount(12);
  await page.locator('.sample-card').first().getByText('查看原例句、来源和复核记录').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/#/entry/creatively');
  await expect(page.getByText('有创造性地；富有创意地', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.chinese-glosses')).toHaveCount(1);
});
