import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Recording } from '../domain/dictionary.ts';
import type { AudioTarget, PollyVoice } from '../domain/audio.ts';
import { loadPollyManifest } from '../providers/pollyManifest.ts';
import { browserBackend, pronunciation, selectVoice } from '../providers/pronunciation.ts';

type Settings = { accent: 'US'; voice: PollyVoice; rate: number };
const key = 'dictionary.audio-settings.v1';
const defaults: Settings = { accent: 'US', voice: 'Joanna', rate: 1 };
function initialSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
    const migrated: Settings = { accent: 'US', voice: stored?.voice === 'Stephen' ? 'Stephen' : 'Joanna', rate: [0.5, 0.75, 1, 1.25].includes(stored?.rate) ? stored.rate : 1 };
    if (stored) localStorage.setItem(key, JSON.stringify(migrated));
    return migrated;
  } catch { return defaults; }
}
const AudioContext = createContext<{ settings: Settings; change: (settings: Settings) => void }>({ settings: defaults, change: () => {} });
export const useAudioSettings = () => useContext(AudioContext).settings;

export function AudioProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(initialSettings);
  const change = (value: Settings) => {
    pronunciation.stop();
    setSettings(value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Playback still works when local preferences cannot be stored. */ }
  };
  useEffect(() => {
    void loadPollyManifest().catch(() => {});
    const stopWhenHidden = () => { if (document.hidden) pronunciation.stop(); };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => { pronunciation.stop(); document.removeEventListener('visibilitychange', stopWhenHidden); };
  }, []);
  return <AudioContext value={{ settings, change }}>{children}</AudioContext>;
}

export function AudioSettings() {
  const { settings, change } = useContext(AudioContext);
  const status = useSyncExternalStore(pronunciation.subscribe, pronunciation.getSnapshot);
  const [voice, setVoice] = useState(() => selectVoice(browserBackend.voices(), settings.accent));
  useEffect(() => {
    const update = () => setVoice(selectVoice(browserBackend.voices(), settings.accent));
    update();
    window.speechSynthesis?.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', update);
  }, [settings.accent]);
  return <section className="audio-settings" aria-label="全局朗读设置">
    <div className="audio-settings-controls">
      <label>音色 <select aria-label="朗读音色" value={settings.voice} onChange={event => change({ ...settings, voice: event.target.value as PollyVoice })}><option value="Joanna">Joanna — Female</option><option value="Stephen">Stephen — Male</option></select></label><span className="small muted">美音 · Polly Neural</span>
      <label>语速 <select aria-label="朗读语速" value={settings.rate} onChange={event => change({ ...settings, rate: Number(event.target.value) })}><option value="0.5">0.5×</option><option value="0.75">0.75× 慢速</option><option value="1">1× 正常</option><option value="1.25">1.25×</option></select></label>
      <button className="stop-audio" onClick={pronunciation.stop} disabled={!['loading', 'playing'].includes(status.phase)}>停止朗读</button>
      <span className="voice-info">{voice ? `备用 TTS：${voice.name}` : `未检测到 ${settings.accent} TTS 声音`}</span>
    </div>
    <p className={`audio-status ${status.phase === 'error' ? 'audio-error' : ''}`} role="status" aria-live="polite">{status.message}</p>
  </section>;
}

export function PlayButton({ text, recordings, target, example = false }: { text: string; recordings?: Recording[]; target?: AudioTarget; example?: boolean }) {
  const settings = useAudioSettings();
  const status = useSyncExternalStore(pronunciation.subscribe, pronunciation.getSnapshot);
  return <><button className={`play-audio ${example ? 'example-audio' : ''}`} aria-label={`${example ? '朗读例句' : '朗读词条'}：${text}`} onClick={() => { void pronunciation.play({ text, recordings, target, ...settings }); }}><span aria-hidden="true">▷</span> {example ? '朗读例句' : `发音 · ${settings.voice}`}</button>{status.text === text && <><span className={`playback-feedback ${status.phase === 'error' ? 'audio-error' : ''}`}>{status.message}</span>{status.needsTtsConsent && <button className="play-audio" onClick={() => { void pronunciation.play({ text, target, ...settings, allowBrowserTts: true }); }}>本次使用备用 TTS（可能失真）</button>}</>}</>;
}

export function SensePronunciation({ entryId, senseId, text, kind }: { entryId: string; senseId: string; text: string; kind: 'word' | 'phrase' }) {
  const [target, setTarget] = useState<AudioTarget>();
  useEffect(() => {
    let active = true;
    loadPollyManifest().then(manifest => {
      const t = manifest.resources.flatMap(r => r.targets ?? [r.target]).find(t => t.contentId === entryId && t.senseId === senseId && t.kind === kind);
      if (active) setTarget(t);
    }).catch(() => {});
    return () => { active = false; };
  }, [entryId, senseId, kind]);
  return target ? <div className="sense-pronunciation"><span>此义项读音 </span><PlayButton text={text} target={target} /></div> : null;
}
