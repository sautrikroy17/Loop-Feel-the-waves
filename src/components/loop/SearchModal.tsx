/**
 * SearchModal
 *
 * Premium search experience:
 * - Tab bar: All · Songs · Artists
 * - Quick filter pills (phonk, slowed reverb, lofi…)
 * - Recent searches (localStorage via useUserProfile context)
 * - Keyboard: ↑↓ navigate, Enter plays, Escape closes
 * - Real-time debounced search via hybridSearchFn
 * - LikeButton on every result
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Plus, Loader2, Play, Music2, User, Clock, ArrowUpRight } from 'lucide-react';
import { usePlayback, type Track } from '@/hooks/usePlayback';
import { useUserProfile } from '@/hooks/useUserProfile';
import { omniSearchFn, getAlbumDetailsFn, getPlaylistDetailsFn } from '@/functions/search';
import { LikeButton } from './LikeButton';

type SearchTab = 'all' | 'songs' | 'albums' | 'playlists' | 'artists';

const QUICK_FILTERS = [
  'phonk', 'slowed reverb', 'lofi hip hop', 'rap 2024',
  'r&b soul', 'electronic', 'jazz nocturnal', 'indie alt',
];

// ─── Artist result (derived from song results grouped by artist) ──

interface ArtistResult {
  name: string;
  art: string;
  trackCount: number;
  sampleTrack: Track;
}

function groupArtists(tracks: Track[]): ArtistResult[] {
  const map = new Map<string, ArtistResult>();
  for (const t of tracks) {
    if (!map.has(t.artist)) {
      map.set(t.artist, { name: t.artist, art: t.albumArt, trackCount: 0, sampleTrack: t });
    }
    map.get(t.artist)!.trackCount++;
  }
  return [...map.values()].sort((a, b) => b.trackCount - a.trackCount);
}

// ─── Result row ───────────────────────────────────────────────────

function TrackRow({
  track,
  isSelected,
  onPlay,
  onQueue,
}: {
  track: Track;
  isSelected: boolean;
  onPlay: () => void;
  onQueue: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-3 rounded-xl p-2.5 transition-colors ${
        isSelected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
      }`}
    >
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-white/[0.06]">
        {track.albumArt ? (
          <img src={track.albumArt} alt="" className="h-full w-full object-cover" />
        ) : (
          <Music2 className="m-auto h-5 w-5 text-white/20" />
        )}
        <button
          onClick={onPlay}
          className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Play className="h-5 w-5 fill-white text-white" />
        </button>
      </div>

      <div className="min-w-0 flex-1 cursor-pointer" onClick={onPlay}>
        <div className="truncate text-[13px] font-medium text-white">{track.title}</div>
        <div className="truncate text-[11px] text-white/40">{track.artist}</div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <LikeButton track={track} size="sm" />
        <button
          onClick={onQueue}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/70"
          title="Add to queue"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Artist card ─────────────────────────────────────────────────

function ArtistCard({ artist, onSearch }: { artist: ArtistResult; onSearch: (q: string) => void }) {
  return (
    <button
      onClick={() => onSearch(artist.name)}
      className="group flex items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-white/[0.04]"
    >
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-white/[0.08]">
        {artist.art ? (
          <img src={artist.art} alt="" className="h-full w-full object-cover" />
        ) : (
          <User className="m-auto h-6 w-6 text-white/20" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-white">{artist.name}</div>
        <div className="text-[11px] text-white/35">{artist.trackCount} track{artist.trackCount > 1 ? 's' : ''}</div>
      </div>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-white/20 transition-colors group-hover:text-white/50" />
    </button>
  );
}

function AlbumRow({
  album,
  onPlay,
}: {
  album: any;
  onPlay: () => void;
}) {
  return (
    <div
      onClick={onPlay}
      className="group flex cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-white/[0.04]"
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-white/[0.06] shadow-md">
        {album.albumArt ? (
          <img src={album.albumArt} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
        ) : (
          <Music2 className="m-auto h-5 w-5 text-white/20" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
          <Play className="h-6 w-6 fill-white text-white" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-white">{album.title}</div>
        <div className="truncate text-[11px] text-white/40">Album • {album.artist}</div>
      </div>
    </div>
  );
}

function PlaylistRow({
  playlist,
  onPlay,
}: {
  playlist: any;
  onPlay: () => void;
}) {
  return (
    <div
      onClick={onPlay}
      className="group flex cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-white/[0.04]"
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-white/[0.06] shadow-md">
        {playlist.albumArt ? (
          <img src={playlist.albumArt} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
        ) : (
          <Music2 className="m-auto h-5 w-5 text-white/20" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
          <Play className="h-6 w-6 fill-white text-white" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-white">{playlist.title}</div>
        <div className="truncate text-[11px] text-white/40">Playlist • {playlist.artist || 'Curated'}</div>
      </div>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────

export function SearchModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState<{ tracks: Track[]; albums: any[]; playlists: any[] }>({ tracks: [], albums: [], playlists: [] });
  const [isSearching, setSearching] = useState(false);
  const [tab, setTab]               = useState<SearchTab>('all');
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('loop-recent-searches') ?? '[]'); } catch { return []; }
  });

  const { playTrack, addToQueue } = usePlayback();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 80);
      setTab('all');
      setSelectedIdx(-1);
    } else {
      setQuery('');
      setResults({ tracks: [], albums: [], playlists: [] });
    }
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  // Debounced search
  useEffect(() => {
    if (query.length < 2) { setResults({ tracks: [], albums: [], playlists: [] }); setSelectedIdx(-1); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await omniSearchFn({ data: query });
        setResults(res as { tracks: Track[]; albums: any[]; playlists: any[] });
        setSelectedIdx(-1);
      } catch { /* silent */ }
      finally { setSearching(false); }
    }, 320);
    return () => clearTimeout(t);
  }, [query]);

  // Save recent search
  const saveRecent = useCallback((q: string) => {
    const updated = [q, ...recentSearches.filter(r => r !== q)].slice(0, 8);
    setRecentSearches(updated);
    localStorage.setItem('loop-recent-searches', JSON.stringify(updated));
  }, [recentSearches]);

  const handlePlay = useCallback((track: Track) => {
    if (query) saveRecent(query);
    playTrack(track);
    onClose();
  }, [query, saveRecent, playTrack, onClose]);

  const handlePlayCollection = useCallback((items: Track[]) => {
    if (query) saveRecent(query);
    if (items.length > 0) {
      playTrack(items[0]);
      items.slice(1).forEach(t => addToQueue(t));
    }
    onClose();
  }, [query, saveRecent, playTrack, addToQueue, onClose]);

  // Keyboard navigation
  const visibleResults = results.tracks.slice(0, 12);
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => Math.min(i + 1, visibleResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => Math.max(i - 1, -1));
      } else if (e.key === 'Enter' && selectedIdx >= 0) {
        e.preventDefault();
        handlePlay(visibleResults[selectedIdx]);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen, selectedIdx, visibleResults, handlePlay]);

  const artists = groupArtists(results.tracks);
  const showRecent = query.length < 2 && recentSearches.length > 0;
  const hasResults = results.tracks.length > 0 || results.albums.length > 0 || results.playlists.length > 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-14 bg-black/80 backdrop-blur-2xl"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -10 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.08] shadow-2xl"
            style={{ background: 'oklch(0.09 0.018 268)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
              <Search className="h-5 w-5 shrink-0 text-white/28" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search songs, artists, phonk, slowed reverb..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/22"
              />
              {isSearching
                ? <Loader2 className="h-4 w-4 animate-spin text-white/25 shrink-0" />
                : query
                ? <button onClick={() => setQuery('')} className="shrink-0 text-white/28 hover:text-white/60 transition-colors"><X className="h-4 w-4" /></button>
                : <kbd className="hidden shrink-0 rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/28 sm:block">ESC</kbd>
              }
            </div>

            {/* Tabs (only when results exist) */}
            {hasResults && (
              <div className="flex gap-1 border-b border-white/[0.06] px-4 py-2">
                {(['all', 'songs', 'albums', 'playlists', 'artists'] as SearchTab[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                      tab === t
                        ? 'bg-white/[0.08] text-white'
                        : 'text-white/32 hover:text-white/70'
                    }`}
                  >
                    {t}
                    {t === 'artists' && ` (${artists.length})`}
                  </button>
                ))}
              </div>
            )}

            {/* Content */}
            <div className="max-h-[60vh] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>

              {/* Recent searches */}
              {showRecent && (
                <div className="px-4 py-3">
                  <div className="mb-3 flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.35em] text-white/22">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3 w-3" />
                      Recent
                    </div>
                    <button 
                      onClick={() => { setRecentSearches([]); localStorage.removeItem('loop-recent-searches'); }}
                      className="text-white/20 hover:text-white/60 transition-colors"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recentSearches.map(r => (
                      <button
                        key={r}
                        onClick={() => setQuery(r)}
                        className="rounded-full border border-white/[0.07] bg-white/[0.03] px-3.5 py-1.5 text-[12px] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick filters */}
              {query.length < 2 && !showRecent && (
                <div className="px-4 py-5 text-center">
                  <p className="mb-4 text-[12px] text-white/22">Start typing to search millions of songs</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {QUICK_FILTERS.map(f => (
                      <button
                        key={f}
                        onClick={() => setQuery(f)}
                        className="rounded-full border border-white/[0.07] bg-white/[0.03] px-3.5 py-1.5 text-[12px] text-white/38 transition-colors hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-white/70"
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* No results */}
              {!isSearching && !hasResults && query.length >= 2 && (
                <div className="py-12 text-center text-[13px] text-white/22">
                  No results for &ldquo;{query}&rdquo;
                </div>
              )}

              {/* All tab / Songs tab */}
              {results.tracks.length > 0 && (tab === 'all' || tab === 'songs') && (
                <div className="p-2 space-y-0.5">
                  {tab === 'all' && (
                    <p className="px-2.5 pt-1 pb-2 text-[10px] font-medium uppercase tracking-[0.35em] text-white/22">
                      Songs
                    </p>
                  )}
                  {visibleResults.map((track, i) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      isSelected={i === selectedIdx}
                      onPlay={() => handlePlay(track)}
                      onQueue={() => addToQueue(track)}
                    />
                  ))}
                </div>
              )}

              {/* Albums tab */}
              {results.albums.length > 0 && (tab === 'all' || tab === 'albums') && (
                <div className="p-2">
                  {tab === 'all' && (
                    <p className="px-2.5 pt-3 pb-2 text-[10px] font-medium uppercase tracking-[0.35em] text-white/22">
                      Albums
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
                    {(tab === 'all' ? results.albums.slice(0, 4) : results.albums).map(album => (
                      <AlbumRow
                        key={album.id}
                        album={album}
                        onPlay={async () => {
                          const tracks = await getAlbumDetailsFn({ data: album });
                          handlePlayCollection(tracks as Track[]);
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Playlists tab */}
              {results.playlists.length > 0 && (tab === 'all' || tab === 'playlists') && (
                <div className="p-2">
                  {tab === 'all' && (
                    <p className="px-2.5 pt-3 pb-2 text-[10px] font-medium uppercase tracking-[0.35em] text-white/22">
                      Playlists
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
                    {(tab === 'all' ? results.playlists.slice(0, 4) : results.playlists).map(playlist => (
                      <PlaylistRow
                        key={playlist.id}
                        playlist={playlist}
                        onPlay={async () => {
                          const tracks = await getPlaylistDetailsFn({ data: playlist });
                          handlePlayCollection(tracks as Track[]);
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Artists tab */}
              {results.tracks.length > 0 && (tab === 'all' || tab === 'artists') && artists.length > 0 && (
                <div className="p-2">
                  {tab === 'all' && (
                    <p className="px-2.5 pt-3 pb-2 text-[10px] font-medium uppercase tracking-[0.35em] text-white/22">
                      Artists
                    </p>
                  )}
                  <div className="space-y-0.5">
                    {(tab === 'all' ? artists.slice(0, 4) : artists).map(artist => (
                      <ArtistCard
                        key={artist.name}
                        artist={artist}
                        onSearch={q => { setQuery(q); setTab('songs'); }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="h-2" />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
