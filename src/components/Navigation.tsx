import React from 'react';
import { AppTheme, Book, Booklist, UiSectionPreferences, DEFAULT_UI_PREFERENCES } from '../types/library';
import { PWAInstallButton } from './PWAInstallButton';
import { Plus, Moon, Sun, Coffee } from 'lucide-react';

interface NavigationProps {
  currentTab: 'library' | 'explore' | 'bookshelf' | 'notes' | 'vocabulary';
  onSelectTab: (tab: 'library' | 'explore' | 'bookshelf' | 'notes' | 'vocabulary') => void;
  onOpenImport: () => void;
  onOpenTelegramSync?: () => void;
  telegramAutoSync?: boolean;
  telegramChannel?: string;
  books: Book[];
  booklists: Booklist[];
  onRestoreLibrary: (books: Book[], booklists: Booklist[]) => void;
  theme: AppTheme;
  onChangeTheme: (theme: AppTheme) => void;
  uiPreferences?: UiSectionPreferences;
}

export const Navigation: React.FC<NavigationProps> = ({
  currentTab,
  onSelectTab,
  onOpenImport,
  books,
  booklists,
  onRestoreLibrary,
  theme,
  onChangeTheme,
  uiPreferences = DEFAULT_UI_PREFERENCES,
}) => {
  const isDark = theme === 'spotify-dark';

  return (
    <header
      className={`min-h-14 px-3 sm:px-5 py-2 border-b flex flex-wrap items-center justify-between gap-2 sm:gap-4 shrink-0 z-40 transition-colors ${
        isDark
          ? 'bg-[#121212] border-[#242424] text-white'
          : theme === 'nordic-light'
          ? 'bg-white border-[#E4E4E7] text-zinc-900'
          : 'bg-[#F7F5F0] border-[#E5DECF] text-[#292524]'
      }`}
    >
      {/* Zone 1: Brand title wordmark */}
      <button
        onClick={() => onSelectTab('library')}
        className="font-brand text-xl font-bold tracking-tight flex items-center gap-2 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
      >
        <span
          className={`w-6 h-6 rounded-lg flex items-center justify-center font-brand font-bold text-xs shadow-xs ${
            isDark ? 'bg-[#1DB954] text-black' : 'bg-zinc-900 text-white'
          }`}
        >
          F
        </span>
        <span className="font-brand font-bold text-xl tracking-tight">Folio</span>
      </button>

      {/* Zone 2: Clean nav tabs */}
      <nav className="flex items-center gap-5 text-xs font-medium">
        <button
          onClick={() => onSelectTab('library')}
          className={`whitespace-nowrap transition-colors pb-1 ${
            currentTab === 'library'
              ? isDark ? 'text-white font-semibold border-b-2 border-[#1DB954]' : 'text-zinc-900 font-semibold border-b-2 border-zinc-900'
              : isDark ? 'text-[#B3B3B3] hover:text-white' : 'text-zinc-500 hover:text-zinc-900'
          }`}
        >
          Library
        </button>

        {uiPreferences.showBookshelfTab && (
          <button
            onClick={() => onSelectTab('bookshelf')}
            className={`whitespace-nowrap transition-colors pb-1 ${
              currentTab === 'bookshelf'
                ? isDark ? 'text-white font-semibold border-b-2 border-[#1DB954]' : 'text-zinc-900 font-semibold border-b-2 border-zinc-900'
                : isDark ? 'text-[#B3B3B3] hover:text-white' : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            Bookshelf
          </button>
        )}

        {uiPreferences.showExploreTab && (
          <button
            onClick={() => onSelectTab('explore')}
            className={`whitespace-nowrap transition-colors pb-1 ${
              currentTab === 'explore'
                ? isDark ? 'text-white font-semibold border-b-2 border-[#1DB954]' : 'text-zinc-900 font-semibold border-b-2 border-zinc-900'
                : isDark ? 'text-[#B3B3B3] hover:text-white' : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            Explore
          </button>
        )}
      </nav>

      {/* Zone 3: Theme Switcher, Offline iPad App & Import PDF */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Minimal Theme Switcher */}
        <div
          className={`flex items-center p-0.5 rounded-full border text-xs ${
            isDark ? 'bg-[#242424] border-[#333333]' : 'bg-zinc-100 border-zinc-200'
          }`}
        >
          <button
            onClick={() => onChangeTheme('spotify-dark')}
            className={`p-1.5 rounded-full transition-colors ${
              theme === 'spotify-dark'
                ? 'bg-[#121212] text-white shadow-xs'
                : 'text-zinc-400 hover:text-white'
            }`}
            title="Spotify Dark Theme"
            aria-label="Spotify Dark Theme"
          >
            <Moon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onChangeTheme('nordic-light')}
            className={`p-1.5 rounded-full transition-colors ${
              theme === 'nordic-light'
                ? 'bg-white text-zinc-900 shadow-xs'
                : isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Nordic Minimal Light Theme"
            aria-label="Nordic Minimal Light Theme"
          >
            <Sun className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onChangeTheme('warm-minimal')}
            className={`p-1.5 rounded-full transition-colors ${
              theme === 'warm-minimal'
                ? 'bg-[#F2ECE1] text-[#292524] shadow-xs'
                : isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Warm Paper Theme"
            aria-label="Warm Paper Theme"
          >
            <Coffee className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Mandatory In-App Offline / iPad PWA Install & Vault Button */}
        <PWAInstallButton
          books={books}
          booklists={booklists}
          onRestoreLibrary={onRestoreLibrary}
          theme={theme}
        />

        {/* Primary CTA */}
        <button
          onClick={onOpenImport}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all shadow-xs ${
            isDark
              ? 'bg-[#1DB954] text-black hover:bg-[#1ed760]'
              : 'bg-zinc-900 text-white hover:bg-zinc-800'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Import PDF</span>
        </button>
      </div>
    </header>
  );
};


