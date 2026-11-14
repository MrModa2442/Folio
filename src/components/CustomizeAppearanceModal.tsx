import React from 'react';
import { AppTheme, UiSectionPreferences, DEFAULT_UI_PREFERENCES } from '../types/library';
import {
  X,
  SlidersHorizontal,
  Moon,
  Sun,
  Coffee,
  Languages,
  Highlighter,
  ListMusic,
  BookOpen,
  Compass,
  CheckCircle2,
  Sparkles,
  PanelBottom,
  Send,
} from 'lucide-react';

interface CustomizeAppearanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: AppTheme;
  onChangeTheme: (theme: AppTheme) => void;
  preferences: UiSectionPreferences;
  onChangePreferences: (next: UiSectionPreferences) => void;
  onOpenTelegramSync?: () => void;
}

export const CustomizeAppearanceModal: React.FC<CustomizeAppearanceModalProps> = ({
  isOpen,
  onClose,
  theme,
  onChangeTheme,
  preferences,
  onChangePreferences,
  onOpenTelegramSync,
}) => {
  if (!isOpen) return null;

  const isDark = theme === 'spotify-dark';
  const isWarm = theme === 'warm-minimal';

  const modalShell = isDark
    ? 'bg-[#181818] text-white border-[#282828]'
    : isWarm
    ? 'bg-[#FAF6EE] text-[#292524] border-[#E2D9C5]'
    : 'bg-white text-zinc-900 border-zinc-200';

  const modalHeader = isDark
    ? 'bg-[#1F1F1F] border-[#282828]'
    : isWarm
    ? 'bg-[#F2EBDD] border-[#E2D9C5]'
    : 'bg-zinc-50 border-zinc-200';

  const innerCard = isDark
    ? 'bg-[#121212] border-[#282828]'
    : isWarm
    ? 'bg-[#F3EDE0] border-[#E2D9C5]'
    : 'bg-zinc-50 border-zinc-200';

  const mutedText = isDark
    ? 'text-[#B3B3B3]'
    : isWarm
    ? 'text-[#78716C]'
    : 'text-zinc-500';

  const toggleKey = (key: keyof UiSectionPreferences) => {
    onChangePreferences({
      ...preferences,
      [key]: !preferences[key],
    });
  };

  const isMinimalPreset =
    !preferences.showVocabularyHub &&
    !preferences.showNotesHub &&
    !preferences.showPlaylistsSection;

  const isFullPreset =
    preferences.showFinishedTab &&
    preferences.showNotesHub &&
    preferences.showVocabularyHub &&
    preferences.showPlaylistsSection &&
    preferences.showBookshelfTab &&
    preferences.showExploreTab &&
    preferences.showBottomPlayerBar;

  const applyMinimalistPreset = () => {
    onChangePreferences({
      ...preferences,
      showReadingTab: false,
      showFinishedTab: true,
      showNotesHub: false,
      showVocabularyHub: false,
      showPlaylistsSection: false,
      showBookshelfTab: true,
      showExploreTab: true,
      showBottomPlayerBar: true,
    });
  };

  const applyFullStudioPreset = () => {
    onChangePreferences({ ...DEFAULT_UI_PREFERENCES });
  };

  const sidebarItems: Array<{
    key: keyof UiSectionPreferences;
    label: string;
    description: string;
    icon: React.ReactNode;
  }> = [
    {
      key: 'showVocabularyHub',
      label: 'Vocabulary & Word Bank',
      description: 'Show the Saved Vocabulary & Flashcards section in the sidebar',
      icon: <Languages className="w-4 h-4 text-sky-400" />,
    },
    {
      key: 'showNotesHub',
      label: 'Notes & Highlights',
      description: 'Show the Notes, Pinned Pages & Apple Pencil Highlights hub in the sidebar',
      icon: <Highlighter className="w-4 h-4 text-yellow-400" />,
    },
    {
      key: 'showPlaylistsSection',
      label: 'Reading Playlists',
      description: 'Show custom booklists & collections in the lower sidebar',
      icon: <ListMusic className="w-4 h-4 text-emerald-400" />,
    },
    {
      key: 'showFinishedTab',
      label: 'Finished Filter',
      description: 'Quick sidebar filter for completed books',
      icon: <CheckCircle2 className="w-4 h-4 text-[#1DB954]" />,
    },
  ];

  const workspaceItems: Array<{
    key: keyof UiSectionPreferences;
    label: string;
    description: string;
    icon: React.ReactNode;
  }> = [
    {
      key: 'showBookshelfTab',
      label: '3D Bookshelf Tab',
      description: 'Show the interactive wooden Bookshelf view in the top navigation bar',
      icon: <BookOpen className="w-4 h-4 text-amber-500" />,
    },
    {
      key: 'showExploreTab',
      label: 'Explore Catalog Tab',
      description: 'Show the Explore Books catalog in the top navigation bar',
      icon: <Compass className="w-4 h-4 text-[#1DB954]" />,
    },
    {
      key: 'showBottomPlayerBar',
      label: 'Bottom Now-Reading Bar',
      description: 'Show the persistent current book & ambient sound bar at the bottom',
      icon: <PanelBottom className="w-4 h-4 text-sky-400" />,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
      <div
        className={`w-full max-w-lg rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[88vh] transition-colors ${modalShell}`}
      >
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${modalHeader}`}>
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                isDark
                  ? 'bg-[#1DB954]/15 text-[#1DB954]'
                  : isWarm
                  ? 'bg-[#3D2817]/15 text-[#3D2817]'
                  : 'bg-zinc-900/10 text-zinc-900'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">
                Customize App Design &amp; Visible Sections
              </h2>
              <p className={`text-[11px] ${mutedText}`}>
                Choose your reading environment and hide any sections you don&apos;t use
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded-lg opacity-60 hover:opacity-100 transition-all ${
              isDark ? 'hover:bg-[#282828]' : 'hover:bg-black/5'
            }`}
            aria-label="Close Appearance Settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* 1. Quick Layout Presets */}
          <div className="space-y-2">
            <label className={`block text-[11px] font-bold uppercase tracking-wider ${mutedText}`}>
              Quick Layout Mode
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={applyFullStudioPreset}
                className={`p-3 rounded-xl border text-left transition-all ${
                  isFullPreset
                    ? isDark
                      ? 'bg-[#1DB954]/15 border-[#1DB954] text-white'
                      : isWarm
                      ? 'bg-[#3D2817]/10 border-[#3D2817] text-[#292524]'
                      : 'bg-zinc-900/5 border-zinc-900 text-zinc-900'
                    : `${innerCard} opacity-80 hover:opacity-100`
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#1DB954]" />
                    <span>Full Study Studio</span>
                  </span>
                  {isFullPreset && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1DB954] text-black">
                      Active
                    </span>
                  )}
                </div>
                <p className={`text-[11px] leading-snug ${mutedText}`}>
                  Shows Vocabulary, Notes &amp; Highlights, Playlists, and all tabs.
                </p>
              </button>

              <button
                type="button"
                onClick={applyMinimalistPreset}
                className={`p-3 rounded-xl border text-left transition-all ${
                  isMinimalPreset
                    ? isDark
                      ? 'bg-[#1DB954]/15 border-[#1DB954] text-white'
                      : isWarm
                      ? 'bg-[#3D2817]/10 border-[#3D2817] text-[#292524]'
                      : 'bg-zinc-900/5 border-zinc-900 text-zinc-900'
                    : `${innerCard} opacity-80 hover:opacity-100`
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                    <span>Clean Minimalist</span>
                  </span>
                  {isMinimalPreset && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1DB954] text-black">
                      Active
                    </span>
                  )}
                </div>
                <p className={`text-[11px] leading-snug ${mutedText}`}>
                  Hides Vocabulary, Notes &amp; Highlights, and Playlists for a pure book view.
                </p>
              </button>
            </div>
          </div>

          {/* 2. Theme Environment Selector */}
          <div className="space-y-2">
            <label className={`block text-[11px] font-bold uppercase tracking-wider ${mutedText}`}>
              Color Environment
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  {
                    id: 'spotify-dark',
                    label: 'Dark Studio',
                    icon: <Moon className="w-3.5 h-3.5" />,
                  },
                  {
                    id: 'nordic-light',
                    label: 'Nordic Light',
                    icon: <Sun className="w-3.5 h-3.5" />,
                  },
                  {
                    id: 'warm-minimal',
                    label: 'Warm Coffee',
                    icon: <Coffee className="w-3.5 h-3.5" />,
                  },
                ] as const
              ).map(item => {
                const active = theme === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChangeTheme(item.id)}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      active
                        ? isDark
                          ? 'bg-[#1DB954] text-black border-[#1DB954]'
                          : isWarm
                          ? 'bg-[#3D2817] text-amber-100 border-[#3D2817]'
                          : 'bg-zinc-900 text-white border-zinc-900'
                        : `${innerCard} hover:opacity-100 opacity-80`
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Sidebar Sections Visibility */}
          <div className="space-y-2">
            <label className={`block text-[11px] font-bold uppercase tracking-wider ${mutedText}`}>
              Sidebar Sections (Toggle On / Off)
            </label>
            <div className={`rounded-xl border divide-y overflow-hidden ${innerCard} ${
              isDark ? 'divide-[#242424]' : isWarm ? 'divide-[#E2D9C5]' : 'divide-zinc-200'
            }`}>
              {sidebarItems.map(item => {
                const checked = preferences[item.key];
                return (
                  <label
                    key={item.key}
                    className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-black/5 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-black/10 flex items-center justify-center shrink-0">
                        {item.icon}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold">{item.label}</div>
                        <p className={`text-[11px] truncate ${mutedText}`}>{item.description}</p>
                      </div>
                    </div>

                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleKey(item.key)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-400/50 peer-checked:bg-[#1DB954] rounded-full relative shrink-0 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                  </label>
                );
              })}
            </div>
          </div>

          {/* 4. Top Bar & Workspace Sections */}
          <div className="space-y-2">
            <label className={`block text-[11px] font-bold uppercase tracking-wider ${mutedText}`}>
              Top Navigation &amp; Footer Bar
            </label>
            <div className={`rounded-xl border divide-y overflow-hidden ${innerCard} ${
              isDark ? 'divide-[#242424]' : isWarm ? 'divide-[#E2D9C5]' : 'divide-zinc-200'
            }`}>
              {workspaceItems.map(item => {
                const checked = preferences[item.key];
                return (
                  <label
                    key={item.key}
                    className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-black/5 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-black/10 flex items-center justify-center shrink-0">
                        {item.icon}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold">{item.label}</div>
                        <p className={`text-[11px] truncate ${mutedText}`}>{item.description}</p>
                      </div>
                    </div>

                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleKey(item.key)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-400/50 peer-checked:bg-[#1DB954] rounded-full relative shrink-0 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                  </label>
                );
              })}
            </div>
          </div>

          {/* 5. Server & Channel Sync (Admin / Vercel Setup) */}
          {onOpenTelegramSync && (
            <div className="space-y-2">
              <label className={`block text-[11px] font-bold uppercase tracking-wider ${mutedText}`}>
                Catalog Source &amp; Vercel Server Sync
              </label>
              <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${innerCard}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-[#1DB954]/15 text-[#1DB954] flex items-center justify-center shrink-0">
                    <Send className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">Telegram Channel Sync (@ocbooks)</div>
                    <p className={`text-[11px] truncate ${mutedText}`}>
                      Manage connected channels or generate a fresh session key for Vercel
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onOpenTelegramSync}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-colors ${
                    isDark
                      ? 'bg-[#282828] hover:bg-[#333333] text-white'
                      : isWarm
                      ? 'bg-[#E5DEC9] hover:bg-[#D8CEB5] text-[#292524]'
                      : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-900'
                  }`}
                >
                  Configure
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-3 border-t flex items-center justify-between ${modalHeader}`}>
          <span className={`text-[11px] ${mutedText}`}>
            Changes apply immediately &amp; are saved automatically
          </span>
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              isDark
                ? 'bg-[#1DB954] text-black hover:bg-[#1ed760]'
                : isWarm
                ? 'bg-[#3D2817] text-amber-100 hover:bg-[#2B1B0E]'
                : 'bg-zinc-900 text-white hover:bg-zinc-800'
            }`}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
