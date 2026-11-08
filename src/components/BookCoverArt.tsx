import React from 'react';
import { CoverPattern, CoverArtStyle } from '../types/library';
import { sanitizeBookTitle, sanitizeBookAuthor } from '../utils/library';

interface BookCoverProps {
  title: string;
  author?: string;
  color: string;
  pattern?: CoverPattern;
  coverImage?: string;
  className?: string;
  showDetails?: boolean;
}

export const BookCover: React.FC<BookCoverProps> = ({
  title,
  author = '',
  color,
  pattern = 'minimal',
  className = '',
  showDetails = true,
}) => {
  const cleanTitle = sanitizeBookTitle(title);
  const cleanAuthor = sanitizeBookAuthor(author);

  return (
    <div
      className={`relative rounded-sm overflow-hidden flex flex-col justify-between p-3.5 select-none transition-transform shadow-md ${className}`}
      style={{
        backgroundColor: color,
        boxShadow: 'inset 3px 0 6px rgba(0,0,0,0.3), 3px 4px 10px rgba(0,0,0,0.22)',
      }}
    >
      {/* Spine crease shadow on the left edge */}
      <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-black/40 via-black/10 to-transparent pointer-events-none" />

      {/* Subtle paper / cloth grain */}
      <div
        className="absolute inset-0 opacity-15 pointer-events-none mix-blend-overlay"
        style={{
          backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)',
          backgroundSize: '4px 4px',
        }}
      />

      {/* Decorative Editorial Book Motif (no generic star) */}
      <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
        {pattern === 'botanical' && (
          <svg className="w-24 h-24 text-amber-100" viewBox="0 0 100 100" fill="currentColor">
            <path d="M50 10 C45 30 25 45 10 50 C25 55 45 70 50 90 C55 70 75 55 90 50 C75 45 55 30 50 10 Z" />
            <circle cx="50" cy="50" r="16" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        )}
        {pattern === 'classical' && (
          <svg className="w-20 h-20 text-amber-200" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="22" y="16" width="56" height="68" rx="4" />
            <path d="M32 34 C40 30 46 30 50 34 C54 30 60 30 68 34 L68 66 C60 62 54 62 50 66 C46 62 40 62 32 66 Z" />
            <line x1="50" y1="34" x2="50" y2="66" />
          </svg>
        )}
        {pattern === 'geometric' && (
          <svg className="w-24 h-24 text-amber-100" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="20" y="20" width="60" height="60" />
            <rect x="30" y="30" width="40" height="40" strokeDasharray="4 2" />
            <line x1="20" y1="20" x2="80" y2="80" />
            <line x1="80" y1="20" x2="20" y2="80" />
          </svg>
        )}
        {pattern === 'embossed' && (
          <div className="w-24 h-32 border border-amber-200/30 flex items-center justify-center">
            <div className="w-16 h-24 border border-dashed border-amber-200/20" />
          </div>
        )}
      </div>

      {/* Gold foil border frame */}
      <div className="absolute inset-2 border border-amber-200/25 pointer-events-none rounded-[1px]" />

      {/* Book Cover Typography */}
      {showDetails && (
        <>
          <div className="relative z-10 text-center pt-3">
            {cleanAuthor && (
              <p className="text-[10px] tracking-widest text-amber-200/80 uppercase font-sans mb-1.5 truncate px-1">
                {cleanAuthor}
              </p>
            )}
            <h4 className="font-serif text-sm font-semibold text-amber-100 leading-snug line-clamp-4 px-1">
              {cleanTitle}
            </h4>
          </div>

          <div className="relative z-10 flex items-center justify-center pb-1">
            <span className="w-8 h-[1px] bg-amber-200/30" />
          </div>
        </>
      )}
    </div>
  );
};

interface PlaylistCoverArtProps {
  styleName: CoverArtStyle;
  color: string;
  title: string;
  className?: string;
}

export const PlaylistCoverArt: React.FC<PlaylistCoverArtProps> = ({
  styleName,
  color,
  title,
  className = '',
}) => {
  return (
    <div
      className={`relative overflow-hidden flex flex-col justify-between p-6 select-none shadow-xl ${className}`}
      style={{
        backgroundColor: color,
      }}
    >
      {/* Radial vignette */}
      <div className="absolute inset-0 bg-radial from-white/10 via-transparent to-black/40 pointer-events-none" />

      {/* Decorative Motif */}
      <div className="absolute inset-0 flex items-center justify-center opacity-30 pointer-events-none">
        {styleName === 'autumn' && (
          <svg className="w-32 h-32 text-amber-300" viewBox="0 0 100 100" fill="currentColor">
            <path d="M50,15 C65,30 75,55 50,85 C25,55 35,30 50,15 Z" />
            <path d="M50,15 L50,85" stroke="#000" strokeWidth="2" opacity="0.3" />
          </svg>
        )}
        {styleName === 'scholar' && (
          <svg className="w-32 h-32 text-amber-200" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20,70 L50,30 L80,70 Z" />
            <circle cx="50" cy="55" r="12" />
            <line x1="20" y1="80" x2="80" y2="80" strokeWidth="3" />
          </svg>
        )}
        {styleName === 'coffee' && (
          <svg className="w-28 h-28 text-amber-200" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M30,45 C30,65 40,75 55,75 C70,75 75,65 75,45 Z" />
            <path d="M75,50 C85,50 88,58 85,63 C82,68 75,65 75,65" />
            <path d="M42,35 C42,25 48,25 48,15" strokeDasharray="3 2" />
            <path d="M55,35 C55,25 61,25 61,15" strokeDasharray="3 2" />
          </svg>
        )}
        {styleName === 'botanical' && (
          <svg className="w-32 h-32 text-emerald-200" viewBox="0 0 100 100" fill="currentColor">
            <path d="M50,20 Q65,40 50,60 Q35,40 50,20 Z" />
            <path d="M35,45 Q50,65 35,85 Q20,65 35,45 Z" />
            <path d="M65,45 Q80,65 65,85 Q50,65 65,45 Z" />
          </svg>
        )}
        {styleName === 'night' && (
          <svg className="w-32 h-32 text-indigo-200" viewBox="0 0 100 100" fill="currentColor">
            <path d="M60,25 C45,25 35,38 35,53 C35,68 47,80 62,80 C50,78 42,66 45,52 C48,38 60,27 60,25 Z" />
            <circle cx="75" cy="30" r="2" />
            <circle cx="80" cy="50" r="1.5" />
          </svg>
        )}
      </div>

      {/* Top Header Tag */}
      <div className="relative z-10 flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase tracking-widest text-amber-200/90 font-semibold">
          Curated Booklist
        </span>
        <span className="text-xs text-amber-200/60 font-serif italic">Folio</span>
      </div>

      {/* Bottom Title Lockup */}
      <div className="relative z-10">
        <h3 className="font-serif text-2xl font-bold text-amber-100 leading-snug drop-shadow-sm">
          {title}
        </h3>
        <p className="text-xs text-amber-200/70 font-sans mt-1">
          Spotify-style Personal Library
        </p>
      </div>
    </div>
  );
};
