import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getRecommendationsFn } from '@/functions/search';

export interface Track {
  id: string;
  title: string;
  artist: string;
  albumArt: string;
  youtubeId?: string;
  durationMs?: number;
}

interface PlaybackState {
  currentTrack: Track | null;
  queue: Track[];
  history: Track[];
  isPlaying: boolean;
  volume: number;
  progress: number;
  duration: number;
  seekTarget: number | null;
  youtubePlayerReady: boolean;
  isShuffle: boolean;
  repeatMode: 'none' | 'all' | 'one';
  isLoadingTrack: boolean;
  isAutoQueuing: boolean;
  isAutoplay: boolean;

  playTrack: (track: Track) => void;
  setPlaying: (playing: boolean) => void;
  togglePlayPause: () => void;
  setVolume: (vol: number) => void;
  setProgress: (prog: number) => void;
  setDuration: (dur: number) => void;
  seekTo: (seconds: number) => void;
  clearSeekTarget: () => void;
  setYoutubePlayerReady: (ready: boolean) => void;
  setLoadingTrack: (loading: boolean) => void;
  nextTrack: () => Promise<void>;
  prevTrack: () => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (oldIndex: number, newIndex: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  toggleAutoplay: () => void;
}

/**
 * Build an autoplay seed query from current listening context.
 * Import is LAZY (inside function) to avoid circular dependency issues.
 */
function buildAutoplaySeed(currentTrack: Track): string {
  // Lazy import — avoids circular dependency at module init time
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/hooks/useListeningIntelligence');
    const intel = mod.useListeningIntelligence?.getState?.();
    if (intel) {
      const topGenre  = intel.getTopGenres?.(1)?.[0] ?? '';
      const identity  = intel.getTasteIdentity?.() ?? '';
      
      // If we have a strong identity, use it as a massive emotional guardrail.
      const parts: string[] = [];
      const artistFirst = currentTrack.artist.split(/[,&]/)[0].trim();
      if (artistFirst) parts.push(artistFirst);
      
      // Blend current track genre with user's core identity vibe
      if (identity && identity !== 'New Explorer') parts.push(identity);
      else if (topGenre && topGenre !== 'pop') parts.push(topGenre);

      // E.g. "The Weeknd Dark R&B Addict playlist"
      return parts.join(' ') || (currentTrack.youtubeId ?? currentTrack.id);
    }
  } catch { /* intelligence not available */ }
  return currentTrack.youtubeId ?? currentTrack.id;
}

async function backgroundRefill(seedTrack: Track, currentQueue: Track[]) {
  if (currentQueue.length >= 20) return;
  try {
    const seed = seedTrack.youtubeId ?? seedTrack.id;
    const recs = await getRecommendationsFn({ data: seed });
    if (!recs?.length) {
      usePlayback.setState({ isAutoQueuing: false });
      return;
    }
    const existing = new Set([seedTrack.id, ...currentQueue.map(t => t.id)]);
    const fresh = (recs as Track[]).filter(t => !existing.has(t.id));
    
    usePlayback.setState(s => ({
      queue: [...s.queue, ...fresh].slice(0, 30),
      isAutoQueuing: false,
    }));
  } catch {
    usePlayback.setState({ isAutoQueuing: false });
  }
}

export const usePlayback = create<PlaybackState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      queue: [],
      history: [],
      isPlaying: false,
      volume: 80,
      progress: 0,
      duration: 0,
      seekTarget: null,
      youtubePlayerReady: false,
      isShuffle: false,
      repeatMode: 'none',
      isLoadingTrack: false,
      isAutoQueuing: false,
      isAutoplay: true,

      playTrack: (track) => {
        set((state) => {
          const history = state.currentTrack
            ? [...state.history, state.currentTrack].slice(-50) // keep last 50
            : state.history;
          return { 
            currentTrack: track, 
            isPlaying: true, 
            progress: 0, 
            duration: 0, 
            history, 
            isLoadingTrack: true 
          };
        });
        
        // Auto-populate queue instantly if autoplay is enabled
        const state = get();
        if (state.isAutoplay && state.queue.length < 5) {
          set({ isAutoQueuing: true });
          backgroundRefill(track, state.queue);
        }
      },

      setPlaying: (playing) => set({ isPlaying: playing }),

      togglePlayPause: () => {
        const { isPlaying, currentTrack } = get();
        if (currentTrack) set({ isPlaying: !isPlaying });
      },

      setVolume:        (vol)     => set({ volume: vol }),
      setProgress:      (prog)    => set({ progress: prog }),
      setDuration:      (dur)     => set({ duration: dur }),
      seekTo:           (seconds) => set({ seekTarget: seconds }),
      clearSeekTarget:  ()        => set({ seekTarget: null }),
      setYoutubePlayerReady: (r)  => set({ youtubePlayerReady: r }),
      setLoadingTrack:  (loading) => set({ isLoadingTrack: loading }),

      addToQueue:       (track)   => set((s) => ({ queue: [...s.queue, track] })),
      removeFromQueue:  (index)   => set((s) => ({ queue: s.queue.filter((_, i) => i !== index) })),
      reorderQueue: (oldIndex, newIndex) => set((s) => {
        const q = [...s.queue];
        const [moved] = q.splice(oldIndex, 1);
        q.splice(newIndex, 0, moved);
        return { queue: q };
      }),
      toggleShuffle:    ()        => set((s) => ({ isShuffle: !s.isShuffle })),

      toggleRepeat: () => set((s) => {
        const modes: PlaybackState['repeatMode'][] = ['none', 'all', 'one'];
        return { repeatMode: modes[(modes.indexOf(s.repeatMode) + 1) % modes.length] };
      }),
      toggleAutoplay: () => {
        const next = !get().isAutoplay;
        set({
          isAutoplay: next,
          // Turning OFF: wipe the auto-filled queue immediately → music stops after current track
          // Turning ON:  leave queue as-is; it'll refill on next play
          queue: next ? get().queue : [],
          isAutoQueuing: false,
        });
        // Keep Settings panel toggle in sync
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { useSettings } = require('@/hooks/useSettings');
          useSettings.setState({ autoplay: next });
        } catch { /* settings not loaded yet */ }
      },

      prevTrack: () => {
        const { history, currentTrack, progress } = get();
        if (progress > 3 || history.length === 0) {
          set({ seekTarget: 0 });
          return;
        }
        const prev = history[history.length - 1];
        set((s) => ({
          currentTrack: prev,
          history: s.history.slice(0, -1),
          queue: currentTrack ? [currentTrack, ...s.queue] : s.queue,
          progress: 0, duration: 0, isPlaying: true, isLoadingTrack: true,
        }));
      },

      nextTrack: async () => {
        const { queue, currentTrack, history, repeatMode, isShuffle, isAutoQueuing } = get();

        // Repeat one: restart same track
        if (currentTrack && repeatMode === 'one') {
          set({ seekTarget: 0, isPlaying: true });
          return;
        }

        const nextHistory = currentTrack
          ? [...history, currentTrack].slice(-50)
          : history;

        // ── Case 1: Queue has tracks ───────────────────────────────────
        if (queue.length > 0) {
          const nextIndex = isShuffle ? Math.floor(Math.random() * queue.length) : 0;
          const next      = queue[nextIndex];
          const newQueue  = queue.filter((_, i) => i !== nextIndex);

          // Repeat all: push current back
          if (repeatMode === 'all' && currentTrack) newQueue.push(currentTrack);

          set({
            currentTrack: next,
            queue: newQueue,
            history: nextHistory,
            isPlaying: true,
            progress: 0, duration: 0,
            isLoadingTrack: true,
          });

          // Silently refill if running low — ONLY when autoplay is on
          if (newQueue.length < 4 && !isAutoQueuing && get().isAutoplay) {
            set({ isAutoQueuing: true });
            backgroundRefill(next, newQueue);
          }
          return;
        }

        // ── Case 2: Queue empty — fetch fresh autoplay ────────────────
        if (currentTrack) {
          if (!get().isAutoplay) {
            set({ isPlaying: false });
            return;
          }

          set({ isAutoQueuing: true });
          try {
            const seed = buildAutoplaySeed(currentTrack);
            const recs = await getRecommendationsFn({ data: seed });

            if (recs?.length) {
              const tracks = recs as Track[];
              const fresh  = tracks.filter(t => t.id !== currentTrack.id);
              if (fresh.length > 0) {
                set({
                  currentTrack: fresh[0],
                  queue: fresh.slice(1, 16),
                  history: nextHistory,
                  isPlaying: true,
                  progress: 0, duration: 0,
                  isLoadingTrack: true,
                  isAutoQueuing: false,
                });
                return;
              }
            }
          } catch (e) {
            console.warn('[Loop] Autoplay fetch failed:', e);
          }

          // ── Case 3: API failed — replay history (music NEVER stops) ──
          if (nextHistory.length > 0) {
            const pool = isShuffle
              ? [...nextHistory].sort(() => Math.random() - 0.5)
              : [...nextHistory].reverse();
              
            const fallbackTrack = pool[0];
            
            if (fallbackTrack.id === currentTrack.id) {
              // If we are literally stuck on the exact same track, just restart it
              // instead of triggering a fake load that AudioEngine ignores
              set({ 
                seekTarget: 0, 
                isPlaying: true,
                isAutoQueuing: false
              });
              return;
            }

            set({
              currentTrack: fallbackTrack,
              queue: pool.slice(1),
              history: [],
              isPlaying: true,
              progress: 0, duration: 0,
              isLoadingTrack: true,
              isAutoQueuing: false,
            });
            return;
          }

          // Nothing left
          set({ isAutoQueuing: false, isPlaying: false });
        }
      },
    }),
    {
      name: 'loop-playback-v1',
      // Only persist what matters for restoring the last session
      partialize: (state) => ({
        currentTrack: state.currentTrack,
        queue: state.queue,
        history: state.history,
        volume: state.volume,
        isShuffle: state.isShuffle,
        repeatMode: state.repeatMode,
        isAutoplay: state.isAutoplay,
        // DO NOT persist: isPlaying, isLoadingTrack, youtubePlayerReady, seekTarget, duration, progress
      }),
    }
  )
);
