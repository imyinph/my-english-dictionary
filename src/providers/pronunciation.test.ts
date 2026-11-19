import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PronunciationController, selectVoice, type PlaybackBackend, type Voice } from './pronunciation.ts';
import type { Recording } from '../domain/dictionary.ts';
import { readFileSync } from 'node:fs';
import type { AudioResource } from '../domain/audio.ts';
import { ManifestAudioResolver } from './audioResolver.ts';

const us: Voice = { name: 'US test voice', lang: 'en-US', voiceURI: 'us-test', localService: true };
const uk: Voice = { name: 'UK test voice', lang: 'en-GB', voiceURI: 'uk-test', localService: true };
const recording: Recording = { file: 'test.ogg', accent: 'US', urls: ['https://upload.wikimedia.org/test.mp3', 'https://upload.wikimedia.org/test.ogg'], author: 'Test fixture', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', pageUrl: 'https://commons.wikimedia.org/wiki/File:Test.ogg', verifiedAt: '2026-11-10' };
function backend(overrides: Partial<PlaybackBackend> = {}): PlaybackBackend {
  return { recording: async (_url, _rate, _signal, start) => { start(); }, voices: () => [us, uk], waitForVoices: async () => [us, uk], speak: async (_text, _voice, _rate, _signal, start) => { start(); }, ...overrides };
}

test('matching licensed recording is preferred over TTS', async () => {
  let speech = 0, audio = 0;
  const service = new PronunciationController(backend({ recording: async (_url, rate, _signal, start) => { audio++; assert.equal(rate, .75); start(); }, speak: async () => { speech++; } }));
  await service.play({ text: 'create', accent: 'US', rate: .75, recordings: [recording] });
  assert.equal(audio, 1); assert.equal(speech, 0);
  assert.equal(service.getSnapshot().kind, 'recording');
  assert.equal(service.getSnapshot().phase, 'finished');
});

test('absent matching recording falls back to the exact requested TTS region', async () => {
  let actual: Voice | undefined;
  const service = new PronunciationController(backend({ recording: async () => { throw new Error('must not play US for UK'); }, speak: async (_text, voice) => { actual = voice; } }));
  await service.play({ allowBrowserTts: true, text: 'make sense', accent: 'UK', rate: 1, recordings: [recording] });
  assert.equal(actual, uk);
  assert.match(service.getSnapshot().message, /合成语音/u);
});

test('failed MP3 tries the other source format before TTS', async () => {
  const attempts: string[] = [];
  const service = new PronunciationController(backend({ recording: async url => { attempts.push(url); if (url.endsWith('.mp3')) throw new Error('codec'); } }));
  await service.play({ text: 'create', accent: 'US', rate: 1, recordings: [recording] });
  assert.equal(attempts.length, 2);
  assert.equal(service.getSnapshot().kind, 'recording');
});

test('failed audio transparently falls back to TTS and keeps the fallback reason visible', async () => {
  const service = new PronunciationController(backend({ recording: async () => { throw new Error('offline'); } }));
  await service.play({ text: 'create', accent: 'US', rate: 1, recordings: [recording] });
  assert.equal(service.getSnapshot().needsTtsConsent, true);
  await service.play({ text: 'create', accent: 'US', rate: 1, allowBrowserTts: true });
  assert.equal(service.getSnapshot().kind, 'tts');
  assert.equal(service.getSnapshot().phase, 'finished');
});

test('audio + TTS failure gives a terminal explicit error', async () => {
  const service = new PronunciationController(backend({ recording: async () => { throw new Error('offline'); }, speak: async () => { throw new Error('TTS blocked'); } }));
  await service.play({ text: 'create', accent: 'US', rate: 1, recordings: [recording] });
  assert.equal(service.getSnapshot().needsTtsConsent, true);
  await service.play({ text: 'create', accent: 'US', rate: 1, allowBrowserTts: true });
  assert.equal(service.getSnapshot().phase, 'error');
  assert.match(service.getSnapshot().message, /TTS blocked/u);
});

test('missing regional voice never silently chooses another accent or a Chinese voice', async () => {
  let spoke = false;
  const service = new PronunciationController(backend({ voices: () => [us], waitForVoices: async () => [us], speak: async () => { spoke = true; } }));
  await service.play({ allowBrowserTts: true, text: 'create', accent: 'UK', rate: 1 });
  assert.equal(spoke, false);
  assert.equal(service.getSnapshot().phase, 'error');
  assert.match(service.getSnapshot().message, /en-GB/u);
  assert.equal(selectVoice([{ ...us, lang: 'zh-CN' }], 'US'), undefined);
});

test('late-arriving voices can be used, with local regional voices preferred', async () => {
  let selected: Voice | undefined;
  const service = new PronunciationController(backend({ voices: () => [], waitForVoices: async () => [uk], speak: async (_text, voice) => { selected = voice; } }));
  await service.play({ allowBrowserTts: true, text: 'An example.', accent: 'UK', rate: 1 });
  assert.equal(selected, uk);
  assert.equal(selectVoice([{ ...us, localService: false }, us], 'US'), us);
});

test('stop cancels loading and does not trigger a TTS fallback or stale error', async () => {
  let aborted = false, spoke = false;
  const service = new PronunciationController(backend({ recording: (_url, _rate, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancel')); }); }), speak: async () => { spoke = true; } }));
  const playing = service.play({ text: 'create', accent: 'US', rate: 1, recordings: [recording] });
  service.stop(); await playing;
  assert.equal(aborted, true); assert.equal(spoke, false);
  assert.equal(service.getSnapshot().phase, 'idle');
});

test('starting a new utterance invalidates a late completion from the previous one', async () => {
  let finishFirst: (() => void) | undefined;
  const service = new PronunciationController(backend({ speak: text => text === 'old' ? new Promise<void>(resolve => { finishFirst = resolve; }) : Promise.resolve() }));
  const first = service.play({ allowBrowserTts: true, text: 'old', accent: 'US', rate: 1 });
  await service.play({ allowBrowserTts: true, text: 'new', accent: 'UK', rate: 1 });
  finishFirst!(); await first;
  assert.equal(service.getSnapshot().text, 'new');
  assert.match(service.getSnapshot().message, /UK/u);
});

test('empty input is rejected and speed is clamped', async () => {
  let actualRate = 0;
  const service = new PronunciationController(backend({ speak: async (_text, _voice, rate) => { actualRate = rate; } }));
  await service.play({ allowBrowserTts: true, text: ' ', accent: 'US', rate: 1 });
  assert.equal(service.getSnapshot().phase, 'error');
  await service.play({ allowBrowserTts: true, text: 'create', accent: 'US', rate: 20 });
  assert.equal(actualRate, 1.25);
});

test('iOS fallback requires explicit per-play consent, including after recording failure', async () => {
  let speech = 0;
  const service = new PronunciationController(backend({ requiresTtsConsent: () => true, recording: async () => { throw new Error('offline'); }, speak: async () => { speech++; } }));
  await service.play({ text: 'create', accent: 'US', rate: 1, recordings: [recording] });
  assert.equal(speech, 0); assert.equal(service.getSnapshot().needsTtsConsent, true);
  await service.play({ text: 'create', accent: 'US', rate: 1, allowBrowserTts: true });
  assert.equal(speech, 1);
  await service.play({ text: 'other', accent: 'US', rate: 1 });
  assert.equal(speech, 1); assert.equal(service.getSnapshot().needsTtsConsent, true);
});

test('selected neural MP3 precedes legacy human audio and browser TTS', async () => {
  const resource: AudioResource = JSON.parse(readFileSync(new URL('../../public/data/audio-audition.json', import.meta.url), 'utf8')).resources[0];
  resource.asset = { path: 'audio/neural.mp3', format: 'mp3', sha256: 'a'.repeat(64), bytes: 200 };
  resource.generation.status = 'ready'; resource.review.status = 'approved';
  const requests: string[] = [];
  let tts = 0;
  const service = new PronunciationController(backend({ recording: async url => { requests.push(url); if (!url.includes('neural.mp3')) throw new Error('offline'); }, speak: async () => { tts++; } }), new ManifestAudioResolver({ schemaVersion: 1, resources: [resource] }, 'https://site.example/'));
  await service.play({ text: 'create', target: resource.target, accent: 'US', rate: 1, recordings: [recording] });
  assert.equal(requests.length, 1); assert.equal(tts, 0); assert.equal(service.getSnapshot().kind, 'neural');
});

test('new heteronym identity cannot inherit an old spelling-level human recording', async () => {
  let audio = 0;
  const service = new PronunciationController(backend({ recording: async () => { audio++; }, requiresTtsConsent: () => true }));
  await service.play({ text: 'record', target: { contentId: 'record', kind: 'word', pronunciationId: 'noun-first-stress' }, accent: 'US', rate: 1, recordings: [recording] });
  assert.equal(audio, 0); assert.equal(service.getSnapshot().needsTtsConsent, true);
});
