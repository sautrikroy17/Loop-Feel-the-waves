/**
 * Audio Reactive Engine
 *
 * YouTube IFrame audio is inaccessible via Web Audio API (cross-origin sandbox).
 * We implement a physics-based musical simulation that:
 *
 *  - Syncs to REAL playback position (progress from usePlayback)
 *  - Derives BPM from track title/genre heuristics
 *  - Models kick drums (beats 1,3), snare (beats 2,4), hi-hats (8th notes)
 *  - Uses exponential decay envelopes (physically accurate transients)
 *  - Smooth band-limited noise for organic variation
 *  - Publishes CSS custom props every RAF frame (zero React rerenders)
 *  - Subscriber callbacks for canvas consumers
 *
 * The result is visually indistinguishable from real FFT analysis.
 */

import { useEffect } from "react";
import { usePlayback } from "./usePlayback";
import { useSettings } from "./useSettings";

// ── Types ──────────────────────────────────────────────────────────

export interface AudioData {
  bass: number; // 0–1 sub-bass + kick energy
  mid: number; // 0–1 vocal / snare energy
  treble: number; // 0–1 hi-hat / presence energy
  loudness: number; // 0–1 perceived overall level
  beat: number; // 0–1 sharp impulse at kick (for flash effects)
  isActive: boolean;
  freqBins: Float32Array; // 128 bins 0–1 for visualizer bars
}

// ── Module-level singleton (NOT React state — zero rerenders) ──────

const _data: AudioData = {
  bass: 0,
  mid: 0,
  treble: 0,
  loudness: 0,
  beat: 0,
  isActive: false,
  freqBins: new Float32Array(128),
};

let _sBass = 0,
  _sMid = 0,
  _sTreble = 0,
  _sBeat = 0; // smoothed values
let _rafId = 0;
let _bpm = 120;
let _lastTrackId = "";

const _cbs = new Set<(d: AudioData) => void>();

export function subscribeToAudio(cb: (d: AudioData) => void): () => void {
  _cbs.add(cb);
  return () => _cbs.delete(cb);
}

export function getAudioData(): Readonly<AudioData> {
  return _data;
}

// ── Musical helpers ────────────────────────────────────────────────

/** Band-limited pseudo-noise, returns 0–1 */
function sn(t: number, f: number): number {
  return (
    (Math.sin(t * f * 6.2832) * 0.5 +
      Math.sin(t * f * 6.2832 * 1.73) * 0.3 +
      Math.sin(t * f * 6.2832 * 2.39) * 0.2) *
      0.5 +
    0.5
  );
}

function bpmFor(title: string, artist: string): number {
  const s = (title + " " + artist).toLowerCase();
  if (s.includes("phonk") || s.includes("drift")) return 148;
  if (s.includes("trap") || s.includes("drill")) return 140;
  if (s.includes("house") || s.includes("techno")) return 128;
  if (s.includes("slowed") || s.includes("reverb")) return 72;
  if (s.includes("jazz")) return 95;
  if (s.includes("lofi") || s.includes("lo-fi")) return 85;
  if (s.includes("ambient") || s.includes("sleep")) return 60;
  return 120;
}

// ── RAF simulation loop ────────────────────────────────────────────

function tick() {
  if (document.hidden) {
    _rafId = requestAnimationFrame(tick);
    return;
  }

  const ps = usePlayback.getState();
  const active = ps.isPlaying && !!ps.currentTrack;
  const progress = ps.progress ?? 0;

  // BPM update on track change
  if (ps.currentTrack && ps.currentTrack.id !== _lastTrackId) {
    _lastTrackId = ps.currentTrack.id;
    _bpm = bpmFor(ps.currentTrack.title ?? "", ps.currentTrack.artist ?? "");
  }

  const t = performance.now() * 0.001;
  const alpha = 0.17;

  if (!active) {
    // Decay to silence
    _sBass *= 0.93;
    _sMid *= 0.94;
    _sTreble *= 0.93;
    _sBeat *= 0.88;
  } else {
    const bi = 60 / _bpm; // beat interval (seconds)
    const beats = progress / bi;
    const beatFrac = beats % 1; // 0–1 within current beat
    const barBeat = Math.floor(beats) % 4; // 0–3 within bar

    const isKick = barBeat === 0 || barBeat === 2;
    const isSnare = barBeat === 1 || barBeat === 3;

    // ── Bass: heavy kick attack, exponential decay ──────────────
    const kickDecay = Math.exp(-5 * beatFrac);
    const tBass =
      0.18 + (isKick ? kickDecay * 0.66 : Math.exp(-9 * beatFrac) * 0.14) + sn(t, 0.16) * 0.09;

    // ── Beat impulse: very sharp at kick onset ──────────────────
    const tBeat = isKick && beatFrac < 0.035 ? 1.0 : kickDecay * (isKick ? 0.45 : 0.08);

    // ── Mid: snare transient + harmonic sustain ─────────────────
    const snareDecay = Math.exp(-6 * beatFrac);
    const tMid = 0.22 + (isSnare ? snareDecay * 0.44 : 0) + sn(t, 0.11) * 0.15;

    // ── Treble: 8th-note hi-hats + air ─────────────────────────
    const hihatPhase = (beats * 2) % 1;
    const hihatDecay = Math.exp(-11 * hihatPhase);
    const tTreble = 0.1 + hihatDecay * 0.32 + sn(t, 0.45) * 0.1;

    _sBass += (tBass - _sBass) * alpha;
    _sMid += (tMid - _sMid) * alpha;
    _sTreble += (tTreble - _sTreble) * alpha;
    _sBeat += (tBeat - _sBeat) * 0.11; // slower → visible impulse
  }

  const loudness = _sBass * 0.5 + _sMid * 0.3 + _sTreble * 0.2;

  // ── Frequency bins for visualizer (128 bins) ───────
  const { effectIntensity } = useSettings.getState();
  const intensity = effectIntensity ?? 0.75;
  for (let i = 0; i < 128; i++) {
    const n = i / 127;
    let v: number;
    if (n < 0.07) v = _sBass * 0.88 + sn(t + i * 0.4, 1.9) * 0.1;
    else if (n < 0.2) v = _sBass * (1 - ((n - 0.07) / 0.13) * 0.45);
    else if (n < 0.48) v = _sMid * (0.78 - (n - 0.2) * 0.42) + sn(t + i * 0.12, 0.78) * 0.09;
    else if (n < 0.76) v = _sMid * 0.22 * (1 - (n - 0.48) / 0.28) + sn(t + i * 0.22, 1.35) * 0.07;
    else v = _sTreble * 0.4 * (1 - ((n - 0.76) / 0.24) * 0.8) + sn(t + i * 0.5, 2.9) * 0.05;
    _data.freqBins[i] = Math.max(0, Math.min(1, v * intensity));
  }

  _data.bass = _sBass;
  _data.mid = _sMid;
  _data.treble = _sTreble;
  _data.loudness = loudness;
  _data.beat = _sBeat;
  _data.isActive = active;

  // ── CSS custom properties → instant background reactions ───────
  // (Removed: they were causing global style recalculation lag and unused)

  if (_cbs.size > 0) _cbs.forEach((cb) => cb(_data));

  _rafId = requestAnimationFrame(tick);
}

// ── Public hook — call ONCE at app root ───────────────────────────

export function useAudioEngine(): void {
  useEffect(() => {
    if (_rafId !== 0) return; // already running
    _rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(_rafId);
      _rafId = 0;
    };
  }, []);
}
