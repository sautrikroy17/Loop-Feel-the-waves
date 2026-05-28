/**
 * Loop Recommendation Engine — Intelligence-powered discovery
 *
 * This server function accepts rich personalization seeds derived from
 * useListeningIntelligence and builds targeted YTM search queries.
 *
 * Section strategy:
 *  For You       → YTM "Up Next" from current track (best signal)
 *  More Like X   → Artist-seeded search
 *  [Mood] Mix    → Time-of-day + mood-based query
 *  Trending Now  → Always-fresh trending query
 *  Underground   → Genre-specific underground discovery
 *  Deep Cuts     → Same artist, rare/hidden tracks
 *  Based On You  → Top genre × top artist combination
 */

import { createServerFn } from '@tanstack/react-start';
import { searchYouTubeMusic, getRelatedTracks, searchAlbums, getAlbumDetails, getPlaylistDetails, searchPlaylist } from '../server/services/youtubeMusic';

interface PersonalizedSeed {
  // Current track context
  trackId?: string;
  title?: string;
  artist?: string;

  // Intelligence-derived signals (from useListeningIntelligence)
  topGenres?: string[];      // e.g. ['lofi', 'phonk', 'bollywood']
  topArtists?: string[];     // e.g. ['arijit singh', 'the weeknd']
  recentArtists?: string[];
  topReplayedTracks?: { title: string; artist: string; videoId?: string }[];
  genre?: string;            // single primary genre hint
  tasteIdentity?: string;
}

interface DiscoveryTrack {
  id: string;
  title: string;
  artist: string;
  albumArt: string;
  youtubeId: string;
  durationMs?: number;
  microLabel?: string;
}

interface DiscoverySection {
  id: string;
  title: string;
  tracks: DiscoveryTrack[];
  icon?: string;
  type?: 'tracks' | 'albums' | 'playlists';
}

function toTrack(t: any): DiscoveryTrack {
  return {
    id:        t.videoId ?? t.id,
    title:     t.title,
    artist:    t.artist ?? 'Unknown',
    albumArt:  t.albumArt ?? '',
    youtubeId: t.videoId ?? t.id,
    durationMs: t.durationMs,
  };
}

const GARBAGE_REGEX = /workout|karaoke|cover|tribute|compilation|80s|90s|lofi hip hop radio|sex playlist|vocal version|instrumental cover|8d audio|slowed \+ reverb|bass boosted|tiktok version|unofficial|remake|live at|acoustic cover/i;

function isPremiumTrack(t: DiscoveryTrack): boolean {
  if (GARBAGE_REGEX.test(t.title) || GARBAGE_REGEX.test(t.artist)) return false;
  return true;
}

function deduplicateTracks(tracks: DiscoveryTrack[]): DiscoveryTrack[] {
  const seenTitles = new Set<string>();
  const artistCount = new Map<string, number>();
  const unique: DiscoveryTrack[] = [];
  
  for (const t of tracks) {
    // Aggressive fuzzy title extraction: strip everything after (, [, or - 
    let coreTitle = t.title.toLowerCase().trim();
    coreTitle = coreTitle.split('(')[0].split('[')[0].split('-')[0].trim();
    
    // Allow max 2 tracks by the same artist in a single row to force diversity
    const artistKey = t.artist.toLowerCase().trim();
    const currentArtistCount = artistCount.get(artistKey) || 0;
    
    if (!seenTitles.has(coreTitle) && currentArtistCount < 2) {
      seenTitles.add(coreTitle);
      artistCount.set(artistKey, currentArtistCount + 1);
      unique.push(t);
    }
  }
  return unique;
}

function toTitleCase(str: string) {
  return str.replace(
    /\w\S*/g,
    text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
  );
}

function generateMicroLabel(genre: string, tasteIdentity: string, isBasedOn: boolean): string {
  const labels = [];
  
  if (genre.toLowerCase().includes('bollywood') || genre.toLowerCase().includes('hindi')) {
    labels.push('Shared cinematic vocals', 'Similar emotional intensity', 'Fans of Arijit love this');
  } else if (genre.toLowerCase().includes('r&b') || genre.toLowerCase().includes('dark')) {
    labels.push('Same late-night energy', 'Shared dark synth textures', 'Fans of After Hours love this', 'Cinematic electronic crossover');
  } else if (genre.toLowerCase().includes('trap') || genre.toLowerCase().includes('hip hop')) {
    labels.push('Similar heavy bassline', 'Underground club energy', 'Shared atmospheric production');
  } else if (genre.toLowerCase().includes('pop')) {
    labels.push('Main character energy', 'Similar melodic structure', 'Glossy cinematic production');
  } else {
    labels.push('Similar emotional profile', 'Shared sonic textures', 'High audience overlap');
  }

  // Pseudo-random but stable choice
  return labels[Math.floor(Math.random() * labels.length)];
}

export const getDiscoverySectionsFn = createServerFn({ method: 'GET' })
  .inputValidator((data: PersonalizedSeed) => data)
  .handler(async ({ data }): Promise<DiscoverySection[]> => {
    const {
      trackId, artist, topGenres = [], topArtists = [],
      recentArtists = [], topReplayedTracks = [], tasteIdentity = 'New Explorer'
    } = data;

    const g1 = topGenres[0] ?? 'Pop';
    const primaryArtist = artist ?? topArtists[0] ?? recentArtists[0] ?? '';

    // 1. Core Dynamic Sections (Your Obsessions / Similar)
    const t1 = topReplayedTracks[0];
    const basedOnTitle = t1 ? `Shared Sonic DNA` : `Same Emotional Frequency`;
    
    // Completely remove title-based search queries to prevent keyword matching (e.g. "Flame" matching "Moth into Flame")
    const qForYou = trackId ? '' : t1 ? `${t1.artist} radio` : `${primaryArtist} radio`;
    const qBasedOn = t1 ? `${t1.artist} mix` : `${topArtists[0] || 'Viral'} ${g1} mix`;
    
    // AI Mix Generation
    const qAIMix = `${tasteIdentity} ${primaryArtist}`;
    // Elite AI Mix Titling
    let aiMixTitle = `Your ${tasteIdentity} Mix`;
    const tiLower = tasteIdentity.toLowerCase();
    
    if (tiLower.includes('dark r&b') || tiLower.includes('after hours')) {
      const darkTitles = ['Late Night Chaos', 'Your Midnight Obsession', 'After Hours Energy'];
      aiMixTitle = darkTitles[Math.floor(Math.random() * darkTitles.length)];
    } else if (tiLower.includes('bollywood') || tiLower.includes('punjabi')) {
      const desiTitles = ['Desi Main Character', 'Your Heartbreak Era', 'Late Night Romance'];
      aiMixTitle = desiTitles[Math.floor(Math.random() * desiTitles.length)];
    } else if (tiLower.includes('pop')) {
      const popTitles = ['Your Toxic Pop Era', 'Main Character Energy', 'Neon Pop Syndrome'];
      aiMixTitle = popTitles[Math.floor(Math.random() * popTitles.length)];
    } else if (tiLower.includes('indie') || tiLower.includes('sad')) {
      const sadTitles = ['Melancholy Luxury', 'Soft Chaos', 'Floating Through Midnight'];
      aiMixTitle = sadTitles[Math.floor(Math.random() * sadTitles.length)];
    } else if (tiLower.includes('trap') || tiLower.includes('hyper')) {
      const hypeTitles = ['Hyperpop Spiral', 'Underground Pulse', 'Festival Energy'];
      aiMixTitle = hypeTitles[Math.floor(Math.random() * hypeTitles.length)];
    }
    // 2. Real Music Culture Charts & Playlists
    const CHART_POOL: Record<string, { title: string; query: string; icon: string }[]> = {
      'Bollywood Romance': [
        { title: 'Bollywood Hits', query: 'Bollywood Hits', icon: '🌊' },
        { title: 'Hindi Romance', query: 'Hindi Romance', icon: '❤️' },
        { title: 'Arijit Essentials', query: 'Arijit Singh Essentials', icon: '🎤' },
      ],
      'Desi Trap': [
        { title: 'Desi Trap & Hip Hop', query: 'Desi Trap', icon: '🔥' },
        { title: 'Punjabi Hits', query: 'Punjabi Hits', icon: '🌶️' },
      ],
      'Punjabi Heat': [
        { title: 'Punjabi Hits', query: 'Punjabi Hits', icon: '🌶️' },
        { title: 'Desi Party', query: 'Desi Party', icon: '🎉' },
      ],
      'Dark R&B': [
        { title: 'R&B Essentials', query: 'R&B Essentials', icon: '🖤' },
        { title: 'After Hours', query: 'After Hours', icon: '🌙' },
      ],
      'Sad Girl Pop': [
        { title: 'Sad Bangers', query: 'Sad Bangers', icon: '💧' },
        { title: 'Soft Chaos', query: 'Soft Chaos', icon: '🌌' },
      ],
      'Festival EDM': [
        { title: 'Club Heat', query: 'Club Heat', icon: '🪩' },
        { title: 'Party Anthems', query: 'Party Anthems', icon: '🎉' },
      ],
      'Pop': [
        { title: 'Main Character Energy', query: 'Main Character Energy', icon: '✨' },
        { title: 'Neon Nights', query: 'Neon Nights', icon: '🌃' },
      ],
      'Atmospheric Trap': [
        { title: 'Underground Pulse', query: 'Underground Pulse', icon: '⬡' },
        { title: 'Internet Obsession', query: 'Internet Obsession', icon: '📱' },
      ],
    };

    // Global fallbacks if culture not matched
    const GLOBAL_CHARTS = [
      { title: 'Top 50 Global', query: 'Top 50 Global', icon: '🌎' },
      { title: 'Trending Worldwide', query: 'Trending Worldwide', icon: '📈' },
      { title: 'Viral TikTok Songs', query: 'TikTok Viral', icon: '📱' },
      { title: 'New Music Friday', query: 'New Music Friday', icon: '🌟' },
    ];

    // Select culture-specific charts
    let selectedCharts = CHART_POOL[g1] || CHART_POOL['Pop'] || [];
    
    // Fill the rest with Global Charts
    const needed = 4 - selectedCharts.length;
    for (let i = 0; i < needed; i++) {
      if (GLOBAL_CHARTS[i]) selectedCharts.push(GLOBAL_CHARTS[i]);
    }

    // Fetch all in parallel
    const promises = [
      // AI Mix: Procedurally generated for identity
      searchYouTubeMusic(qAIMix, 20).then(t => t.map(toTrack)),
      // For You: best signal from YTM related
      trackId
        ? getRelatedTracks(trackId, 20).then(t => t.map(toTrack))
        : searchYouTubeMusic(qForYou, 20).then(t => t.map(toTrack)),
      // Based on Top Loop: TRUE Sonic Radio
      t1 && t1.videoId 
        ? getRelatedTracks(t1.videoId, 20).then(t => t.map(toTrack))
        : searchYouTubeMusic(qBasedOn, 18).then(t => t.map(toTrack)),
      // Fetch dynamic trending albums for the top artist (so we never hit "compilation" albums)
      searchAlbums(primaryArtist ? `${primaryArtist}` : `${g1} trending albums`, 10),
    ];

    // Add chart queries by fetching the OFFICIAL playlist from YouTube Music
    selectedCharts.forEach(chart => {
      promises.push(searchPlaylist(chart.query, 16).then(t => t.map(toTrack)));
    });

    const results = await Promise.allSettled(promises);

    function unwrap(index: number): DiscoveryTrack[] {
      const r = results[index];
      const raw = r?.status === 'fulfilled' ? r.value : [];
      return deduplicateTracks(raw.filter(isPremiumTrack));
    }

    function unwrapAlbums(index: number): DiscoveryTrack[] {
      const r = results[index];
      if (r?.status === 'fulfilled' && Array.isArray(r.value)) {
        const raw = r.value.map(a => ({
          id: a.id,
          youtubeId: a.id,
          title: a.title,
          artist: a.artist,
          albumArt: a.albumArt
        }));
        return deduplicateTracks(raw.filter(isPremiumTrack));
      }
      return [];
    }

    const forYouTracks = unwrap(1).map(t => ({
      ...t,
      microLabel: generateMicroLabel(g1, tasteIdentity, false)
    }));

    const basedOnTracks = unwrap(2).map(t => ({
      ...t,
      microLabel: generateMicroLabel(g1, tasteIdentity, true)
    }));

    const sections: DiscoverySection[] = [
      { id: 'ai-mix',   title: aiMixTitle,               icon: '🧠', tracks: unwrap(0), type: 'tracks' },
      { id: 'for-you',  title: 'Your Current Obsession', icon: '❤️', tracks: forYouTracks, type: 'tracks' },
      { id: 'albums',   title: 'Feel The Vibe',          icon: '💿', tracks: unwrapAlbums(3), type: 'albums' },
      { id: 'based-on', title: basedOnTitle,             icon: '🔥', tracks: basedOnTracks, type: 'tracks' },
    ];

    selectedCharts.forEach((chart, idx) => {
      sections.push({
        id: `chart-${idx}`,
        title: chart.title,
        icon: chart.icon,
        tracks: unwrap(4 + idx),
        type: 'tracks',
      });
    });

    return sections.filter(s => s.tracks && s.tracks.length > 0);
  });

export const getAlbumDetailsFn = createServerFn({ method: 'GET' })
  .inputValidator((data: any) => data)
  .handler(async ({ data }): Promise<DiscoveryTrack[]> => {
    const browseId = typeof data === 'string' ? data : data.id;
    const fallbackArtist = typeof data === 'string' ? '' : data.artist;
    const fallbackArt = typeof data === 'string' ? '' : data.albumArt;

    const tracks = await getAlbumDetails(browseId);
    return tracks.map(toTrack).map(t => ({
      ...t,
      artist: t.artist || fallbackArtist || 'Unknown Artist',
      albumArt: t.albumArt || fallbackArt || ''
    }));
  });
