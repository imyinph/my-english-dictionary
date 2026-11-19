import type { Page } from '@playwright/test';

type AudioTestState = {
  failAudio: boolean; failPolly: boolean; failTts: boolean; hold: boolean; missingUK: boolean; emptyVoices: boolean;
  audio: { url: string; rate: number }[]; speech: { text: string; lang: string; rate: number }[];
  pauses: number; cancels: number;
};
declare global { interface Window { __audioTest: AudioTestState } }

export async function installAudioDouble(page: Page, options: Partial<AudioTestState> = {}) {
  // Deterministic browser API doubles verify application wiring, not audible device output.
  await page.addInitScript(options => {
    const state: AudioTestState = { failAudio: false, failPolly: false, failTts: false, hold: false, missingUK: false, emptyVoices: false, audio: [], speech: [], pauses: 0, cancels: 0, ...options };
    window.__audioTest = state;
    class FakeAudio {
      private source = '';
      preload = ''; playbackRate = 1; defaultPlaybackRate = 1;
      get src() { return this.source; }
      set src(value: string) {
        this.source = value;
        this.playbackRate = this.defaultPlaybackRate;
      }
      onplaying: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play() {
        state.audio.push({ url: this.src, rate: this.playbackRate });
        if (state.failAudio || (state.failPolly && (this.src.includes('/polly/') || this.src.includes('/audio/rates/')))) return Promise.reject(new Error('fixture decode failure'));
        queueMicrotask(() => { this.onplaying?.(); if (!state.hold) setTimeout(() => this.onended?.(), 20); });
        return Promise.resolve();
      }
      pause() { state.pauses++; }
      removeAttribute() { this.src = ''; }
      load() {}
    }
    class Utterance {
      text: string; voice?: { name: string; lang: string }; lang = ''; rate = 1;
      onstart: (() => void) | null = null; onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(text: string) { this.text = text; }
    }
    class Synth extends EventTarget {
      getVoices() {
        if (state.emptyVoices) return [];
        return [{ name: 'Fixture US', lang: 'en-US', localService: true, voiceURI: 'fixture-us' }, ...(!state.missingUK ? [{ name: 'Fixture UK', lang: 'en-GB', localService: true, voiceURI: 'fixture-uk' }] : [])];
      }
      speak(u: Utterance) {
        state.speech.push({ text: u.text, lang: u.lang, rate: u.rate });
        queueMicrotask(() => {
          if (state.failTts) { u.onerror?.({ error: 'synthesis-failed' }); return; }
          u.onstart?.(); if (!state.hold) setTimeout(() => u.onend?.(), 20);
        });
      }
      cancel() { state.cancels++; }
    }
    Object.defineProperty(window, 'Audio', { configurable: true, value: FakeAudio });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: new Synth() });
  }, options);
}

