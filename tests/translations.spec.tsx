import { expect, test } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Translation } from '../src/components/Translation.tsx';

test('the shared translation component keeps Chinese definition and example translations independent', async ({ page }) => {
  // Explicit UI fixtures; these translations are never merged into the real dictionary.
  const markup = renderToStaticMarkup(<><Translation label="查看中文释义">测试中文释义</Translation><Translation label="查看例句译文">测试例句译文一</Translation><Translation label="查看例句译文">测试例句译文二</Translation></>);
  await page.setContent(markup);
  await expect(page.getByText('测试中文释义', { exact: true })).toBeHidden();
  await expect(page.getByText('测试例句译文一', { exact: true })).toBeHidden();
  await page.getByText('查看中文释义', { exact: true }).click();
  await expect(page.getByText('测试中文释义', { exact: true })).toBeVisible();
  await expect(page.getByText('测试例句译文一', { exact: true })).toBeHidden();
  await page.getByText('查看例句译文', { exact: true }).first().click();
  await expect(page.getByText('测试例句译文一', { exact: true })).toBeVisible();
  await expect(page.getByText('测试例句译文二', { exact: true })).toBeHidden();
});
