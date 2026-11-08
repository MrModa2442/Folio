import React, { useState } from 'react';
import { Booklist, AppTheme } from '../types/library';
import { searchPublicBooklists } from '../utils/library';
import { PlaylistCoverArt } from './BookCoverArt';
import { Search, Heart, Play } from 'lucide-react';

interface ExploreShelvesViewProps {
  publicBooklists: Booklist[];
  onSelectBooklist: (id: string) => void;
  onToggleSaveList: (id: string) => void;
  theme: AppTheme;
}

export const ExploreShelvesView: React.FC<ExploreShelvesViewProps> = ({
  publicBooklists,
  onSelectBooklist,
  onToggleSaveList,
  theme,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const isDark = theme === 'spotify-dark';

  const filteredLists = searchPublicBooklists(publicBooklists, searchQuery);

  return (
    <div className="flex-1 p-6 lg:p-8 max-w-6xl mx-auto overflow-y-auto select-none">
      {/* Clean Top Search Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-balance">
            Explore Public Shelves
          </h2>
          <p className={`text-xs sm:text-sm mt-1 font-medium ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
            Public playlists shared by other readers
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 opacity-50 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search playlists or topics..."
            className={`w-full text-xs pl-8 pr-3 py-2 rounded-full border focus:outline-hidden ${
              isDark
                ? 'bg-[#242424] border-[#333333] text-white placeholder-zinc-500'
                : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          />
        </div>
      </div>

      {/* Grid of Spotify Playlist Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {filteredLists.map(list => (
          <div
            key={list.id}
            onClick={() => onSelectBooklist(list.id)}
            className={`group p-3 rounded-md cursor-pointer transition-all flex flex-col justify-between ${
              isDark
                ? 'bg-[#181818] hover:bg-[#282828]'
                : 'bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/60'
            }`}
          >
            <div className="relative mb-3">
              <PlaylistCoverArt
                styleName={list.coverArtStyle}
                color={list.coverColor}
                title={list.title}
                className="w-full aspect-square rounded shadow-md group-hover:scale-[1.02] transition-transform"
              />

              {/* Play Hover Button */}
              <div className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
                <span
                  className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg ${
                    isDark ? 'bg-[#1DB954] text-black' : 'bg-zinc-900 text-white'
                  }`}
                >
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                </span>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-xs truncate mb-0.5">
                {list.title}
              </h3>
              <p className={`text-[11px] truncate mb-2 ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
                By {list.ownerName} · {list.bookIds.length} books
              </p>

              <div className="flex items-center justify-between text-[11px] pt-1">
                <span className="opacity-60">{list.savesCount} saves</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSaveList(list.id);
                  }}
                  className={`p-1 rounded ${
                    list.isSavedByUser ? 'text-rose-500' : 'opacity-40 hover:opacity-100'
                  }`}
                >
                  <Heart className={`w-3.5 h-3.5 ${list.isSavedByUser ? 'fill-current' : ''}`} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
