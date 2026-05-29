import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  X,
  Volume2,
  ListMusic,
  Check,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  Maximize2,
  Minimize2,
  GripVertical,
} from "lucide-react";
import { usePlayback, type Track } from "@/hooks/usePlayback";
import { useUserProfile } from "@/hooks/useUserProfile";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { hybridSearchFn, getRecommendationsFn } from "@/functions/search";
import { getLyricsFn, type LyricLine } from "@/functions/lyrics";

// ─── Helpers ────────────────────────────────────────────────────

function fmt(s: number): string {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ─── Search Panel ────────────────────────────────────────────────

function SearchPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const { playTrack, addToQueue } = usePlayback();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await hybridSearchFn({ data: query });
        setResults(res as Track[]);
      } catch {
        /* silent */
      } finally {
        setIsSearching(false);
      }
    }, 75);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -16 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[oklch(0.11_0.02_275)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
          <Search className="h-5 w-5 shrink-0 text-white/40" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search songs, artists, remixes, phonk..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/30"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-white/40 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {isSearching && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching...
            </div>
          )}
          {!isSearching && results.length === 0 && query.length >= 2 && (
            <div className="py-10 text-center text-sm text-white/30">No results found</div>
          )}
          {!isSearching && query.length < 2 && (
            <div className="py-10 text-center text-sm text-white/30">
              Type to search millions of songs
            </div>
          )}
          {!isSearching && results.length > 0 && (
            <div className="divide-y divide-white/5 p-2">
              {results.map((track) => (
                <div
                  key={track.id}
                  className="group flex items-center gap-3 rounded-xl p-2 hover:bg-white/5 transition-colors"
                >
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/10">
                    {track.albumArt && (
                      <img src={track.albumArt} alt="" className="h-full w-full object-cover" />
                    )}
                    <button
                      onClick={() => {
                        playTrack(track);
                        onClose();
                      }}
                      className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Play className="h-4 w-4 fill-white text-white" />
                    </button>
                  </div>
                  <div
                    className="min-w-0 flex-1"
                    onClick={() => {
                      playTrack(track);
                      onClose();
                    }}
                  >
                    <div className="truncate text-sm font-medium text-white cursor-pointer">
                      {track.title}
                    </div>
                    <div className="truncate text-xs text-white/50">{track.artist}</div>
                  </div>
                  <button
                    onClick={() => addToQueue(track)}
                    className="shrink-0 rounded-full p-1.5 text-white/30 hover:bg-white/10 hover:text-white transition-colors"
                    title="Add to queue"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Synced Lyrics ───────────────────────────────────────────────

function LyricsPanel({ track }: { track: Track | null }) {
  const progress = usePlayback((s) => s.progress);
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!track) {
      setLines([]);
      setPlainLyrics(null);
      return;
    }
    setLoading(true);
    setLines([]);
    setPlainLyrics(null);
    getLyricsFn({
      data: {
        title: track.title,
        artist: track.artist,
        duration: track.durationMs ? track.durationMs / 1000 : undefined,
      },
    })
      .then((res) => {
        setLines(res.lines);
        setPlainLyrics(res.plain ?? null);
      })
      .catch(() => {
        /* silent */
      })
      .finally(() => setLoading(false));
  }, [track?.id]);

  // Find the active lyric line index
  const activeIdx = lines.reduce((acc, line, i) => (line.time <= progress ? i : acc), -1);

  // Auto-scroll to active line
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIdx]);

  if (!track) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-white/20">
        <Mic2 className="h-10 w-10" />
        <p className="text-sm">Play a song to see lyrics</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-white/30" />
      </div>
    );
  }

  if (lines.length > 0) {
    return (
      <div
        className="h-full overflow-y-auto px-2 py-8 space-y-4 scroll-smooth"
        style={{ scrollbarWidth: "none" }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            ref={i === activeIdx ? activeRef : undefined}
            className={`text-center text-lg font-semibold leading-snug transition-all duration-300 ${
              i === activeIdx
                ? "text-white scale-105"
                : i < activeIdx
                  ? "text-white/20 scale-95"
                  : "text-white/35 scale-100"
            }`}
          >
            {line.text}
          </div>
        ))}
        <div className="h-32" />
      </div>
    );
  }

  if (plainLyrics) {
    return (
      <div
        className="h-full overflow-y-auto px-2 py-4 text-sm text-white/60 leading-relaxed whitespace-pre-line"
        style={{ scrollbarWidth: "none" }}
      >
        {plainLyrics}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-white/20">
      <Mic2 className="h-8 w-8" />
      <p className="text-sm">No lyrics found</p>
    </div>
  );
}

// ─── Recommendations Feed ────────────────────────────────────────

function RecommendationsFeed({ currentTrack }: { currentTrack: Track | null }) {
  const [recs, setRecs] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const { playTrack, addToQueue } = usePlayback();

  useEffect(() => {
    if (!currentTrack) return;
    setLoading(true);
    // Use YouTube video ID for best recommendation results
    const seedId = currentTrack.youtubeId ?? currentTrack.id;
    getRecommendationsFn({ data: seedId })
      .then((res) => setRecs((res as Track[]) ?? []))
      .catch(() => {
        /* silent */
      })
      .finally(() => setLoading(false));
  }, [currentTrack?.id]);

  if (!currentTrack)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-white/20">
        <Radio className="h-10 w-10" />
        <p className="text-sm">Play a song to get recommendations</p>
      </div>
    );

  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: "none" }}>
      <div className="pb-4 text-[10px] uppercase tracking-widest text-white/30 px-1 pt-2">
        Up Next / Recommended
      </div>
      {loading && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-white/30" />
        </div>
      )}
      {!loading && recs.length === 0 && (
        <div className="py-6 text-center text-xs text-white/30">No recommendations yet</div>
      )}
      <div className="space-y-1">
        {recs.map((track) => (
          <div
            key={track.id}
            className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5 transition-colors"
          >
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/10">
              {track.albumArt && (
                <img src={track.albumArt} alt="" className="h-full w-full object-cover" />
              )}
              <button
                onClick={() => playTrack(track)}
                className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Play className="h-3.5 w-3.5 fill-white text-white" />
              </button>
            </div>
            <div className="min-w-0 flex-1 cursor-pointer" onClick={() => playTrack(track)}>
              <div className="truncate text-xs font-medium text-white/90">{track.title}</div>
              <div className="truncate text-[11px] text-white/40">{track.artist}</div>
            </div>
            <button
              onClick={() => addToQueue(track)}
              className="shrink-0 rounded-full p-1 text-white/20 hover:text-white/70 transition-colors"
              title="Add to queue"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Queue Panel ─────────────────────────────────────────────────

function SortableQueueItemSmall({
  track,
  index,
  uniqueId,
}: {
  track: any;
  index: number;
  uniqueId: string;
}) {
  const { removeFromQueue, playTrack } = usePlayback();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: uniqueId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    zIndex: isDragging ? 999 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5 transition-colors"
    >
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab active:cursor-grabbing text-white/20 hover:text-white/55 transition-colors touch-none"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/10">
        {track.albumArt && (
          <img src={track.albumArt} alt="" className="h-full w-full object-cover" />
        )}
        <button
          onClick={() => playTrack(track)}
          className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Play className="h-3.5 w-3.5 fill-white text-white" />
        </button>
      </div>
      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => playTrack(track)}>
        <div className="truncate text-xs font-medium text-white/90">{track.title}</div>
        <div className="truncate text-[11px] text-white/40">{track.artist}</div>
      </div>
      <button
        onClick={() => removeFromQueue(index)}
        className="shrink-0 rounded-full p-1 text-white/20 hover:text-red-400/70 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function QueuePanel() {
  const { queue, reorderQueue } = usePlayback();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const sortableIds = queue.map((t, i) => `${t.id}-${i}`);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = sortableIds.indexOf(String(active.id));
    const newIdx = sortableIds.indexOf(String(over.id));
    if (oldIdx !== -1 && newIdx !== -1) reorderQueue(oldIdx, newIdx);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 pb-4 text-[10px] uppercase tracking-widest text-white/30 px-1 pt-2">
        Queue ({queue.length})
      </div>
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        {queue.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-white/20">
            <ListMusic className="h-8 w-8" />
            <p className="text-xs">Queue is empty</p>
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {queue.map((track, i) => (
                <SortableQueueItemSmall
                  key={sortableIds[i]}
                  track={track}
                  index={i}
                  uniqueId={sortableIds[i]}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

// ─── Seekbar ─────────────────────────────────────────────────────

function MusicSeekbar() {
  const { duration, seekTo } = usePlayback();
  const progress = usePlayback((s) => s.progress);
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  const displayed = isDragging ? dragValue : progress;
  const pct = duration > 0 ? (displayed / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 w-full">
      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-white/40">
        {fmt(displayed)}
      </span>
      <div className="relative flex-1 group">
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-none"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, oklch(0.75 0.22 290), oklch(0.72 0.2 240))",
            }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.5}
          value={displayed}
          onChange={(e) => {
            setIsDragging(true);
            setDragValue(Number(e.target.value));
          }}
          onMouseUp={(e) => {
            seekTo(Number((e.target as HTMLInputElement).value));
            setIsDragging(false);
          }}
          onTouchEnd={(e) => {
            seekTo(Number((e.target as HTMLInputElement).value));
            setIsDragging(false);
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          style={{ left: `calc(${pct}% - 6px)` }}
        />
      </div>
      <span className="w-9 shrink-0 text-[11px] tabular-nums text-white/40">{fmt(duration)}</span>
    </div>
  );
}

// ─── Main Player ─────────────────────────────────────────────────

type Tab = "lyrics" | "queue" | "recommended";

export function MusicPlayer() {
  const {
    currentTrack,
    isPlaying,
    volume,
    isShuffle,
    repeatMode,
    isLoadingTrack,
    togglePlayPause,
    nextTrack,
    prevTrack,
    toggleShuffle,
    toggleRepeat,
    setVolume,
  } = usePlayback();

  const [showSearch, setShowSearch] = useState(false);
  const [tab, setTab] = useState<Tab>("lyrics");

  // Keyboard shortcut for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === "Escape") setShowSearch(false);
      if (e.key === " " && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        togglePlayPause();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlayPause]);

  const REPEAT_ICON = repeatMode === "one" ? Repeat1 : Repeat;
  const repeatActive = repeatMode !== "none";

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* ── Left Panel: Album + Controls ── */}
      <div className="flex w-full max-w-[420px] shrink-0 flex-col border-r border-white/8 bg-black/20 backdrop-blur-xl">
        {/* Album Art */}
        <div className="relative flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            {currentTrack?.albumArt ? (
              <motion.img
                key={currentTrack.id}
                src={currentTrack.albumArt}
                alt={currentTrack.title}
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[oklch(0.25_0.08_290)] to-[oklch(0.12_0.04_260)]">
                <Music2 className="h-24 w-24 text-white/10" />
              </div>
            )}
          </AnimatePresence>
          {/* Gradient overlay on bottom */}
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/80 to-transparent" />

          {/* Track info overlay */}
          <div className="absolute inset-x-0 bottom-0 p-6">
            {currentTrack ? (
              <>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentTrack.id + "-title"}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="truncate text-xl font-semibold text-white"
                  >
                    {currentTrack.title}
                  </motion.div>
                </AnimatePresence>
                <div className="truncate text-sm text-white/60 mt-0.5">{currentTrack.artist}</div>
              </>
            ) : (
              <div className="text-sm text-white/30">Nothing playing — search to start</div>
            )}
          </div>

          {/* Loading indicator */}
          {isLoadingTrack && (
            <div className="absolute right-4 top-4">
              <Loader2 className="h-5 w-5 animate-spin text-white/60" />
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="shrink-0 border-t border-white/8 bg-black/30 px-6 py-5 space-y-4">
          {/* Seekbar */}
          <MusicSeekbar />

          {/* Buttons */}
          <div className="flex items-center justify-between">
            {/* Shuffle */}
            <button
              onClick={toggleShuffle}
              className={`rounded-full p-2 transition-colors ${isShuffle ? "text-[oklch(0.8_0.22_290)]" : "text-white/40 hover:text-white/80"}`}
            >
              <Shuffle className="h-4 w-4" />
            </button>

            {/* Prev */}
            <button
              onClick={prevTrack}
              className="rounded-full p-2 text-white/60 hover:text-white transition-colors"
            >
              <SkipBack className="h-5 w-5 fill-current" />
            </button>

            {/* Play / Pause */}
            <button
              onClick={togglePlayPause}
              disabled={!currentTrack || isLoadingTrack}
              className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg disabled:opacity-40 transition-transform hover:scale-105 active:scale-95"
              style={{
                background: "linear-gradient(135deg, oklch(0.75 0.22 290), oklch(0.72 0.2 240))",
                boxShadow: "0 0 40px -5px oklch(0.7 0.22 290 / 0.6)",
              }}
            >
              {isLoadingTrack ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : isPlaying ? (
                <Pause className="h-6 w-6 fill-current" />
              ) : (
                <Play className="h-6 w-6 fill-current ml-0.5" />
              )}
            </button>

            {/* Next */}
            <button
              onClick={nextTrack}
              className="rounded-full p-2 text-white/60 hover:text-white transition-colors"
            >
              <SkipForward className="h-5 w-5 fill-current" />
            </button>

            {/* Repeat */}
            <button
              onClick={toggleRepeat}
              className={`rounded-full p-2 transition-colors ${repeatActive ? "text-[oklch(0.8_0.22_290)]" : "text-white/40 hover:text-white/80"}`}
            >
              <REPEAT_ICON className="h-4 w-4" />
            </button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setVolume(volume === 0 ? 70 : 0)}
              className="text-white/40 hover:text-white/80 transition-colors"
            >
              {volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="flex-1 accent-[oklch(0.75_0.22_290)] cursor-pointer"
            />
            <span className="w-7 text-right text-[11px] tabular-nums text-white/30">{volume}</span>
          </div>
        </div>
      </div>

      {/* ── Right Panel: Lyrics / Queue / Recs ── */}
      <div className="flex flex-1 flex-col overflow-hidden bg-black/10 backdrop-blur-xl">
        {/* Tab bar */}
        <div className="flex shrink-0 items-center gap-1 border-b border-white/8 px-4 py-3">
          {/* Search trigger */}
          <button
            onClick={() => setShowSearch(true)}
            className="mr-auto flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm text-white/40 hover:bg-white/8 hover:text-white/80 transition-colors"
          >
            <Search className="h-4 w-4" />
            <span>Search anything...</span>
            <kbd className="ml-2 hidden rounded bg-white/10 px-1.5 py-0.5 text-[10px] sm:inline-block">
              ⌘K
            </kbd>
          </button>

          {(["lyrics", "queue", "recommended"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                tab === t ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              {t === "recommended" ? "For You" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-hidden px-4 py-2">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="h-full"
            >
              {tab === "lyrics" && <LyricsPanel track={currentTrack} />}
              {tab === "queue" && <QueuePanel />}
              {tab === "recommended" && <RecommendationsFeed currentTrack={currentTrack} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Search modal */}
      <AnimatePresence>
        {showSearch && <SearchPanel onClose={() => setShowSearch(false)} />}
      </AnimatePresence>
    </div>
  );
}
