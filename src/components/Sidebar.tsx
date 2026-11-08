import React from 'react';
import { BookOpen, Bookmark, CheckCircle2, Lock, Globe, Plus } from 'lucide-react';
import { Booklist, ReadingStatus, AppTheme } from '../types/library';

interface SidebarProps {
  booklists: Booklist[];
  selectedListId: string | null;
  selectedStatus: ReadingStatus | 'all';
  totalBooksCount: number;
  readingBooksCount: number;
  finishedBooksCount: number;
  onSelectList: (id: string | null) => void;
  onSelectStatus: (status: ReadingStatus | 'all') => void;
  onOpenCreateList: () => void;
  theme: AppTheme;
}

export const Sidebar: React.FC<SidebarProps> = ({
  booklists,
  selectedListId,
  selectedStatus,
  totalBooksCount,
  readingBooksCount,
  finishedBooksCount,
  onSelectList,
  onSelectStatus,
  onOpenCreateList,
  theme,
}) => {
  const isDark = theme === 'spotify-dark';

  return (
    <aside
      className={`w-60 border-r flex flex-col h-[calc(100vh-56px-80px)] select-none shrink-0 transition-colors ${
        isDark
          ? 'bg-[#121212] border-[#242424] text-white'
          : theme === 'nordic-light'
          ? 'bg-[#F9F9F9] border-[#E4E4E7] text-zinc-900'
          : 'bg-[#F5EFE6] border-[#E5DECF] text-[#292524]'
      }`}
    >
      {/* Primary Section */}
      <div className="p-3 space-y-1">
        <button
          onClick={() => {
            onSelectList(null);
            onSelectStatus('all');
          }}
          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
            selectedListId === null && selectedStatus === 'all'
              ? isDark ? 'bg-[#282828] text-white font-semibold shadow-xs' : 'bg-zinc-200/90 text-zinc-950 font-semibold'
              : isDark ? 'text-[#B3B3B3] hover:text-white hover:bg-[#1A1A1A]' : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <BookOpen className="w-4 h-4 shrink-0" />
            <span className="tracking-tight">All Books</span>
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium tabular-nums ${
              selectedListId === null && selectedStatus === 'all'
                ? isDark ? 'bg-white/10 text-white' : 'bg-zinc-300 text-zinc-900'
                : isDark ? 'bg-white/5 text-[#A0A0A0]' : 'bg-zinc-200/60 text-zinc-600'
            }`}
          >
            {totalBooksCount}
          </span>
        </button>

        <button
          onClick={() => {
            onSelectList(null);
            onSelectStatus('reading');
          }}
          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
            selectedListId === null && selectedStatus === 'reading'
              ? isDark ? 'bg-[#282828] text-white font-semibold shadow-xs' : 'bg-zinc-200/90 text-zinc-950 font-semibold'
              : isDark ? 'text-[#B3B3B3] hover:text-white hover:bg-[#1A1A1A]' : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <Bookmark className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="tracking-tight">Reading</span>
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium tabular-nums ${
              selectedListId === null && selectedStatus === 'reading'
                ? isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-800'
                : isDark ? 'bg-white/5 text-[#A0A0A0]' : 'bg-zinc-200/60 text-zinc-600'
            }`}
          >
            {readingBooksCount}
          </span>
        </button>

        <button
          onClick={() => {
            onSelectList(null);
            onSelectStatus('completed');
          }}
          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
            selectedListId === null && selectedStatus === 'completed'
              ? isDark ? 'bg-[#282828] text-white font-semibold shadow-xs' : 'bg-zinc-200/90 text-zinc-950 font-semibold'
              : isDark ? 'text-[#B3B3B3] hover:text-white hover:bg-[#1A1A1A]' : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-[#1DB954] shrink-0" />
            <span className="tracking-tight">Finished</span>
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium tabular-nums ${
              selectedListId === null && selectedStatus === 'completed'
                ? isDark ? 'bg-[#1DB954]/20 text-[#1DB954]' : 'bg-emerald-100 text-emerald-800'
                : isDark ? 'bg-white/5 text-[#A0A0A0]' : 'bg-zinc-200/60 text-zinc-600'
            }`}
          >
            {finishedBooksCount}
          </span>
        </button>
      </div>

      <div className={`mx-3 border-t my-1.5 ${isDark ? 'border-[#242424]' : 'border-zinc-200'}`} />

      {/* Playlists Header */}
      <div className="px-4 py-2 flex items-center justify-between">
        <span
          className={`text-xs font-semibold tracking-wide flex items-center gap-1.5 ${
            isDark ? 'text-[#A7A7A7]' : 'text-zinc-500'
          }`}
        >
          <span>Playlists</span>
        </span>
        <button
          onClick={onOpenCreateList}
          className={`p-1.5 rounded-lg transition-colors ${
            isDark ? 'text-[#B3B3B3] hover:text-white hover:bg-[#282828]' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200'
          }`}
          title="Create Playlist"
          aria-label="Create Playlist"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Playlist List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {booklists.map(list => {
          const isSelected = selectedListId === list.id;
          return (
            <button
              key={list.id}
              onClick={() => {
                onSelectList(list.id);
                onSelectStatus('all');
              }}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center gap-2.5 ${
                isSelected
                  ? isDark ? 'bg-[#282828] text-white font-semibold' : 'bg-zinc-200 text-zinc-900 font-semibold'
                  : isDark ? 'text-[#B3B3B3] hover:text-white hover:bg-[#1A1A1A]' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
              }`}
            >
              <div
                className="w-4 h-4 rounded-md shrink-0 shadow-xs"
                style={{ backgroundColor: list.coverColor }}
              />

              <div className="flex-1 min-w-0">
                <p className="truncate text-xs font-medium leading-tight">{list.title}</p>
                <div className="flex items-center gap-1 text-[11px] opacity-60 mt-0.5">
                  <span>{list.isPublic ? 'Public' : 'Private'}</span>
                  <span>·</span>
                  <span>{list.bookIds.length} {list.bookIds.length === 1 ? 'book' : 'books'}</span>
                </div>
              </div>

              {list.isPublic ? (
                <span title="Public Playlist"><Globe className="w-3 h-3 opacity-40 shrink-0" /></span>
              ) : (
                <span title="Private Playlist"><Lock className="w-3 h-3 text-amber-500 shrink-0" /></span>
              )}
            </button>
          );
        })}

        {booklists.length === 0 && (
          <div className="px-3 py-6 text-center text-xs opacity-40">
            No playlists yet. Click + to create one.
          </div>
        )}
      </div>
    </aside>
  );
};
