/**
 * playbackSync.ts — Lean cross-device playback restore
 *
 * Strategy (simple, no race conditions):
 *   ON BOOT   → Load cloud state once. If no track is playing, apply it (paused).
 *   ON CLOSE  → Save snapshot to cloud via keepalive fetch (beforeunload).
 *   NO real-time WebSockets — localStorage handles same-browser restore instantly.
 *   Cloud state is for cross-device "Pick up where you left off" only.
 */

import { supabase } from './client';
import { usePlayback } from '@/hooks/usePlayback';

let userId: string | null = null;
let bootDone = false;
let beforeUnloadListener: (() => void) | null = null;
// Pre-cached so beforeunload save is 100% synchronous (no async getSession call during tab close)
let cachedAccessToken: string | null = null;
let cachedSupabaseUrl = '';
let cachedAnonKey = '';

// ── Public API ────────────────────────────────────────────────────

export async function initPlaybackSync(uid: string) {
  // Only run once per logged-in session
  if (userId === uid && bootDone) return;
  userId = uid;
  bootDone = true;

  // Pre-cache auth credentials for the beforeunload handler
  // (beforeunload can't await async calls reliably)
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session?.access_token) {
    cachedAccessToken = sessionData.session.access_token;
    cachedSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    cachedAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  }

  // Keep the token fresh whenever Supabase silently refreshes it
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token) {
      cachedAccessToken = session.access_token;
    }
  });

  // 1. Restore from cloud if localStorage has nothing (cross-device case)
  const localState = usePlayback.getState();
  if (!localState.currentTrack) {
    try {
      const cloudState = await loadCloudState();
      if (cloudState?.currentTrack) {
        usePlayback.setState({
          currentTrack: cloudState.currentTrack,
          queue: cloudState.queue || [],
          progress: 0, // Always start restored tracks from the beginning (0:00)
          isShuffle: cloudState.isShuffle || false,
          repeatMode: cloudState.repeatMode || 'none',
          isPlaying: false, // Always start paused — user explicitly presses play
        });
      }
    } catch {
      // Silently ignore — localStorage is the fallback on the same device
    }
  }

  // 2. Register beforeunload handler (uses pre-cached token, fully synchronous)
  if (beforeUnloadListener) {
    window.removeEventListener('beforeunload', beforeUnloadListener);
  }
  beforeUnloadListener = () => {
    const state = usePlayback.getState();
    if (state.currentTrack && cachedAccessToken) {
      saveCloudStateBeacon(state);
    }
  };
  window.addEventListener('beforeunload', beforeUnloadListener);
}

export function stopPlaybackSync() {
  userId = null;
  bootDone = false;
  cachedAccessToken = null;
  if (beforeUnloadListener) {
    window.removeEventListener('beforeunload', beforeUnloadListener);
    beforeUnloadListener = null;
  }
}

// ── Cloud Read ────────────────────────────────────────────────────

async function loadCloudState() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.user_metadata?.playback_state) return null;
  return data.user.user_metadata.playback_state;
}

// ── Cloud Write (synchronous-safe for beforeunload) ───────────────

function saveCloudStateBeacon(state: ReturnType<typeof usePlayback.getState>) {
  if (!cachedAccessToken || !cachedSupabaseUrl) return;

  const payload = {
    currentTrack: state.currentTrack,
    queue: state.queue.slice(0, 30), // cap to stay under 8KB auth metadata limit
    progress: state.progress,
    isShuffle: state.isShuffle,
    repeatMode: state.repeatMode,
  };

  // keepalive: true guarantees this request completes even as the tab is closing
  fetch(`${cachedSupabaseUrl}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cachedAccessToken}`,
      apikey: cachedAnonKey,
    },
    body: JSON.stringify({ data: { playback_state: payload } }),
    keepalive: true,
  }).catch(() => {});
}
