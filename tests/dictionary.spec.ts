import { expect, test } from '@playwright/test';

test('home searches the ten real entries and independent phrases', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.entry-card')).toHaveCount(10);
  await expect(page.getByText('M3 · 中文辅助')).toBeVisible();
  if (test.info().project.name === 'desktop-chromium') await page.screenshot({ path: 'artifacts/m1-home-desktop.png', fullPage: true });
  await page.getByRole('textbox', { name: '搜索单词或短语' }).fill('  MAKE   sense ');
  await expect(page.locator('.entry-card')).toHaveCount(1);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'make sense', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/entry\/make-sense$/);
});

test('approved Chinese gloss is visible and example translations are initially collapsed', async ({ page }) => {
  await page.goto('/#/entry/creation');
  const translation = page.getByText('创作品', { exact: true });
  await expect(page.getByRole('heading', { name: 'Something created such as an invention or artwork.', exact: true })).toBeVisible();
  await expect(translation).toBeVisible();
  if (test.info().project.name === 'mobile-webkit') await page.screenshot({ path: 'artifacts/m3-chinese-mobile.png' });
  await expect(page.getByText('暂无可靠中文译文，待补充。')).toHaveCount(0);
  const card = page.locator('.sense').filter({has: translation});
  const explanation = card.locator('.sense-translation details.translation');
  await expect(explanation.locator('p')).toBeHidden();
  await explanation.locator('summary').click();
  await expect(explanation).toContainText('扩展解释 · AI 辅助生成 · AI 复核通过');
  await expect(card.locator('.examples details[open]')).toHaveCount(0);
  await expect(page.getByText('查看例句译文', { exact: true })).toHaveCount(4);
  await expect(page.locator('.examples details[open]')).toHaveCount(0);
});

test('word-family navigation and browser back preserve glosses and reset Chinese source disclosure', async ({ page }) => {
  await page.goto('/#/entry/creation');
  await page.getByText('中文来源与审核', { exact: true }).first().click();
  await page.locator('.family-list').getByRole('link', { name: 'creative', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'creative', exact: true })).toBeVisible();
  await expect(page.getByText('有创造力的；善于创造的', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'creation', exact: true })).toBeVisible();
  await expect(page.getByText('创作品', { exact: true })).toBeVisible();
  await expect(page.locator('.translation-credit[open]')).toHaveCount(0);
});

test('phrase has a reloadable independent route and navigable keywords', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/#/entry/make', { waitUntil: 'domcontentloaded' });
  await page.locator('.phrases').getByRole('link', { name: 'make sense', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'make sense', level: 1 })).toBeVisible();
  await expect(page.locator('.chinese-glosses')).toHaveCount(4);
  await expect(page.getByText('暂无可靠中文释义，待补充。')).toHaveCount(0);
  await page.locator('.phrases').getByRole('link', { name: 'sense', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'sense', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(page.getByRole('heading', { name: 'make sense', exact: true, level: 1 })).toBeVisible();
});

test('inflection search preserves surface form and does not merge derived words', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox').fill('created');
  await page.locator('.entry-card').click();
  await expect(page.getByRole('heading', { name: 'create', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('.surface-note')).toContainText('created');
  await page.locator('.forms-list').getByRole('link', { name: 'creating', exact: true }).first().click();
  await expect(page.locator('.surface-note')).toContainText('creating');
  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(page.locator('.surface-note')).toContainText('created');
});

test('known example words and sense-specific synonyms are navigable', async ({ page }) => {
  await page.goto('/#/entry/sense');
  await page.locator('.examples').getByRole('link', { name: 'make', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'make', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(page.getByRole('heading', { name: 'sense', exact: true, level: 1 })).toBeVisible();
  await page.goto('/#/entry/create');
  await page.locator('.sense-relations').getByRole('link', { name: 'make', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'make', exact: true, level: 1 })).toBeVisible();
});

test('unknown queries are honest, recoverable and do not create history or learning data', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox').fill('<script>alert(1)</script>');
  await expect(page.getByRole('heading', { name: '暂时没有这个词条' })).toBeVisible();
  await page.getByRole('button', { name: '清空搜索' }).click();
  await expect(page.locator('.entry-card')).toHaveCount(10);
  const stored = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
  expect(stored).toEqual({ local: 0, session: 0 });
});

test('direct missing or malformed route can return home without leaving the app', async ({ page }) => {
  await page.goto('/#/entry/%E0%A4%A');
  await expect(page.getByRole('heading', { name: '未找到这个词条' })).toBeVisible();
  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(page.locator('.entry-card')).toHaveCount(10);
});

test('external video stays collapsed, does not load remote assets and is safely linked', async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') remoteRequests.push(request.url()); });
  await page.goto('/#/entry/make-sense');
  const link = page.getByRole('link', { name: /在 YouGlish 查看/ });
  await expect(link).toBeHidden();
  await page.locator('.video summary').click();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://youglish.com/pronounce/make%20sense/english/us');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(remoteRequests).toEqual([]);
});

test('install metadata and PNG icons are served in the production build', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', './manifest.webmanifest');
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.scope).toBe('./');
  expect(manifest.icons).toHaveLength(3);
  for (const icon of [...manifest.icons, { src: './icons/apple-touch-icon.png' }]) {
    const response = await request.get(`/${icon.src.slice(2)}`);
    expect(response.ok()).toBe(true);
    const body = await response.body();
    expect(body.subarray(1, 4).toString()).toBe('PNG');
  }
});

test('small phone layouts have no horizontal overflow or runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 740 });
  for (const path of ['/', '/#/entry/create', '/#/entry/make-sense']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('search text survives a detail round trip while Chinese glosses remain visible', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox').fill('creation');
  await page.locator('.entry-card').click();
  await page.getByText('中文来源与审核', { exact: true }).first().click();
  await page.getByRole('button', { name: '← 返回' }).click();
  await expect(page.getByRole('textbox')).toHaveValue('creation');
  await page.locator('.entry-card').click();
  await expect(page.getByText('创作品', { exact: true })).toBeVisible();
  await expect(page.locator('.translation-credit[open]')).toHaveCount(0);
});

test('search navigation and brand link both return to the home page', async ({ page }) => {
  await page.goto('/#/entry/create');
  await page.getByRole('link', { name: '搜索词典', exact: true }).click();
  await expect(page.locator('.entry-card')).toHaveCount(10);
  await page.locator('.entry-card[href="#/entry/create"]').click();
  await page.locator('.brand').click();
  await expect(page.getByRole('textbox', { name: '搜索单词或短语' })).toBeVisible();
});

test('real multi-sense content, IPA, sparse fields and license credits are visible', async ({ page }) => {
  await page.goto('/#/entry/create');
  await expect(page.locator('.sense')).toHaveCount(9);
  await expect(page.locator('.pronunciation-line')).toContainText('/kɹiːˈeɪt/');
  await page.locator('.source summary').click();
  await expect(page.getByRole('link', { name: '词条原文 ↗', exact: true })).toHaveAttribute('href', 'https://en.wiktionary.org/wiki/create#English');
  await expect(page.locator('.source')).toContainText('Dvortygirl');
  await expect(page.getByRole('link', { name: 'CC BY-SA 3.0', exact: true })).toBeVisible();
  await page.goto('/#/entry/creatively');
  await expect(page.getByText('此义项暂无已确认可复用的例句。')).toBeVisible();
  await expect(page.locator('.examples li')).toHaveCount(0);
});

test('a failed dataset request shows an honest error and never falls back to M0 fixtures', async ({ page }) => {
  await page.route('**/data/kaikki-subset.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('/#/entry/create');
  await expect(page.getByRole('heading', { name: '词条加载失败' })).toBeVisible();
  await expect(page.getByText('To make something new.', { exact: true })).toHaveCount(0);
});
