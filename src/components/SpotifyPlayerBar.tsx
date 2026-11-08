import React, { useState } from 'react';
import { Book, AppTheme, AmbientSoundType } from '../types/library';
import { BookCover } from './BookCoverArt';
import { ambientSound } from '../services/ambientAudio';
import { Play, BookOpen, Volume2, VolumeX, CloudRain, Flame, Building2, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';

interface SpotifyPlayerBarProps {
  currentBook: Book | null;
  onOpenReader: (book: Book) => void;
  onUpdateBookProgress: (book: Book, newPage: number) => void;
  theme: AppTheme;
}

export const SpotifyPlayerBar: React.FC<SpotifyPlayerBarProps> = ({
  currentBook,
  onOpenReader,
  onUpdateBookProgress,
  theme,
}) => {
  const [ambientType, setAmbientType] = useState<AmbientSoundType>('none');
  const [volume, setVolume] = useState<number>(0.35);

  const handleToggleSound = (type: AmbientSoundType) => {
    if (ambientType === type) {
      ambientSound.stop();
      setAmbientType('none');
    } else {
      ambientSound.play(type, volume);
      setAmbientType(type);
    }
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    ambientSound.setVolume(val);
  };

  if (!currentBook) {
    return (
      <footer
        className={`h-20 px-6 border-t flex items-center justify-between text-xs select-none ${
          theme === 'spotify-dark'
            ? 'bg-[#181818] border-[#282828] text-[#A7A7A7]'
            : theme === 'nordic-light'
            ? 'bg-[#FFFFFF] border-[#E4E4E7] text-[#71717A]'
            : 'bg-[#F2ECE1] border-[#E5DECF] text-[#6B5E51]'
        }`}
      >
        <span className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 opacity-50" />
          <span>Select any PDF book to start reading</span>
        </span>
      </footer>
    );
  }

  const progressPercent = currentBook.pageCount > 0
    ? Math.round((currentBook.currentPage / currentBook.pageCount) * 100)
    : 0;

  const isDark = theme === 'spotify-dark';

  return (
    <footer
      className={`h-20 px-4 md:px-6 border-t flex items-center justify-between gap-4 select-none z-30 shrink-0 ${
        isDark
          ? 'bg-[#181818] border-[#282828] text-white'
          : theme === 'nordic-light'
          ? 'bg-white border-[#E4E4E7] text-zinc-900'
          : 'bg-[#F3EDE2] border-[#E5DECF] text-[#2B1E16]'
      }`}
    >
      {/* Left: Current Book Thumb & Info */}
      <div
        className="flex items-center gap-3 w-1/4 min-w-[180px] max-w-[260px] cursor-pointer group"
        onClick={() => onOpenReader(currentBook)}
      >
        <BookCover
          title={currentBook.title}
          author={currentBook.author}
          color={currentBook.spineColor}
          pattern={currentBook.coverPattern}
          showDetails={false}
          className="w-10 h-14 shrink-0 rounded-xs shadow-md group-hover:scale-105 transition-transform"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold truncate group-hover:underline">
            {currentBook.title}
          </p>
          <p className={`text-[11px] truncate ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
            {currentBook.author}
          </p>
        </div>
      </div>

      {/* Center: Spotify-style Page Scrubber & Controls */}
      <div className="flex-1 max-w-xl flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-4">
          <button
            onClick={() => onUpdateBookProgress(currentBook, Math.max(1, currentBook.currentPage - 1))}
            className={`p-1 rounded-full transition-colors ${
              isDark ? 'text-[#B3B3B3] hover:text-white' : 'text-zinc-600 hover:text-zinc-900'
            }`}
            title="Previous page"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            onClick={() => onOpenReader(currentBook)}
            className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm transition-transform hover:scale-105 ${
              isDark
                ? 'bg-white text-black hover:bg-[#1DB954]'
                : 'bg-zinc-900 text-white'
            }`}
            title="Open Fullscreen Reader"
            aria-label="Open Fullscreen Reader"
          >
            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
          </button>

          <button
            onClick={() => onUpdateBookProgress(currentBook, Math.min(currentBook.pageCount, currentBook.currentPage + 1))}
            className={`p-1 rounded-full transition-colors ${
              isDark ? 'text-[#B3B3B3] hover:text-white' : 'text-zinc-600 hover:text-zinc-900'
            }`}
            title="Next page"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Scrubber Bar */}
        <div className="w-full flex items-center gap-2.5 text-[11px] font-mono">
          <span className={`w-12 text-right ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
            p. {currentBook.currentPage}
          </span>
          <input
            type="range"
            min="1"
            max={currentBook.pageCount}
            value={currentBook.currentPage}
            onChange={e => onUpdateBookProgress(currentBook, Number(e.target.value))}
            className={`flex-1 h-1 rounded-lg appearance-none cursor-pointer ${
              isDark ? 'bg-[#4D4D4D] accent-white' : 'bg-zinc-300 accent-zinc-800'
            }`}
          />
          <span className={`w-16 ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
            of {currentBook.pageCount} ({progressPercent}%)
          </span>
        </div>
      </div>

      {/* Right: Ambient Sound & Fullscreen */}
      <div className="w-1/4 min-w-[160px] flex items-center justify-end gap-3 text-xs">
        <div className="hidden sm:flex items-center gap-1">
          <button
            onClick={() => handleToggleSound('rain')}
            className={`p-1.5 rounded transition-colors ${
              ambientType === 'rain'
                ? isDark ? 'text-[#1DB954] font-bold' : 'text-amber-800 font-bold'
                : isDark ? 'text-[#B3B3B3] hover:text-white' : 'text-zinc-600 hover:text-zinc-900'
            }`}
            title="Rain ambience"
            aria-label="Rain ambience"
          >
            <CloudRain className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleToggleSound('fireplace')}
            className={`p-1.5 rounded transition-colors ${
              ambientType === 'fireplace'
                ? isDark ? 'text-[#1DB954] font-bold' : 'text-amber-800 font-bold'
                : isDark ? 'text-[#B3B3B3] hover:text-white' : 'text-zinc-600 hover:text-zinc-900'
            }`}
            title="Fireplace crackle"
            aria-label="Fireplace crackle"
          >
            <Flame className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleToggleSound('library')}
            className={`p-1.5 rounded transition-colors ${
              ambientType === 'library'
                ? isDark ? 'text-[#1DB954] font-bold' : 'text-amber-800 font-bold'
                : isDark ? 'text-[#B3B3B3] hover:text-white' : 'text-zinc-600 hover:text-zinc-900'
            }`}
            title="Quiet library sanctuary"
            aria-label="Quiet library sanctuary"
          >
            <Building2 className="w-4 h-4" />
          </button>
        </div>

        {/* Volume Slider */}
        <div className="hidden md:flex items-center gap-1.5">
          {volume === 0 ? <VolumeX className="w-3.5 h-3.5 opacity-60" /> : <Volume2 className="w-3.5 h-3.5 opacity-60" />}
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={handleVolume}
            className={`w-16 h-1 rounded-lg appearance-none cursor-pointer ${
              isDark ? 'bg-[#4D4D4D] accent-white' : 'bg-zinc-300 accent-zinc-800'
            }`}
          />
        </div>

        {/* Open Reader button */}
        <button
          onClick={() => onOpenReader(currentBook)}
          className={`p-1.5 rounded transition-colors ${
            isDark ? 'text-[#B3B3B3] hover:text-white' : 'text-zinc-600 hover:text-zinc-900'
          }`}
          title="Open Reader"
          aria-label="Open Reader"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </footer>
  );
};
