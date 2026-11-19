import {expect, test} from '@playwright/test';
import translations from '../content/example-translations-v2.json' with { type: 'json' };

for (const entryId of new Set(translations.records.map(record => record.entryId))) {
  test(`all example translations match their sentences in ${entryId}`, async ({page}) => {
    await page.goto('/#/entry/' + entryId);
    const records = translations.records.filter(record => record.entryId === entryId);
    const items = page.locator('.examples li');
    await expect(items).toHaveCount(records.length);
    await expect(items.locator('summary')).toHaveText(records.map(() => '查看例句译文'));
    await expect(items.locator('details[open]')).toHaveCount(0);

    const displayed = await items.evaluateAll(rows => rows.map(row => ({
      english: row.querySelector('p [lang=en]')?.textContent,
      chinese: row.querySelector('details p')?.firstChild?.textContent,
      credit: row.querySelector('details small')?.textContent,
    })));
    for (const record of records) {
      const row = displayed.find(row => row.english === record.englishText);
      expect(row?.chinese).toBe(record.translation);
      expect(row?.credit).toContain('AI 复核通过');
    }

    const first = items.first();
    await first.locator('summary').click();
    await expect(first.locator('details p')).toBeVisible();
    await expect(items.locator('details[open]')).toHaveCount(1);
    await first.locator('summary').click();
    await expect(first.locator('details p')).toBeHidden();
  });
}
