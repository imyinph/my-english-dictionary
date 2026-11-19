import type { Accent, PronunciationProvider, PronunciationRequest } from '../domain/dictionary.ts';
import type { AudioPlayer, AudioResolver, AudioResource, ResolvedAudio } from '../domain/audio.ts';
import { ManifestAudioResolver } from './audioResolver.ts';
import { PollyAudioResolver } from './pollyManifest.ts';
import speedAssets from '../../content/audio-rates-v1.json' with { type: 'json' };

const speedIndex: Record<string, Record<string, string>> = speedAssets;

function recordedSpeedUrl(url: string, rate: number) {
  if (rate === 1) return;
  const match = /\/audio\/polly\/en-US\/neural\/(joanna|stephen)\/([a-f0-9]{64})\.mp3$/.exec(url);
  if (!match) return;
  const percent = String(rate * 100);
  const hash = speedIndex[match[2]]?.[percent];
  if (hash) return url.slice(0, match.index) + `/audio/rates/${match[1]}/${percent}/${hash}.mp3`;
}

export interface Voice { name: string; lang: string; localService: boolean; voiceURI: string }
export interface SpeechStatus {
  phase: 'idle' | 'loading' | 'playing' | 'finished' | 'error';
  message: string;
  kind?: 'recording' | 'neural' | 'tts';
  text?: string;
  needsTtsConsent?: boolean;
}
export interface PlaybackBackend {
  requiresTtsConsent?(): boolean;
  recording(url: string, rate: number, signal: AbortSignal, onStart: () => void): Promise<void>;
  voices(): Voice[];
  waitForVoices(signal: AbortSignal): Promise<Voice[]>;
  speak(text: string, voice: Voice, rate: number, signal: AbortSignal, onStart: () => void): Promise<void>;
}

export const localeFor = (accent: Accent) => accent === 'US' ? 'en-US' : 'en-GB';
export function selectVoice(voices: Voice[], accent: Accent): Voice | undefined {
  // Never label an arbitrary English voice as US/UK, or fall back to a Chinese default.
  return voices.filter(voice => voice.lang.replaceAll('_', '-').toLowerCase() === localeFor(accent).toLowerCase()).sort((a, b) => Number(b.localService) - Number(a.localService))[0];
}

export class PronunciationController implements PronunciationProvider, AudioPlayer {
  private backend: PlaybackBackend;
  private resolver: AudioResolver;
  private operation?: AbortController;
  private listeners = new Set<() => void>();
  private state: SpeechStatus = { phase: 'idle', message: '默认 Joanna 美音；Polly Neural 优先，浏览器 TTS 需主动选择。' };
  constructor(backend: PlaybackBackend, resolver: AudioResolver = new ManifestAudioResolver({ schemaVersion: 1, resources: [] }, 'https://localhost/')) { this.backend = backend; this.resolver = resolver; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(state: SpeechStatus) { this.state = state; this.listeners.forEach(listener => listener()); }
  stop = () => { this.operation?.abort(); this.operation = undefined; this.update({ phase: 'idle', message: '已停止朗读。' }); };
  async playResource(resource: AudioResource, rate: number) {
    this.operation?.abort();
    const operation = new AbortController(); this.operation = operation;
    const set = (state: SpeechStatus) => { if (!operation.signal.aborted) this.update({ ...state, text: resource.text }); };
    const candidate = this.resolver.audition(resource);
    if (!candidate) { set({ phase: 'error', message: '此样本尚未生成、校验信息不完整或已被拒绝。' }); return; }
    const speed = Number.isFinite(rate) ? Math.max(.5, Math.min(1.25, rate)) : 1;
    set({ phase: 'loading', kind: 'neural', message: `正在加载试听：${candidate.label}` });
    try {
      await this.backend.recording(candidate.urls[0], speed, operation.signal, () => set({ phase: 'playing', kind: 'neural', message: `正在试听 ${resource.locale} · ${candidate.label}` }));
      set({ phase: 'finished', kind: 'neural', message: `试听结束：${candidate.label}。请记录实际听感。` });
    } catch { set({ phase: 'error', kind: 'neural', message: '试听音频加载或播放失败，请检查网络后重试。试听不会改用浏览器 TTS。' }); }
  }
  async play(request: PronunciationRequest) {
    this.operation?.abort();
    const operation = new AbortController();
    this.operation = operation;
    const signal = operation.signal;
    const text = request.text.trim();
    const rate = Number.isFinite(request.rate) ? Math.max(0.5, Math.min(1.25, request.rate)) : 1;
    const set = (state: SpeechStatus) => { if (!signal.aborted) this.update({ ...state, text }); };
    if (!text) { set({ phase: 'error', message: '没有可朗读的文本。' }); return; }
    // Existing M1 source recordings remain usable only for the legacy entry-level pronunciation.
    // Never inherit a spelling-level recording for a newly identified heteronym or sense.
    let manifestFailed = false;
    if (!request.allowBrowserTts && this.resolver.prepare) { try { await this.resolver.prepare(); } catch { manifestFailed = true; } }
    if (signal.aborted) return;
    const recordings = !request.allowBrowserTts && (!request.target || request.target.pronunciationId === 'entry-default') ? request.recordings?.filter(recording => recording.accent === request.accent) ?? [] : [];
    const resolved = request.target && !request.allowBrowserTts && !manifestFailed ? this.resolver.resolve(request.target, localeFor(request.accent), request.voice, text) : [];
    const legacy: ResolvedAudio[] = recordings.map(r => ({ urls: r.urls, source: 'human', label: r.author }));
    const candidates = [...resolved, ...legacy];
    let failedRecording = false;
    for (const recording of candidates) {
      const kind = recording.source === 'human' ? 'recording' : 'neural';
      const description = recording.source === 'human' ? '真人录音' : '神经网络合成';
      for (const url of recording.urls) {
        if (signal.aborted) return;
        set({ phase: 'loading', kind, message: `正在加载 ${request.accent} ${description}…` });
        try {
          await this.backend.recording(url, rate, signal, () => set({ phase: 'playing', kind, message: `正在播放 ${request.accent} ${description} · ${recording.label}` }));
          if (!signal.aborted) set({ phase: 'finished', kind, message: `${request.accent} ${description}播放结束。${kind === 'neural' ? recording.label : ''}` });
          return;
        } catch { if (signal.aborted) return; failedRecording = true; }
      }
    }
    const failedKind = candidates.some(candidate => candidate.source === 'human') ? '真人录音' : '神经网络音频';
    const prefix = failedRecording ? `${failedKind}播放失败，已尝试回退：` : `暂无可用的 ${request.accent} 音频：`;
    if (!request.allowBrowserTts) {
      set({ phase: 'error', needsTtsConsent: true, message: `${manifestFailed ? '音频清单加载失败。' : '暂无可播放的匹配音频。'}浏览器 TTS 在 iOS 上可能失真，未自动启用。可主动选择“本次使用备用 TTS”。` });
      return;
    }
    set({ phase: 'loading', kind: 'tts', message: `${prefix}正在检查浏览器 TTS…` });
    try {
      let voice = selectVoice(this.backend.voices(), request.accent);
      if (!voice) voice = selectVoice(await this.backend.waitForVoices(signal), request.accent);
      if (signal.aborted) return;
      if (!voice) throw new Error(`此设备未提供 ${localeFor(request.accent)} 声音，请安装对应系统语音后重试。`);
      await this.backend.speak(text, voice, rate, signal, () => set({ phase: 'playing', kind: 'tts', message: `${prefix}浏览器 TTS ${request.accent} · ${voice.name}（合成语音）` }));
      set({ phase: 'finished', kind: 'tts', message: `${prefix}浏览器 TTS ${request.accent} 朗读结束（合成语音）。` });
    } catch (error) {
      if (!signal.aborted) set({ phase: 'error', kind: 'tts', message: `${prefix}${error instanceof Error ? error.message : '浏览器 TTS 失败，请重试。'}` });
    }
  }
}

const cancelled = () => new DOMException('Cancelled', 'AbortError');
function speechSynthesisApi() { return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined; }

export const browserBackend: PlaybackBackend = {
  requiresTtsConsent: () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  recording(url, rate, signal, onStart) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(cancelled()); return; }
      const audio = new Audio();
      audio.preload = 'none';
      // Selecting a new source can reset playbackRate to the element's default.
      const variantUrl = recordedSpeedUrl(url, rate);
      const nativeRate = variantUrl ? 1 : rate;
      audio.defaultPlaybackRate = nativeRate;
      const applyRate = () => { if (audio.playbackRate !== nativeRate) audio.playbackRate = nativeRate; };
      audio.preservesPitch = true;
      let done = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: Error) => {
        if (done) return; done = true;
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        audio.onloadedmetadata = null; audio.onplaying = null; audio.onended = null; audio.onerror = null;
        audio.pause(); audio.removeAttribute('src'); audio.load();
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(cancelled());
      signal.addEventListener('abort', abort, { once: true });
      audio.onloadedmetadata = applyRate;
      audio.onplaying = () => { applyRate(); clearTimeout(timer); timer = setTimeout(() => finish(new Error('录音播放超时。')), 60000); onStart(); };
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error('录音加载或解码失败。'));
      timer = setTimeout(() => finish(new Error('录音加载超时。')), 8000);
      audio.src = variantUrl ?? url;
      applyRate();
      try { void audio.play().catch(() => finish(new Error('浏览器未能播放此录音。'))); } catch { finish(new Error('浏览器不支持此录音。')); }
    });
  },
  voices() { return speechSynthesisApi()?.getVoices() ?? []; },
  waitForVoices(signal) {
    return new Promise((resolve, reject) => {
      const synth = speechSynthesisApi();
      if (!synth) { reject(new Error('此浏览器不支持语音合成。')); return; }
      if (signal.aborted) { reject(cancelled()); return; }
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => { clearTimeout(timer); synth.removeEventListener('voiceschanged', changed); signal.removeEventListener('abort', abort); };
      const changed = () => { if (synth.getVoices().length) { cleanup(); resolve(synth.getVoices()); } };
      const abort = () => { cleanup(); reject(cancelled()); };
      synth.addEventListener('voiceschanged', changed);
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { cleanup(); resolve(synth.getVoices()); }, 1500);
      changed();
    });
  },
  speak(text, voice, rate, signal, onStart) {
    return new Promise((resolve, reject) => {
      const synth = speechSynthesisApi();
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') { reject(new Error('此浏览器不支持语音合成。')); return; }
      if (signal.aborted) { reject(cancelled()); return; }
      const actualVoice = synth.getVoices().find(item => item.voiceURI === voice.voiceURI && item.lang === voice.lang);
      if (!actualVoice) { reject(new Error('所选声音已不可用，请重试。')); return; }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = actualVoice; utterance.lang = actualVoice.lang; utterance.rate = rate;
      let done = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: Error) => {
        if (done) return; done = true;
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        utterance.onstart = null; utterance.onend = null; utterance.onerror = null;
        if (error) { synth.cancel(); reject(error); } else resolve();
      };
      const abort = () => finish(cancelled());
      signal.addEventListener('abort', abort, { once: true });
      utterance.onstart = () => { clearTimeout(timer); timer = setTimeout(() => finish(new Error('TTS 朗读超时，请重试。')), Math.min(180000, Math.max(15000, text.length * 180 / rate))); onStart(); };
      utterance.onend = () => finish();
      utterance.onerror = event => finish(new Error(`TTS 朗读失败（${event.error}）。请检查系统声音、网络或播放权限后重试。`));
      timer = setTimeout(() => finish(new Error('TTS 未能开始播放，请再次点击或检查系统语音。')), 7000);
      try { synth.speak(utterance); } catch { finish(new Error('TTS 启动失败，请重试。')); }
    });
  },
};

const audioBase = typeof document === 'undefined' ? 'https://localhost/' : (import.meta.env.VITE_AUDIO_ASSET_BASE || new URL(import.meta.env.BASE_URL, document.baseURI).href);
export const pronunciation = new PronunciationController(browserBackend, new PollyAudioResolver({ schemaVersion: 1, resources: [] }, audioBase));
