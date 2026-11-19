import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';

const url = new URL('/#/entry/make-sense', process.argv[2] ?? 'http://127.0.0.1:4186');
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    // Observe the app's real detached Audio elements without substituting a decoder or a clock.
    await page.addInitScript(() => {
      window.playbackTimings = [];
      window.Audio = new Proxy(window.Audio, {
        construct(target, args) {
          const audio = Reflect.construct(target, args);
          let started;
          audio.addEventListener('playing', () => { started = performance.now(); }, { once: true });
          audio.addEventListener('ended', () => window.playbackTimings.push({
            elapsed: (performance.now() - started) / 1000,
            duration: audio.duration,
            url: audio.currentSrc,
          }), { once: true });
          return audio;
        },
      });
    });
    await page.goto(url.href);
    const play = page.getByRole('button', { name: '朗读例句：Can you make sense of her handwriting?', exact: true });
    for (const voice of ['Joanna', 'Stephen']) {
      await page.getByLabel('朗读音色').selectOption(voice);
      let normalDuration;
      for (const rate of [1, 0.5, 0.75, 1.25]) {
        await page.getByLabel('朗读语速').selectOption(String(rate));
        const count = await page.evaluate(() => window.playbackTimings.length);
        await play.click();
        await page.waitForFunction(count => window.playbackTimings.length > count, count, { timeout: 30000 });
        const { duration, elapsed, url } = await page.evaluate(() => window.playbackTimings.at(-1));
        if (rate === 1) normalDuration = duration;
        else assert.ok(url.includes(`/audio/rates/${voice.toLowerCase()}/${rate * 100}/`), url);
        assert.ok(Math.abs(duration - normalDuration / rate) < 0.15, `Wrong file duration: ${duration}`);
        assert.ok(Math.abs(elapsed - duration) < 0.45, `Wrong playback time: ${elapsed} for ${duration}s`);
        console.log(`${engine.name()} ${voice} ${rate}×: ${elapsed.toFixed(2)}s`);
      }
    }
  } finally {
    await browser.close();
  }
}
