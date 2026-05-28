import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, X, Heart, Loader2, BookmarkPlus, Check } from 'lucide-react';
import { usePlayback, type Track } from '@/hooks/usePlayback';
import { getAlbumDetailsFn } from '@/functions/recommendations';
import { usePlaylist } from '@/hooks/usePlaylist';

interface AlbumModalProps {
  album: { id: string; title: string; artist: string; albumArt: string } | null;
  onClose: () => void;
}

export function AlbumModal({ album, onClose }: AlbumModalProps) {
  const { playTrack } = usePlayback();
  const { createPlaylist } = usePlaylist();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!album) return;
    let cancelled = false;
    setLoading(true);
    setTracks([]);
    
    getAlbumDetailsFn({ data: album })
      .then((res) => {
        if (!cancelled) setTracks(res as Track[]);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [album]);

  if (!album) return null;

  const handleInstantPlay = () => {
    if (tracks.length > 0) {
      // Play the first (or hottest) track instantly
      playTrack(tracks[0]);
    }
  };

  const handleSaveAlbum = () => {
    if (tracks.length > 0 && album) {
      createPlaylist(album.title, tracks);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl sm:flex-row"
          style={{ background: 'linear-gradient(145deg, rgba(30,30,30,0.9), rgba(15,15,15,0.95))', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.05)' }}
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white/70 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Left Side: Art & Actions */}
          <div className="relative w-full shrink-0 p-8 sm:w-[400px]">
            {/* Background blur of art */}
            <div 
              className="absolute inset-0 z-0 opacity-30 blur-[60px]"
              style={{ backgroundImage: `url(${album.albumArt})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
            />
            
            <div className="relative z-10 flex h-full flex-col">
              <img
                src={album.albumArt}
                alt={album.title}
                className="aspect-square w-full rounded-xl object-cover shadow-2xl"
              />
              
              <div className="mt-6 text-center sm:text-left">
                <h2 className="text-2xl font-bold tracking-tight text-white line-clamp-2">{album.title}</h2>
                <p className="mt-1 text-base text-white/60">{album.artist}</p>
              </div>

              <div className="mt-auto pt-8 flex gap-3">
                <button
                  onClick={handleInstantPlay}
                  disabled={loading || tracks.length === 0}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full py-3.5 font-semibold text-white transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
                  style={{ background: 'linear-gradient(135deg, oklch(0.72 0.23 290), oklch(0.65 0.21 244))' }}
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 fill-current" />}
                  Instant Play
                </button>
                <button
                  onClick={handleSaveAlbum}
                  disabled={loading || tracks.length === 0 || saved}
                  className="flex h-[52px] px-6 shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  {saved ? <Check className="h-4 w-4 text-green-400" /> : <BookmarkPlus className="h-4 w-4" />}
                  {saved ? 'Saved' : 'Save Album'}
                </button>
              </div>
            </div>
          </div>

          {/* Right Side: Tracklist */}
          <div className="flex w-full flex-col bg-black/20 pb-4">
            <div className="p-6 pb-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white/40">Tracklist</h3>
            </div>
            
            <div className="flex-1 overflow-y-auto px-2 pb-6" style={{ scrollbarWidth: 'none' }}>
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-white/30" />
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {tracks.map((track, i) => (
                    <button
                      key={track.id}
                      onClick={() => playTrack(track)}
                      className="group flex w-full items-center gap-4 rounded-lg p-3 text-left transition-colors hover:bg-white/5"
                    >
                      <span className="w-6 text-right text-sm text-white/30 group-hover:text-white/60">
                        {i + 1}
                      </span>
                      <div className="flex-1 overflow-hidden">
                        <div className="truncate text-[15px] font-medium text-white/90 group-hover:text-white">
                          {track.title}
                        </div>
                        <div className="truncate text-[13px] text-white/40">
                          {track.artist}
                        </div>
                      </div>
                      <div className="opacity-0 transition-opacity group-hover:opacity-100">
                        <Play className="h-5 w-5 text-white" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
