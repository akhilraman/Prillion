/**
 * Original Web Audio cues. Quiet, watery, short.
 *
 * Cue shapes follow Krillion's synthesizer (submit blip, 1.3 s sink whoosh,
 * a bigger sting for rarer tiers, reject thud, 5 s tick, surface wash).
 * The tones are generated here — Krillion's code and files are not used.
 * The bus is about a third of Krillion's, so it stays quiet.
 *
 * Domain stays pure: this module is the only place that touches AudioContext.
 * jsdom has no AudioContext, so every public function no-ops there.
 */

import type { RarityTier } from '../domain/types.ts';
import { getBrowserStorage } from '../storage/playHistory.ts';
import type { StorageLike } from '../storage/playHistory.ts';

export const MUTE_KEY = 'prillion.soundMuted.v1';

/**
 * Bus gain. Krillion's synthesizer sits at 0.75; this is about a third of that,
 * so the same cue shapes stay audible without dominating a phone speaker.
 */
const MASTER = 0.28;

export type SoundCue =
  'start' | 'submit' | 'miss' | 'timeout' | 'sink' | 'tier' | 'descend' | 'warn' | 'finish';

export interface PlayOptions {
  tier?: RarityTier;
  /** Ignore a second play of the same key within 120 ms (React Strict Mode remounts). */
  onceKey?: string;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sinkSource: AudioBufferSourceNode | null = null;
let storageOverride: StorageLike | null | undefined;
const recent = new Map<string, number>();

export function configureSound(options: { storage?: StorageLike | null } = {}): void {
  if ('storage' in options) storageOverride = options.storage;
}

function storage(): StorageLike | null {
  if (storageOverride !== undefined) return storageOverride;
  return getBrowserStorage();
}

export function isMuted(): boolean {
  return storage()?.getItem(MUTE_KEY) === '1';
}

export function setMuted(next: boolean): void {
  try {
    storage()?.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    // Private mode / quota: keep going; only this session is affected.
  }
  if (master) master.gain.value = next ? 0 : MASTER;
}

function ctor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? w.webkitAudioContext;
}

function context(): AudioContext | null {
  if (isMuted()) return null;
  const Audio = ctor();
  if (!Audio) return null;
  if (!ctx) {
    ctx = new Audio();
    master = ctx.createGain();
    master.gain.value = MASTER;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Browsers start AudioContext suspended until a user gesture. Call from pointer/key. */
export function unlockAudio(): void {
  const ac = context();
  if (ac?.state === 'suspended') void ac.resume();
}

export function installUnlock(): () => void {
  if (typeof window === 'undefined') return () => {};
  const unlock = () => unlockAudio();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
}

interface ToneOpts {
  f0: number;
  f1?: number;
  dur?: number;
  attack?: number;
  peak?: number;
  type?: OscillatorType;
  lp?: number;
  delay?: number;
}

interface NoiseOpts {
  dur?: number;
  lp?: number;
  sweepTo?: number;
  hp?: number;
  peak?: number;
  attack?: number;
  delay?: number;
}

/** Shaped like Krillion's synth: linear attack, then an exponential fall to silence. */
function env(ac: AudioContext, start: number, attack: number, dur: number, peak: number): GainNode {
  const g = ac.createGain();
  const safe = Math.max(peak, 0.0002);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(safe, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + attack + dur);
  return g;
}

function tone(ac: AudioContext, opts: ToneOpts): void {
  if (!master) return;
  const { f0, f1, dur = 0.2, attack = 0.005, peak = 0.3, type = 'sine', lp, delay = 0 } = opts;
  const start = ac.currentTime + delay;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, start);
  if (f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), start + dur);
  const g = env(ac, start, attack, dur, peak);
  if (lp) {
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lp;
    osc.connect(filter);
    filter.connect(g);
  } else {
    osc.connect(g);
  }
  g.connect(master);
  osc.start(start);
  osc.stop(start + dur + attack + 0.05);
}

function noise(ac: AudioContext, opts: NoiseOpts = {}): AudioBufferSourceNode {
  const { dur = 0.3, lp = 1200, sweepTo, hp, peak = 0.25, attack = 0.003, delay = 0 } = opts;
  const start = ac.currentTime + delay;
  const length = Math.ceil(ac.sampleRate * (dur + 0.1));
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const low = ac.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.setValueAtTime(lp, start);
  if (sweepTo) low.frequency.exponentialRampToValueAtTime(Math.max(sweepTo, 1), start + dur);
  src.connect(low);
  let out: AudioNode = low;
  if (hp) {
    const high = ac.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = hp;
    low.connect(high);
    out = high;
  }
  const g = env(ac, start, attack, dur, peak);
  out.connect(g);
  g.connect(master!);
  src.start(start);
  src.stop(start + dur + 0.1);
  return src;
}

function arp(ac: AudioContext, notes: number[], step = 0.12, dur = 0.5, peak = 0.16): void {
  notes.forEach((f0, i) => tone(ac, { type: 'triangle', f0, dur, peak, lp: 3000, delay: i * step }));
}

export function stopSink(): void {
  try {
    sinkSource?.stop();
  } catch {
    // already stopped
  }
  sinkSource = null;
}

function playSink(ac: AudioContext): void {
  stopSink();
  // Krillion's sink: a short high ping, a 1.3 s whoosh sweeping down, a falling tone under it.
  tone(ac, { f0: 1150, dur: 0.7, attack: 0.01, peak: 0.1 });
  sinkSource = noise(ac, { dur: 1.3, lp: 1400, sweepTo: 180, peak: 0.16 });
  tone(ac, { f0: 300, f1: 60, dur: 1.3, peak: 0.1 });
  const src = sinkSource;
  src.onended = () => {
    if (sinkSource === src) sinkSource = null;
  };
}

/** The sting that lands with the rank. Rarer tiers get the bigger Krillion landings. */
function playTier(ac: AudioContext, tier: RarityTier | undefined): void {
  switch (tier) {
    case 'legendary':
      tone(ac, { f0: 60, f1: 40, dur: 1.2, peak: 0.22 });
      arp(ac, [784, 988, 1175, 1568], 0.13, 0.7, 0.12);
      noise(ac, { dur: 1.4, lp: 2500, hp: 1200, peak: 0.04, delay: 0.3 });
      break;
    case 'rare':
      tone(ac, { f0: 80, f1: 45, dur: 0.6, peak: 0.28 });
      noise(ac, { dur: 0.7, lp: 900, sweepTo: 200, peak: 0.14, delay: 0.02 });
      tone(ac, { type: 'triangle', f0: 523, dur: 0.4, peak: 0.09, delay: 0.15 });
      break;
    case 'uncommon':
      [523.25, 783.99].forEach((f0, i) =>
        tone(ac, { type: 'sine', f0, dur: 0.22, peak: 0.1, delay: i * 0.09 }),
      );
      break;
    default:
      tone(ac, { f0: 140, f1: 70, dur: 0.25, peak: 0.22, lp: 600 });
      noise(ac, { dur: 0.14, lp: 500, peak: 0.08 });
  }
}

function cue(ac: AudioContext, name: SoundCue, opts?: PlayOptions): void {
  switch (name) {
    case 'start':
      // Krillion's "category" cue: a rising wash, then two bright pings.
      noise(ac, { dur: 0.35, lp: 900, sweepTo: 4200, hp: 400, peak: 0.07 });
      tone(ac, { type: 'triangle', f0: 988, dur: 0.32, attack: 0.004, peak: 0.13, lp: 4000, delay: 0.12 });
      tone(ac, { type: 'triangle', f0: 1319, dur: 0.55, attack: 0.004, peak: 0.13, lp: 4000, delay: 0.24 });
      break;
    case 'submit':
      tone(ac, { f0: 1150, dur: 0.16, attack: 0.003, peak: 0.16 });
      break;
    case 'miss':
      stopSink();
      noise(ac, { dur: 0.22, lp: 420, peak: 0.16 });
      tone(ac, { f0: 150, f1: 62, dur: 0.36, peak: 0.18, lp: 700 });
      break;
    case 'timeout':
      stopSink();
      tone(ac, { f0: 220, f1: 52, dur: 0.7, peak: 0.2 });
      noise(ac, { dur: 0.5, lp: 400, peak: 0.12, delay: 0.05 });
      break;
    case 'sink':
      playSink(ac);
      break;
    case 'tier':
      playTier(ac, opts?.tier);
      break;
    case 'descend':
      noise(ac, { dur: 1.1, lp: 2000, sweepTo: 240, peak: 0.12 });
      tone(ac, { f0: 110, f1: 48, dur: 1.2, peak: 0.2 });
      tone(ac, { type: 'triangle', f0: 784, dur: 0.5, peak: 0.1, lp: 3000 });
      tone(ac, { type: 'triangle', f0: 523, dur: 0.75, peak: 0.1, lp: 3000, delay: 0.22 });
      break;
    case 'warn':
      tone(ac, { f0: 880, dur: 0.07, peak: 0.12 });
      tone(ac, { f0: 880, dur: 0.05, peak: 0.05, delay: 0.12 });
      break;
    case 'finish':
      noise(ac, { dur: 1.6, lp: 300, sweepTo: 3000, peak: 0.12 });
      tone(ac, { f0: 80, f1: 600, dur: 1.5, peak: 0.08 });
      break;
  }
}

export function play(name: SoundCue, opts: PlayOptions = {}): void {
  if (opts.onceKey) {
    const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const prev = recent.get(opts.onceKey) ?? 0;
    if (t - prev < 120) return;
    recent.set(opts.onceKey, t);
  }
  const ac = context();
  if (!ac || !master) return;
  try {
    cue(ac, name, opts);
  } catch {
    // A missing AudioContext method must never break a submit.
  }
}
