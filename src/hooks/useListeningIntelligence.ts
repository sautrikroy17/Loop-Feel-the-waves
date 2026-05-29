/**
 * useListeningIntelligence — Loop's AI personalization brain
 *
 * Tracks all listening behavior locally (localStorage via Zustand persist).
 * Derives mood, genre preferences, session patterns, and smart query seeds
 * that drive personalized recommendations.
 *
 * Data collected:
 *  - Play events: track, artist, genre, timestamp, duration listened
 *  - Skip events: how far through a track before skipping
 *  - Repeat events: how many times a track was replayed
 *  - Like events: pulled from useUserProfile
 *
 * Derived signals:
 *  - topGenres: weighted by listen time, skips negative
 *  - topArtists: ranked by play + repeat count
 *  - sessionMood: detected from time-of-day + recent genre patterns
 *  - vibeQuery: ready-to-use search query for recommendations
 *  - weekdayProfile: genre distribution per day-of-week
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Types ─────────────────────────────────────────────────────────

export interface PlayEvent {
  trackId: string;
  title: string;
  artist: string;
  genres: string[]; // inferred from title/artist
  timestamp: number; // ms since epoch
  listenMs: number; // how long user listened before skip/end
  completed: boolean; // did they listen past 80%?
  skipped: boolean;
  repeated: boolean;
  liked: boolean;
}

export interface ListeningStats {
  totalTracks: number;
  totalListenMs: number;
  skips: number;
  repeats: number;
  completionRate: number; // 0–1
}

// ── Genre inference from title/artist strings ─────────────────────

const GENRE_PATTERNS: [RegExp, string][] = [
  // 1. Punjabi Tadka
  [/\b(diljit dosanjh|karan aujla|ap dhillon|sidhu moose|shubh|b praak|harrdy|ammy|guru randhawa|jassie|jazzy|mankirt|ninja|parmish|prophec|ikky|gurinder|sharry|gurnam|babbu maan|bohemia|imran khan|mickey singh|pav dharia|ranjit bawa|garry sandhu|prem dhillon)\b/i, "Punjabi Tadka"],

  // 2. Bollywood Romance
  [/\b(arijit singh|shreya ghoshal|jubin|vishal mishra|shekhar|sanam|aditi singh|pritam|atif|neha kakkar|badshah|honey singh|darshan|armaan|sonu nigam|udit|kumar sanu|kk|rahman|amit trivedi|sunidhi|tulsi|zayn|mohit chauhan|ankit tiwari|amaal|shaan|shilpa rao|palak muchhal|monali|benny dayal)\b/i, "Bollywood Romance"],

  // 3. Desi Trap
  [/\b(divine|naezy|seedhe maut|krsna|emiway|mc stan|ikka|raftaar|king|dino james|fotty seven|bali|karma|talha|young stunners|munawar)\b/i, "Desi Trap"],

  // 4. Dark R&B
  [/\b(weeknd|chase atlantic|partynextdoor|6lack|brent faiyaz|bryson tiller|frank ocean|sza|kehlani|summer walker|jhene aiko|giveon|daniel caesar)\b/i, "Dark R&B"],

  // 5. Atmospheric Trap
  [/\b(travis scott|playboi carti|yeat|ken carson|destroy lonely|lil uzi vert|future|young thug|gunna|don toliver|metro boomin|21 savage|drake|kendrick|j\.? cole)\b/i, "Atmospheric Trap"],

  // 6. Sad Girl Pop
  [/\b(lana del rey|billie eilish|mitski|phoebe bridgers|clairo|boygenius|lorde|taylor swift|gracie abrams|lizzy mcalpine|conan gray)\b/i, "Sad Girl Pop"],

  // 7. Global Pop
  [/\b(ariana grande|justin bieber|dua lipa|sabrina carpenter|tate mcrae|shawn mendes|charlie puth|ed sheeran|harry styles|miley cyrus|katy perry|lady gaga|viral)\b/i, "Global Pop"],

  // 8. K-Pop Energy
  [/\b(bts|blackpink|twice|stray kids|seventeen|newjeans|le sserafim|txt|enhypen|red velvet|exo|iu|jung kook|jimin)\b/i, "K-Pop Energy"],

  // 9. Afro Beats
  [/\b(burna boy|rema|wizkid|tyla|asake|davido|ayra starr|ckay|fireboy)\b/i, "Afro Beats"],

  // 10. Festival EDM
  [/\b(martin garrix|tiësto|tiesto|calvin harris|david guetta|avicii|skrillex|fred again|swedish house mafia|zedd|dj snake|alan walker|marshmello)\b/i, "Festival EDM"],

  // 11. Micro-Genres & Fallbacks
  [/\b(deftones|loathe|my bloody valentine)\b/i, "Shoegaze"],
  [/\b(lo-?fi|study|sleep)\b/i, "Lo-Fi Study"],
  [/\b(phonk|drift)\b/i, "Phonk"],
  [/\b(synthwave|retrowave)\b/i, "Synthwave"],
  [/\b(drill|central cee)\b/i, "Drill"],
  [/\b(classical|symphony|zimmer)\b/i, "Cinematic"],
  [/\b(r&b|rnb)\b/i, "Luxury R&B"],
  [/\b(indie|alt)\b/i, "Indie Nights"],
  [/\b(bollywood|hindi)\b/i, "Desi Heat"],
  [/\b(pop|viral)\b/i, "Viral Insta"],
];

export function inferGenres(title: string, artist: string): string[] {
  const s = `${title} ${artist}`;
  const found = GENRE_PATTERNS.filter(([re]) => re.test(s)).map(([, g]) => g);
  return found.length > 0 ? found : ["Viral Insta"];
}

// ── Zustand store ─────────────────────────────────────────────────

interface IntelligenceState {
  events: PlayEvent[]; // rolling 200-event log
  genreWeights: Record<string, number>; // weighted genre scores
  artistWeights: Record<string, number>;

  // Actions
  recordPlay: (event: Omit<PlayEvent, "genres"> & { title: string; artist: string }) => void;
  markLiked: (trackId: string) => void;
  markSkip: (trackId: string) => void;
  markRepeat: (trackId: string) => void;
  markCompleted: (trackId: string) => void;
  hydrateFromCloudHistory: (tracks: any[]) => void;
  reset: () => void;

  // Derived (computed getters)
  getTopGenres: (n?: number) => string[];
  getTopArtists: (n?: number) => string[];
  getTopReplayedTracks: (n?: number) => { title: string; artist: string }[];
  getVibeQuerySeed: () => { artist: string; genre: string };
  getStats: () => ListeningStats;
  getRecentArtists: (n?: number) => string[];
  getTasteIdentity: () => string;
  activeMood: string | null;
  setActiveMood: (mood: string | null) => void;
}

const MAX_EVENTS = 200;

export const useListeningIntelligence = create<IntelligenceState>()(
  persist(
    (set, get) => ({
      events: [],
      genreWeights: {},
      artistWeights: {},
      activeMood: null,

      setActiveMood: (mood) => set({ activeMood: mood }),

      injectLiveTrack: (raw) => {
        const genres = inferGenres(raw.title, raw.artist);
        const event: PlayEvent = {
          trackId: raw.trackId,
          title: raw.title,
          artist: raw.artist,
          genres,
          timestamp: raw.timestamp,
          listenMs: 0,
          completed: false,
          skipped: false,
          repeated: false,
          liked: false,
        };
        set((s) => {
          if (s.events[0]?.trackId === raw.trackId && s.events[0]?.timestamp === raw.timestamp) return s;
          return { events: [event, ...s.events].slice(0, MAX_EVENTS) };
        });
      },

      recordPlay: (raw) => {
        const genres = inferGenres(raw.title, raw.artist);

        set((s) => {
          const gw = { ...s.genreWeights };
          const listenScore = raw.completed ? 2 : raw.listenMs > 30_000 ? 1 : 0.3;
          const skipPenalty = raw.skipped ? -0.5 : 0;
          for (const g of genres) {
            gw[g] = (gw[g] ?? 0) + listenScore + skipPenalty;
          }

          const aw = { ...s.artistWeights };
          const artistKey = raw.artist.split(/[,&]/)[0].trim().toLowerCase();
          aw[artistKey] = (aw[artistKey] ?? 0) + listenScore;

          const events = [...s.events];
          const existingIdx = events.findIndex(
            (e) => e.trackId === raw.trackId && e.timestamp === raw.timestamp
          );
          if (existingIdx !== -1) {
            events[existingIdx] = {
              ...events[existingIdx],
              listenMs: raw.listenMs,
              completed: raw.completed,
              skipped: raw.skipped,
            };
          } else {
            events.unshift({ ...raw, genres });
          }

          return { events: events.slice(0, MAX_EVENTS), genreWeights: gw, artistWeights: aw };
        });
      },

      markLiked: (trackId) =>
        set((s) => {
          const track = s.events.find((e) => e.trackId === trackId);
          if (!track) return s;

          const gw = { ...s.genreWeights };
          const aw = { ...s.artistWeights };

          // Massive +5 multiplier for actively liking a track
          for (const g of track.genres) {
            gw[g] = (gw[g] ?? 0) + 5;
          }
          const artistKey = track.artist.split(/[,&]/)[0].trim().toLowerCase();
          aw[artistKey] = (aw[artistKey] ?? 0) + 5;

          return {
            events: s.events.map((e) => (e.trackId === trackId ? { ...e, liked: true } : e)),
            genreWeights: gw,
            artistWeights: aw,
          };
        }),

      markSkip: (trackId) =>
        set((s) => ({
          events: s.events.map((e) =>
            e.trackId === trackId && !e.skipped ? { ...e, skipped: true } : e,
          ),
        })),

      markRepeat: (trackId) =>
        set((s) => ({
          events: s.events.map((e) => (e.trackId === trackId ? { ...e, repeated: true } : e)),
        })),

      markCompleted: (trackId) =>
        set((s) => ({
          events: s.events.map((e) =>
            e.trackId === trackId && !e.completed ? { ...e, completed: true } : e,
          ),
        })),

      hydrateFromCloudHistory: (tracks) => {
        set((s) => {
          // Only hydrate if we don't already have extensive local history
          if (s.events.length > 20) return s;

          const gw = { ...s.genreWeights };
          const aw = { ...s.artistWeights };

          const newEvents: PlayEvent[] = tracks.map((t: any, i) => {
            const genres = inferGenres(t.title, t.artist);
            // Give them a flat positive score for being in history
            for (const g of genres) gw[g] = (gw[g] ?? 0) + 1;

            const artistKey = t.artist.split(/[,&]/)[0].trim().toLowerCase();
            aw[artistKey] = (aw[artistKey] ?? 0) + 1;

            return {
              trackId: t.id,
              title: t.title,
              artist: t.artist,
              genres,
              timestamp: Date.now() - i * 60000, // fake times
              listenMs: t.durationMs || 180000,
              completed: true,
              skipped: false,
              repeated: false,
              liked: false,
            };
          });

          // Merge without exceeding max events
          const merged = [...s.events, ...newEvents].slice(0, MAX_EVENTS);

          return { events: merged, genreWeights: gw, artistWeights: aw };
        });
      },

      reset: () => set({ events: [], genreWeights: {}, artistWeights: {} }),

      getTopGenres: (n = 5) => {
        const w = get().genreWeights;
        return Object.entries(w)
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
          .map(([g]) => g);
      },

      getTopArtists: (n = 5) => {
        const w = get().artistWeights;
        return Object.entries(w)
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
          .map(([a]) => a);
      },

      getTopReplayedTracks: (n = 3) => {
        const events = get().events;
        const trackScores: Record<
          string,
          { title: string; artist: string; videoId: string; score: number }
        > = {};

        for (const e of events) {
          const key = `${e.title}|${e.artist}`;
          if (!trackScores[key]) {
            trackScores[key] = { title: e.title, artist: e.artist, videoId: e.trackId, score: 0 };
          }
          trackScores[key].score += (e.repeated ? 3 : 0) + (e.completed ? 1 : 0);
        }

        const scored = Object.values(trackScores)
          .filter((t) => t.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, n)
          .map((t) => ({ title: t.title, artist: t.artist }));

        // Fallback: If no tracks have fully completed yet, instantly show the most recently played unique tracks
        if (scored.length === 0 && events.length > 0) {
          const seen = new Set<string>();
          const recent: { title: string; artist: string }[] = [];
          for (const e of events) {
            const key = `${e.title}|${e.artist}`;
            if (!seen.has(key)) {
              seen.add(key);
              recent.push({ title: e.title, artist: e.artist });
            }
            if (recent.length >= n) break;
          }
          return recent;
        }

        return scored;
      },

      getRecentArtists: (n = 3) => {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const e of get().events) {
          const a = e.artist.split(/[,&]/)[0].trim();
          if (!seen.has(a)) {
            seen.add(a);
            result.push(a);
          }
          if (result.length >= (n ?? 3)) break;
        }
        return result;
      },

      getVibeQuerySeed: () => {
        const s = get();
        const topG = s.getTopGenres(1)[0] ?? "pop";
        const topA = s.getTopArtists(1)[0] ?? "";
        return {
          artist: topA,
          genre: topG,
        };
      },

      getStats: () => {
        const { events } = get();
        const totalListenMs = events.reduce((sum, e) => sum + e.listenMs, 0);
        const completed = events.filter((e) => e.completed).length;
        return {
          totalTracks: events.length,
          totalListenMs,
          skips: events.filter((e) => e.skipped).length,
          repeats: events.filter((e) => e.repeated).length,
          completionRate: events.length > 0 ? completed / events.length : 0,
        };
      },

      getTasteIdentity: () => {
        const s = get();
        const topG = s.getTopGenres(1)[0];
        const stats = s.getStats();

        if (!topG || stats.totalTracks < 3) return "New Explorer";

        // Pivot identity based on immediate session
        let genreBase = topG;
        const recentEvents = s.events.slice(0, 5);
        if (recentEvents.length > 0) {
          // Instantly adapt Live Identity to the very latest track played
          genreBase = recentEvents[0].genres[0] ?? topG;
        }

        const hour = new Date().getHours();
        const isLateNight = hour < 5 || hour > 21;
        const isHighSkip = stats.skips / (stats.totalTracks || 1) > 0.4;
        const isHighRepeat = stats.repeats > 2;

        if (isLateNight && genreBase === "Dark R&B") return "Late Night R&B Addict";
        if (isLateNight && genreBase === "Sad Girl Pop") return "Midnight Indie Dreamer";
        if (genreBase === "Festival EDM" && !isHighSkip) return "EDM Energy";
        if (genreBase === "Bollywood Romance") return isLateNight ? "Late Night Romance" : "Bollywood Main Character";
        if (genreBase === "Punjabi Tadka") return "Punjabi Tadka";
        if (genreBase === "Desi Trap") return "Desi Underground";
        if (genreBase === "Desi Heat") return "Bollywood Explorer";
        if (genreBase === "Atmospheric Trap") return "Trap & Rap Head";
        if (genreBase === "Global Pop") return "Pop Icon";
        if (genreBase === "K-Pop Energy") return "K-Pop Stan";
        if (genreBase === "Afro Beats") return "Afro Beats Vibe";
        if (isHighSkip) return `${genreBase} Explorer`;
        if (isHighRepeat) return `${genreBase} Addict`;

        return `${genreBase} Enthusiast`;
      },
    }),
    {
      name: "loop-listening-intelligence",
      partialize: (s) => ({
        events: s.events,
        genreWeights: s.genreWeights,
        artistWeights: s.artistWeights,
      }),
    },
  ),
);

// ── Wire to usePlayback ────────────────────────────────────────────
// Call once at app root to auto-record listening events.

let _playStartMs = 0;
let _currentId = "";

export function initListeningIntelligence() {
  import("./usePlayback").then(({ usePlayback }) => {
    import("@/functions/profile").then(({ saveProfileFn }) => {
      let prevTrack: any = undefined;
      usePlayback.subscribe((state) => {
        const track = state.currentTrack;
        if (track !== prevTrack) {
          const prev = prevTrack;
          prevTrack = track;
          const intel = useListeningIntelligence.getState();
          if (prev && _currentId === prev.id) {
            const listenMs = Date.now() - _playStartMs;
            const durationMs = prev.durationMs ?? 180_000;
            const completed = listenMs >= durationMs * 0.8;
            const skipped = listenMs < durationMs * 0.25;
            intel.recordPlay({
              trackId: prev.id,
              title: prev.title,
              artist: prev.artist,
              timestamp: _playStartMs,
              listenMs,
              completed,
              skipped,
              repeated: false,
              liked: false,
            });
            // Sync to Supabase
            saveProfileFn();
          }
          if (track) {
            _currentId = track.id;
            _playStartMs = Date.now();
            
            // Instantly inject the newly started track into the AI brain so Taste Identity
            // and Top Tracks update in absolutely real-time without waiting for it to finish.
            const intel = useListeningIntelligence.getState();
            intel.injectLiveTrack({
              trackId: track.id,
              title: track.title,
              artist: track.artist,
              timestamp: _playStartMs,
            });
          }
        }
      });
    });
  });
}
