import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef, useEffect } from 'react';
import { ArrowDown } from 'lucide-react';
import { usePlayback } from '@/hooks/usePlayback';
import { subscribeToAudio } from '@/hooks/useAudioData';
import { LoopLogoCanvas } from '@/components/loop/LoopLogo';

const ease = [0.16, 1, 0.3, 1] as const;

/** Ambient radial light that pulses with bass — pure DOM mutation, no React state */
function AmbientLight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return subscribeToAudio((d) => {
      if (!ref.current) return;
      const scale = 1 + d.bass * 0.22;
      const op    = 0.30 + d.bass * 0.18;
      ref.current.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      ref.current.style.opacity   = op.toFixed(3);
    });
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 will-change-transform"
      style={{
        width: '70vmax',
        height: '70vmax',
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        background: `radial-gradient(ellipse at center,
          oklch(0.68 0.24 286 / 0.22) 0%,
          oklch(0.72 0.26 248 / 0.14) 40%,
          transparent 72%)`,
        filter: 'blur(40px)',
      }}
    />
  );
}

export function Hero({ onSearchOpen }: { onSearchOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { currentTrack, isPlaying } = usePlayback();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const y       = useTransform(scrollYProgress, [0, 1], [0, 100]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const arrowOp = useTransform(scrollYProgress, [0, 0.1], [1, 0]);

  return (
    <section
      ref={ref}
      id="top"
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pt-20"
    >
      {/* Removed Audio-reactive atmospheric waves (was causing massive lag) */}

      {/* Bass-reactive ambient light bloom */}
      <AmbientLight />

      {/* Subtle grid overlay for depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(oklch(1 0 0 / 0.025) 1px, transparent 1px),
                            linear-gradient(90deg, oklch(1 0 0 / 0.025) 1px, transparent 1px)`,
          backgroundSize: '80px 80px',
          maskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 75%)',
        }}
      />

      {/* ── Content ─────────────────────────────────────────────── */}
      <motion.div
        style={{ y, opacity }}
        className="relative z-10 mx-auto w-full max-w-5xl text-center"
      >
        {/* Logo mark — large centered, audio-reactive */}
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.4, ease }}
          className="mb-6 flex justify-center"
        >
          <LoopLogoCanvas size={64} />
        </motion.div>

        {/* Eyebrow label */}
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease }}
          className="mb-10 inline-flex items-center gap-2.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.38em] text-white/35 backdrop-blur-sm"
        >
          <span className="h-1 w-1 rounded-full bg-[oklch(0.72_0.26_248)] shadow-[0_0_6px_oklch(0.72_0.26_248)]" />
          When the right track finds you.
        </motion.p>

        {/* Main headline */}
        <h1 className="font-display font-bold leading-[0.88] tracking-[-0.03em]">
          <motion.span
            initial={{ opacity: 0, y: 70, filter: 'blur(20px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 1.1, delay: 0.04, ease }}
            className="block text-[clamp(4.5rem,12vw,10rem)] text-white"
          >
            Feel the
          </motion.span>

          <motion.span
            initial={{ opacity: 0, y: 70, filter: 'blur(20px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 1.1, delay: 0.14, ease }}
            className="block text-[clamp(4.5rem,12vw,10rem)]"
            style={{
              background: 'linear-gradient(118deg, oklch(0.88 0.16 248) 0%, oklch(0.76 0.26 270) 38%, oklch(0.68 0.24 290) 68%, oklch(0.80 0.20 210) 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
          Drop
          </motion.span>
        </h1>

        {/* Now Playing badge (Moved up to replace old text) */}
        {currentTrack && (
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.50, ease }}
            className="mx-auto mt-10 inline-flex items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.04] px-4 py-3 backdrop-blur-xl"
          >
            {currentTrack.albumArt && (
              <img
                src={currentTrack.albumArt}
                alt=""
                className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/[0.08]"
              />
            )}
            <div className="text-left">
              <div className="text-[9px] uppercase tracking-[0.3em] text-white/28">
                {isPlaying ? 'Now Playing' : 'Paused'}
              </div>
              <div className="mt-0.5 max-w-[200px] truncate text-sm font-medium text-white/80">
                {currentTrack.title}
              </div>
            </div>
            {/* Live EQ bars */}
            <LiveEQBars isPlaying={isPlaying} />
          </motion.div>
        )}

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.66, ease }}
          className="mt-12 flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
        >
          {/* Primary — electric blue */}
          <button
            onClick={onSearchOpen}
            id="hero-search-btn"
            className="group relative flex items-center gap-3 overflow-hidden rounded-full px-8 py-3.5 text-sm font-medium text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, oklch(0.72 0.26 248), oklch(0.68 0.24 286))',
              boxShadow: '0 0 50px -8px oklch(0.72 0.26 248 / 0.60)',
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-500 group-hover:translate-x-full"
            />
            <SearchIcon />
            Drop Into Music
            <kbd className="hidden rounded border border-white/20 bg-black/20 px-2 py-0.5 text-[10px] font-normal tracking-wide sm:inline-block">
              ⌘K
            </kbd>
          </button>

          {/* Ghost */}
          <a
            href="#discover"
            className="flex items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.03] px-8 py-3.5 text-sm font-medium text-white/45 transition-colors hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white/70"
          >
            What's dropping
          </a>
        </motion.div>
      </motion.div>

      {/* Scroll hint */}
      <motion.div
        style={{ opacity: arrowOp }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ArrowDown className="h-5 w-5 text-white/15" />
        </motion.div>
      </motion.div>
    </section>
  );
}

/** EQ bars that actually read from audio engine */
function LiveEQBars({ isPlaying }: { isPlaying: boolean }) {
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (!isPlaying) return;
    return subscribeToAudio((d) => {
      const heights = [
        3 + d.bass   * 11,
        3 + d.mid    * 9,
        3 + d.treble * 8,
        3 + d.bass   * 7,
      ];
      barsRef.current.forEach((el, i) => {
        if (el) el.style.height = `${heights[i].toFixed(1)}px`;
      });
    });
  }, [isPlaying]);

  return (
    <div className="flex items-end gap-[3px]" style={{ height: 16 }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          className="w-[3px] rounded-full"
          style={{
            background: 'linear-gradient(to top, oklch(0.72 0.26 248), oklch(0.80 0.18 208))',
            height: isPlaying ? '3px' : `${[8, 12, 6, 10][i]}px`,
            minHeight: 3,
            maxHeight: 14,
            opacity: isPlaying ? 1 : 0.3,
            transition: isPlaying ? 'none' : 'height 0.3s',
          }}
        />
      ))}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
