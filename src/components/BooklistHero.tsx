import React from 'react';
import { Booklist, Book, AppTheme } from '../types/library';
import { PlaylistCoverArt } from './BookCoverArt';
import { Play, Globe, Lock, Users, Plus, Heart } from 'lucide-react';

interface BooklistHeroProps {
  booklist: Booklist;
  booksInList: Book[];
  onStartReading: () => void;
  onOpenShareModal: () => void;
  onTogglePrivacy: () => void;
  onToggleSaveList: () => void;
  onOpenAddBooks: () => void;
  theme: AppTheme;
}

export const BooklistHero: React.FC<BooklistHeroProps> = ({
  booklist,
  booksInList,
  onStartReading,
  onOpenShareModal,
  onTogglePrivacy,
  onToggleSaveList,
  onOpenAddBooks,
  theme,
}) => {
  const totalPages = booksInList.reduce((acc, b) => acc + (b.pageCount || 0), 0);
  const isDark = theme === 'spotify-dark';

  return (
    <div
      className={`p-6 lg:p-8 select-none transition-colors border-b ${
        isDark
          ? 'bg-gradient-to-b from-[#242424] to-[#121212] border-[#242424] text-white'
          : theme === 'nordic-light'
          ? 'bg-gradient-to-b from-zinc-100 to-white border-zinc-200 text-zinc-900'
          : 'bg-gradient-to-b from-[#EFE8DD] to-[#F8F5EE] border-[#E5DECF] text-[#292524]'
      }`}
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-end gap-6">
        {/* Text Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider mb-2 opacity-75">
            {booklist.isPublic ? (
              <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> Public Playlist</span>
            ) : (
              <span className="flex items-center gap-1 text-amber-500"><Lock className="w-3 h-3" /> Private (Invite Only)</span>
            )}
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-serif font-bold tracking-tight mb-2 truncate">
            {booklist.title}
          </h1>

          {booklist.description && (
            <p className={`text-xs mb-3 line-clamp-2 max-w-xl ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-600'}`}>
              {booklist.description}
            </p>
          )}

          <div className="flex items-center gap-2 text-xs opacity-75">
            <span className="font-semibold">{booklist.isOwner ? 'You' : booklist.ownerName}</span>
            <span>·</span>
            <span>{booksInList.length} {booksInList.length === 1 ? 'book' : 'books'}</span>
            <span>·</span>
            <span>{totalPages} pages</span>
            {booklist.collaborators.length > 0 && (
              <>
                <span>·</span>
                <span>{booklist.collaborators.length} collaborators</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Action Row */}
      <div className="flex items-center gap-4 mt-6">
        {/* Large Spotify Play/Read Circle */}
        <button
          onClick={onStartReading}
          disabled={booksInList.length === 0}
          className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 ${
            booksInList.length > 0
              ? isDark ? 'bg-[#1DB954] text-black hover:bg-[#1ed760]' : 'bg-zinc-900 text-white hover:bg-zinc-800'
              : 'bg-zinc-500 text-zinc-300 opacity-50 cursor-not-allowed'
          }`}
          title="Start reading"
          aria-label="Start reading playlist"
        >
          <Play className="w-5 h-5 fill-current ml-0.5" />
        </button>

        {/* Add Books */}
        {booklist.isOwner && (
          <button
            onClick={onOpenAddBooks}
            className={`px-4 py-2 rounded-full text-xs font-semibold border transition-colors ${
              isDark
                ? 'border-[#727272] text-white hover:border-white'
                : 'border-zinc-300 text-zinc-800 hover:border-zinc-900'
            }`}
          >
            + Add Books
          </button>
        )}

        {/* Collaborators / Share */}
        <button
          onClick={onOpenShareModal}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border transition-colors ${
            isDark
              ? 'border-[#727272] text-white hover:border-white'
              : 'border-zinc-300 text-zinc-800 hover:border-zinc-900'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>{booklist.isPublic ? 'Share' : 'Collaborators'}</span>
          {!booklist.isPublic && (
            <span className="text-[10px] font-mono opacity-60">({booklist.inviteCode})</span>
          )}
        </button>

        {/* Privacy Switch */}
        {booklist.isOwner && (
          <button
            onClick={onTogglePrivacy}
            className={`text-xs opacity-70 hover:opacity-100 transition-opacity ml-auto ${
              isDark ? 'text-[#B3B3B3]' : 'text-zinc-600'
            }`}
          >
            {booklist.isPublic ? 'Make Private' : 'Make Public'}
          </button>
        )}
      </div>
    </div>
  );
};
