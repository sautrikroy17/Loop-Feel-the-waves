import { useEffect, useRef } from 'react';
import { usePlayback } from '@/hooks/usePlayback';
import { getPlaybackSourceFn } from '@/functions/search';
import { getLyricsFn } from '@/functions/lyrics';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export function AudioEngine() {
  const playerRef          = useRef<any>(null);
  const trackIdRef         = useRef<string | null>(null);
  const isReadyRef         = useRef(false);
  const progressRafRef     = useRef<number | null>(null);

  // KEY FIX: When true, we are mid-transition between tracks.
  // YouTube fires a PAUSED event when loadVideoById() interrupts a playing track.
  // Without this flag, that PAUSED event sets isPlaying=false, and the new track
  // never gets told to play — causing every other track to silently stall.
  const isTransitioningRef = useRef(false);

  const {
    setDuration,
    setYoutubePlayerReady,
    setLoadingTrack,
    setPlaying,
    clearSeekTarget,
    nextTrack,
  } = usePlayback.getState();

  // ── 1. Initialize YouTube IFrame API (once) ────────────────────
  useEffect(() => {
    const initPlayer = () => {
      playerRef.current = new window.YT.Player('youtube-headless-player', {
        height: '200',
        width: '200',
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            isReadyRef.current = true;
            setYoutubePlayerReady(true);
            playerRef.current.setVolume(usePlayback.getState().volume);
          },

          onStateChange: (event: any) => {
            const YTState = window.YT.PlayerState;

            if (event.data === YTState.PLAYING) {
              // Transition complete — new track is successfully playing
              isTransitioningRef.current = false;
              setLoadingTrack(false);
              setPlaying(true);
              const dur = playerRef.current?.getDuration?.() ?? 0;
              if (dur > 0) setDuration(dur);
              startProgressLoop();
            }

            if (event.data === YTState.PAUSED) {
              // CRITICAL: Suppress PAUSED events during track transitions.
              // When loadVideoById() stops the current track, YouTube fires PAUSED.
              // If we process that, isPlaying becomes false and the new track never plays.
              if (isTransitioningRef.current) return;
              setPlaying(false);
              stopProgressLoop();
            }

            if (event.data === YTState.BUFFERING) {
              setLoadingTrack(true);
            }

            if (event.data === YTState.ENDED) {
              stopProgressLoop();
              nextTrack();
            }

            if (event.data === YTState.UNSTARTED || event.data === YTState.CUED) {
              // Only force-play if the user actually intends to play.
              // DO NOT check isTransitioningRef here — that flag is only for
              // suppressing stale PAUSED events, not for forcing playback.
              // This prevents the restored track from auto-playing on page load.
              if (usePlayback.getState().isPlaying) {
                playerRef.current?.playVideo?.();
              } else if (event.data === YTState.CUED) {
                // Track successfully cued and waiting to be played.
                // End the transition and loading state.
                isTransitioningRef.current = false;
                setLoadingTrack(false);
                const dur = playerRef.current?.getDuration?.() ?? 0;
                if (dur > 0) setDuration(dur);
              }
            }
          },

          onError: (e: any) => {
            console.warn('[AudioEngine] YT error', e.data);
            isTransitioningRef.current = false;
            setLoadingTrack(false);
            stopProgressLoop();
            nextTrack();
          },
        },
      });
    };

    if (window.YT?.Player) {
      initPlayer();
    } else {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => stopProgressLoop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── RAF-based progress loop ─────────────────────────────────────
  function startProgressLoop() {
    stopProgressLoop();
    const tick = () => {
      if (playerRef.current?.getCurrentTime) {
        const t = playerRef.current.getCurrentTime();
        const d = playerRef.current.getDuration?.() ?? 0;
        usePlayback.setState({ progress: t, duration: d > 0 ? d : usePlayback.getState().duration });
      }
      progressRafRef.current = requestAnimationFrame(tick);
    };
    progressRafRef.current = requestAnimationFrame(tick);
  }

  function stopProgressLoop() {
    if (progressRafRef.current) {
      cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
    }
  }

  // ── 2. Load new track when ID changes ──────────────────────────
  const currentTrackId = usePlayback(s => s.currentTrack?.id);
  const currentTrack   = usePlayback(s => s.currentTrack);

  useEffect(() => {
    if (!isReadyRef.current || !playerRef.current?.loadVideoById) return;
    if (!currentTrack) {
      playerRef.current.stopVideo?.();
      trackIdRef.current = null;
      isTransitioningRef.current = false;
      stopProgressLoop();
      return;
    }

    if (currentTrack.id === trackIdRef.current) return;

    trackIdRef.current = currentTrack.id;
    setLoadingTrack(true);
    stopProgressLoop();

    // Begin transition — PAUSED events are suppressed until PLAYING fires
    isTransitioningRef.current = true;

    let cancelled = false;

    (async () => {
      let ytId = currentTrack.youtubeId;
      if (!ytId) {
        ytId = await getPlaybackSourceFn({
          data: { trackName: currentTrack.title, artistName: currentTrack.artist },
        }).catch(() => null);
      }

      if (cancelled) return;

      if (ytId) {
        const startSeconds = 0; // Always start from beginning per user request
        if (usePlayback.getState().isPlaying) {
          playerRef.current?.loadVideoById({ videoId: ytId, startSeconds });
        } else {
          playerRef.current?.cueVideoById({ videoId: ytId, startSeconds });
        }
        playerRef.current?.setVolume(usePlayback.getState().volume);
      } else {
        isTransitioningRef.current = false;
        setLoadingTrack(false);
        nextTrack();
      }
    })();

    // Safety net: if track never reaches PLAYING after 10s, skip
    const stuckTimeout = setTimeout(() => {
      if (usePlayback.getState().isLoadingTrack) {
        console.warn('[AudioEngine] 10s timeout — skipping stuck track');
        isTransitioningRef.current = false;
        setLoadingTrack(false);
        nextTrack();
      }
    }, 10000);

    return () => {
      cancelled = true;
      clearTimeout(stuckTimeout);
    };
  }, [currentTrackId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 3. Toggle play/pause for SAME track ───────────────────────
  const isPlaying = usePlayback(s => s.isPlaying);

  useEffect(() => {
    if (!isReadyRef.current || !playerRef.current) return;
    // Don't touch the player during transitions — it would race with loading
    if (isTransitioningRef.current) return;
    if (!currentTrackId || currentTrackId !== trackIdRef.current) return;

    if (isPlaying) {
      const state = playerRef.current.getPlayerState?.();
      const YTState = window.YT?.PlayerState;
      if (state === YTState?.CUED || state === YTState?.UNSTARTED) {
        // Force fully load and play the track if it was stuck in a cued background state
        const videoId = playerRef.current.getVideoData?.()?.video_id;
        if (videoId) {
          const startSeconds = 0;
          playerRef.current.loadVideoById?.({ videoId, startSeconds });
        } else {
          playerRef.current.playVideo?.();
        }
      } else {
        playerRef.current.playVideo?.();
      }
    } else {
      playerRef.current.pauseVideo?.();
    }
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 4. Seek ───────────────────────────────────────────────────
  const seekTarget = usePlayback(s => s.seekTarget);

  useEffect(() => {
    if (seekTarget !== null && playerRef.current?.seekTo) {
      playerRef.current.seekTo(seekTarget, true);
      usePlayback.setState({ progress: seekTarget });
      clearSeekTarget();
    }
  }, [seekTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 5. Volume sync ────────────────────────────────────────────
  const volume = usePlayback(s => s.volume);

  useEffect(() => {
    if (playerRef.current?.setVolume) playerRef.current.setVolume(volume);
  }, [volume]);

  // ── MediaSession Integration (Dynamic Island / Background) ──────
  useEffect(() => {
    if ('mediaSession' in navigator && currentTrack) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        artwork: [
          { src: currentTrack.albumArt, sizes: '512x512', type: 'image/jpeg' }
        ]
      });

      try {
        navigator.mediaSession.setActionHandler('play', () => {
          playerRef.current?.playVideo?.();
          usePlayback.getState().setPlaying(true);
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          playerRef.current?.pauseVideo?.();
          usePlayback.getState().setPlaying(false);
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => usePlayback.getState().prevTrack());
        navigator.mediaSession.setActionHandler('nexttrack', () => usePlayback.getState().nextTrack());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime && playerRef.current?.seekTo) {
            playerRef.current.seekTo(details.seekTime, true);
            usePlayback.getState().setProgress(details.seekTime);
          }
        });
        navigator.mediaSession.setActionHandler('seekbackward', () => {
          const t = Math.max((playerRef.current?.getCurrentTime() || 0) - 10, 0);
          playerRef.current?.seekTo(t, true);
        });
        navigator.mediaSession.setActionHandler('seekforward', () => {
          const t = (playerRef.current?.getCurrentTime() || 0) + 10;
          playerRef.current?.seekTo(t, true);
        });
      } catch (e) {
        console.warn('MediaSession action handlers not supported', e);
      }
    }
  }, [currentTrack]);

  // ── 6. Prefetch Lyrics ────────────────────────────────────────
  const nextTrackInQueue = usePlayback(s => s.queue[0]);

  useEffect(() => {
    if (currentTrack) {
      getLyricsFn({
        data: {
          title: currentTrack.title,
          artist: currentTrack.artist,
          duration: currentTrack.durationMs ? currentTrack.durationMs / 1000 : undefined,
        }
      }).catch(() => {});
    }
  }, [currentTrack?.id]);

  useEffect(() => {
    if (nextTrackInQueue) {
      getLyricsFn({
        data: {
          title: nextTrackInQueue.title,
          artist: nextTrackInQueue.artist,
          duration: nextTrackInQueue.durationMs ? nextTrackInQueue.durationMs / 1000 : undefined,
        }
      }).catch(() => {});
    }
  }, [nextTrackInQueue?.id]);

  return (
    <div
      id="youtube-headless-player"
      className="fixed -z-50 opacity-0 pointer-events-none -left-[2000px] -top-[2000px]"
      style={{ width: '200px', height: '200px' }}
      aria-hidden="true"
    />
  );
}
