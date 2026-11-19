import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { SenseTranslation } from '../src/components/SenseTranslation.tsx';
import { Translation } from '../src/components/Translation.tsx';
import type { PublishedTranslations } from '../src/domain/senseTranslation.ts';

const publication: PublishedTranslations = JSON.parse(readFileSync(new URL('../public/data/chinese-senses.json', import.meta.url), 'utf8'));
const approved = publication.senses.find(record => record.entryId === 'creation' && record.reviewStatus === 'approved')!;

test('all 113 real senses render Chinese on their own entry with English retained', async ({ page }) => {
  let displayed = 0;
  for (const entryId of new Set(publication.senses.map(s => s.entryId))) {
    const records = publication.senses.filter(s => s.entryId === entryId);
    await page.goto(`/#/entry/${entryId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.chinese-glosses')).toHaveCount(records.length);
    await expect(page.locator('.sense h3')).toHaveCount(records.length);
    for (const r of records) {
      const card = page.locator('.sense').filter({ has: page.getByRole('heading', { level: 3, name: r.englishText, exact: true }) });
      await expect(card.locator('.chinese-glosses')).toHaveText(r.glosses.join('；'));
      expect(r.explanation).toBeTruthy();
      const detail = card.locator('.sense-translation details.translation');
      await expect(detail.locator('p')).toContainText(r.explanation!);
      if (r.explanationReview) {
        await detail.locator('summary').click();
        await expect(detail.locator('p')).toBeVisible();
        await expect(detail).toContainText('扩展解释 · AI 辅助生成 · AI 复核通过');
        await expect(card.locator('.examples details[open]')).toHaveCount(0);
      }
    }
    displayed += records.length;
  }
  expect(displayed).toBe(113);
});

test('Chinese explanation toggles independently of example translation and never hides English', async ({ page }) => {
  // UI-only fixture: isolates the shared component from actual reviewed content.
  const markup = renderToStaticMarkup(<><h3>Something created such as an invention or artwork.</h3><SenseTranslation record={{ ...approved, explanationReview: undefined, explanation: '仅用于交互测试的中文解释。' }} /><Translation label="查看例句译文">仅用于测试的例句译文。</Translation></>);
  await page.setContent(markup);
  await expect(page.getByText('创作品', { exact: true })).toBeVisible();
  await expect(page.getByText('仅用于交互测试的中文解释。', { exact: true })).toBeHidden();
  await page.getByText('展开中文解释', { exact: true }).click();
  await expect(page.getByText('仅用于交互测试的中文解释。', { exact: true })).toBeVisible();
  await expect(page.getByText('仅用于测试的例句译文。', { exact: true })).toBeHidden();
  await expect(page.getByRole('heading')).toBeVisible();
  await page.getByText('展开中文解释', { exact: true }).click();
  await expect(page.getByText('仅用于交互测试的中文解释。', { exact: true })).toBeHidden();
});

test('unreviewed ECDICT candidate stays hidden alongside separately approved AI Chinese', async ({ page }) => {
  // Keep the missing/candidate path covered even after the real dataset reaches full coverage.
  const candidate = structuredClone(publication);
  const pending = candidate.senses.find(s => s.englishText === 'A natural appreciation or ability.')!;
  pending.glosses = []; pending.explanation = null; pending.source = null;
  pending.reviewStatus = 'pending'; pending.translationStatus = 'candidate';
  await page.route('**/data/chinese-senses.json', route => route.fulfill({ json: candidate }));
  const external: string[] = [];
  page.on('request', request => { if (/ecdict|githubusercontent/iu.test(request.url())) external.push(request.url()); });
  await page.goto('/#/entry/sense', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'A natural appreciation or ability.', exact: true })).toBeVisible();
  await expect(page.getByText('中文释义待审核，暂不展示。')).toBeVisible();
  await expect(page.locator('.sense').filter({ has: page.getByRole('heading', { name: 'A natural appreciation or ability.', exact: true }) }).locator('.chinese-glosses')).toHaveCount(0);
  expect(external).toEqual([]);
});

test('Chinese HTTP failure preserves English and retries without touching audio settings', async ({ page }) => {
  let calls = 0;
  await page.route('**/data/chinese-senses.json', async route => { calls++; if (calls === 1) await route.fulfill({ status: 503, body: 'unavailable' }); else await route.continue(); });
  await page.goto('/#/entry/creation', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: approved.englishText, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重试中文加载' })).toBeVisible();
  await expect(page.getByRole('button', { name: '朗读词条：creation', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '重试中文加载' }).click();
  await expect(page.getByText('创作品', { exact: true })).toBeVisible();
  await expect(page.getByLabel('朗读音色')).toHaveValue('Joanna');
  expect(calls).toBe(2);
});

test('forged unreviewed static Chinese is rejected without falling back to legacy translations', async ({ page }) => {
  const invalid = structuredClone(publication); const record = invalid.senses.find(item => item.senseId === approved.senseId)!;
  record.reviewStatus = 'pending'; record.translationStatus = 'candidate';
  await page.route('**/data/chinese-senses.json', route => route.fulfill({ json: invalid }));
  await page.goto('/#/entry/creation', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: '重试中文加载' })).toBeVisible();
  await expect(page.locator('.chinese-glosses')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: approved.englishText, exact: true })).toBeVisible();
});

test('actual approved glosses remain scoped to one make sense and fit a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#/entry/make', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.sense')).toHaveCount(60);
  await expect(page.locator('.chinese-glosses')).toHaveCount(publication.senses.filter(s => s.entryId === 'make' && s.translationStatus === 'complete').length);
  await expect(page.locator('.sense').filter({ has: page.getByRole('heading', { name: 'To cause to be.', exact: true }) }).locator('.chinese-glosses')).toHaveText('使；使得');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('real AI reviewed sense is visible with truthful attribution and collapsed explanation', async ({ page }) => {
  const ai = publication.senses.find(s => s.reviewStatus === 'ai_approved' && s.entryId === 'creative')!;
  await page.goto(`/#/entry/${ai.entryId}`);
  const sense = page.locator('.sense').filter({ has: page.getByRole('heading', { name: ai.englishText, exact: true }) });
  await expect(sense.locator('.chinese-glosses')).toHaveText(ai.glosses.join('；'));
  await expect(sense.getByText('AI 辅助释义 · AI 复核通过', { exact: true })).toBeVisible();
  await expect(sense.getByText(ai.explanation!, { exact: true })).toBeHidden();
  await sense.getByText('展开中文解释', { exact: true }).click();
  await expect(sense.getByText(ai.explanation!, { exact: true })).toBeVisible();
  await sense.getByText('中文来源与审核', { exact: true }).click();
  await expect(sense.getByText(/AI 复核通过 · 未经人工审核/)).toBeVisible();
  await expect(sense.getByText(/已人工审核/)).toHaveCount(0);
  await sense.getByText('展开中文解释', { exact: true }).click();
  await expect(sense.getByText(ai.explanation!, { exact: true })).toBeHidden();
});

test('approved AI provenance is labelled but pending and rejected fixture text stays hidden', async ({ page }) => {
  const ai = { ...approved, explanationReview: undefined, source: { ...approved.source!, type: 'ai' as const, name: 'Explicit test fixture' } };
  const markup = renderToStaticMarkup(<><SenseTranslation record={ai} /><SenseTranslation record={{ ...ai, senseId: 'test-pending', reviewStatus: 'pending', translationStatus: 'candidate', glosses: ['未审测试内容'] }} /><SenseTranslation record={{ ...ai, senseId: 'test-rejected', reviewStatus: 'rejected', translationStatus: 'candidate', glosses: ['拒绝测试内容'] }} /></>);
  await page.setContent(markup);
  await page.getByText('中文来源与审核', { exact: true }).click();
  await expect(page.getByText('AI 辅助生成 · 已人工审核 · Explicit test fixture')).toBeVisible();
  await expect(page.getByText('未审测试内容', { exact: true })).toHaveCount(0);
  await expect(page.getByText('拒绝测试内容', { exact: true })).toHaveCount(0);
});

test('real human-approved AI explanation is visible in the correct formal sense only', async ({ page }) => {
  await page.goto('/#/entry/make');
  const sense = page.locator('.sense').filter({ has: page.getByRole('heading', { name: 'To cause to appear to be; to represent as.', exact: true }) });
  await expect(sense.locator('.chinese-glosses')).toHaveText('使显得；描绘为');
  const explanation = '使某人或某事看起来具有某种身份或性质，或在叙述中将其描绘成某种样子。重点是呈现或描写，不一定是使其实际变成那样。';
  await expect(sense.getByText(explanation, { exact: true })).toBeHidden();
  await sense.getByText('展开中文解释', { exact: true }).click();
  await expect(sense.getByText(explanation, { exact: true })).toBeVisible();
  await expect(sense.getByRole('heading', { level: 3, name: 'To cause to appear to be; to represent as.', exact: true })).toBeVisible();
  await sense.getByText('中文来源与审核', { exact: true }).click();
  await expect(sense.getByText(/AI 辅助生成 · 已人工审核/)).toBeVisible();
  await expect(page.locator('.sense').filter({ has: page.getByRole('heading', { name: 'To cause to be.', exact: true }) }).locator('.chinese-glosses')).toHaveText('使；使得');
});
