import React, { useState } from 'react';
import { Book, BookshelfWood, AppTheme } from '../types/library';
import { BookCover } from './BookCoverArt';
import { BookOpen } from 'lucide-react';

interface VirtualBookshelfProps {
  books: Book[];
  onOpenBook: (book: Book) => void;
  onEditBook: (book: Book) => void;
  theme: AppTheme;
}

export const VirtualBookshelf: React.FC<VirtualBookshelfProps> = ({
  books,
  onOpenBook,
  onEditBook,
  theme,
}) => {
  const [wood, setWood] = useState<BookshelfWood>('walnut');
  const [displayMode, setDisplayMode] = useState<'spines' | 'covers'>('spines');
  const [hoveredBookId, setHoveredBookId] = useState<string | null>(null);

  const isDark = theme === 'spotify-dark';

  // Group books into shelves
  const booksPerShelf = displayMode === 'spines' ? 9 : 4;
  const shelves: Book[][] = [];
  for (let i = 0; i < books.length; i += booksPerShelf) {
    shelves.push(books.slice(i, i + booksPerShelf));
  }
  if (shelves.length === 0) shelves.push([]);

  const getWoodClass = (woodType: BookshelfWood) => {
    switch (woodType) {
      case 'oak': return 'shelf-wood-oak';
      case 'birch': return 'shelf-wood-birch';
      case 'mahogany': return 'shelf-wood-mahogany';
      case 'walnut':
      default: return 'shelf-wood-walnut';
    }
  };

  return (
    <div className="flex-1 p-6 max-w-5xl mx-auto overflow-y-auto select-none">
      {/* Sleek Minimal Controls */}
      <div className="flex items-center justify-between gap-4 mb-6 text-xs">
        <h2 className="text-base sm:text-lg font-serif font-bold tracking-tight">
          Bookshelf
        </h2>

        <div className="flex items-center gap-3">
          {/* Wood Selector */}
          <div className={`flex items-center gap-1 p-1 rounded-md border ${
            isDark ? 'bg-[#181818] border-[#282828]' : 'bg-zinc-100 border-zinc-200'
          }`}>
            {(['walnut', 'oak', 'birch', 'mahogany'] as BookshelfWood[]).map(w => (
              <button
                key={w}
                onClick={() => setWood(w)}
                className={`px-2 py-0.5 rounded capitalize font-medium transition-colors ${
                  wood === w
                    ? isDark ? 'bg-[#333333] text-white' : 'bg-white text-zinc-900 shadow-xs'
                    : 'opacity-60 hover:opacity-100'
                }`}
              >
                {w}
              </button>
            ))}
          </div>

          {/* Mode Switcher */}
          <div className={`flex items-center gap-1 p-1 rounded-md border ${
            isDark ? 'bg-[#181818] border-[#282828]' : 'bg-zinc-100 border-zinc-200'
          }`}>
            <button
              onClick={() => setDisplayMode('spines')}
              className={`px-2 py-0.5 rounded transition-colors ${
                displayMode === 'spines'
                  ? isDark ? 'bg-[#333333] text-white' : 'bg-white text-zinc-900 shadow-xs'
                  : 'opacity-60 hover:opacity-100'
              }`}
            >
              Spines
            </button>
            <button
              onClick={() => setDisplayMode('covers')}
              className={`px-2 py-0.5 rounded transition-colors ${
                displayMode === 'covers'
                  ? isDark ? 'bg-[#333333] text-white' : 'bg-white text-zinc-900 shadow-xs'
                  : 'opacity-60 hover:opacity-100'
              }`}
            >
              Covers
            </button>
          </div>
        </div>
      </div>

      {/* Floating Modern Cabinet */}
      <div
        className={`rounded-xl p-8 transition-colors border shadow-2xl ${
          isDark
            ? 'bg-[#181818] border-[#282828]'
            : 'bg-zinc-900 border-zinc-800 text-white'
        }`}
      >
        <div className="space-y-16">
          {shelves.map((shelfBooks, shelfIdx) => (
            <div key={shelfIdx} className="relative">
              {/* Books on the Shelf */}
              <div className="min-h-[200px] flex items-end justify-center px-4 gap-3 relative z-10">
                {shelfBooks.length === 0 ? (
                  <div className="h-32 flex items-center justify-center opacity-40 text-xs">
                    No books on this shelf yet.
                  </div>
                ) : (
                  shelfBooks.map(book => {
                    const isHovered = hoveredBookId === book.id;
                    const progressPercent = book.pageCount > 0 ? Math.round((book.currentPage / book.pageCount) * 100) : 0;

                    if (displayMode === 'covers') {
                      return (
                        <div
                          key={book.id}
                          onClick={() => onOpenBook(book)}
                          className="group relative cursor-pointer transition-transform duration-200 hover:-translate-y-2"
                        >
                          <BookCover
                            title={book.title}
                            author={book.author}
                            color={book.spineColor}
                            pattern={book.coverPattern}
                            coverImage={book.coverImage}
                            className="w-32 h-44 hover:shadow-2xl"
                          />
                        </div>
                      );
                    }

                    const spineHeight = Math.min(210, Math.max(160, 150 + (book.pageCount % 50)));
                    const spineWidth = Math.min(44, Math.max(30, 26 + Math.floor(book.pageCount / 40)));

                    return (
                      <div
                        key={book.id}
                        onMouseEnter={() => setHoveredBookId(book.id)}
                        onMouseLeave={() => setHoveredBookId(null)}
                        onClick={() => onOpenBook(book)}
                        className={`relative cursor-pointer transition-all duration-200 ${
                          isHovered ? '-translate-y-3 scale-[1.03] z-30' : 'hover:-translate-y-1'
                        }`}
                        style={{ height: `${spineHeight}px`, width: `${spineWidth}px` }}
                      >
                        {/* Spine */}
                        <div
                          className="w-full h-full rounded-xs flex flex-col justify-between py-2 px-1 relative overflow-hidden spine-leather"
                          style={{
                            backgroundColor: book.spineColor,
                            boxShadow: isHovered
                              ? '0 12px 24px rgba(0,0,0,0.7), inset 1px 0 2px rgba(255,255,255,0.2)'
                              : '0 4px 8px rgba(0,0,0,0.5)',
                          }}
                        >
                          <div className="w-full h-[1px] bg-amber-300/30" />

                          <div
                            className="flex-1 flex items-center justify-center overflow-hidden my-1"
                            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                          >
                            <span className="text-[10px] font-semibold text-amber-100 whitespace-nowrap truncate max-h-[130px]">
                              {book.title}
                            </span>
                          </div>

                          <div className="w-full h-[1px] bg-amber-300/30" />

                          {/* Ribbon bookmark */}
                          {book.status === 'reading' && (
                            <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-1.5 h-3 bg-red-600 rounded-xs shadow-xs" />
                          )}
                        </div>

                        {/* Hover Quick Card */}
                        {isHovered && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-black/90 text-white p-2.5 rounded shadow-2xl border border-white/10 z-40 text-left text-xs">
                            <p className="font-bold truncate text-white mb-0.5">{book.title}</p>
                            <p className="opacity-70 text-[11px] truncate mb-2">{book.author}</p>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenBook(book);
                              }}
                              className="w-full py-1 text-center bg-white text-black font-semibold rounded text-[11px] hover:bg-zinc-200"
                            >
                              Read PDF ({progressPercent}%)
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Wooden Shelf Plank */}
              <div className={`w-full h-6 rounded-sm ${getWoodClass(wood)} relative`}>
                <div className="absolute top-0 inset-x-0 h-[1px] bg-white/20" />
                <div className="absolute -bottom-2 inset-x-2 h-2 bg-black/60 blur-xs rounded-full pointer-events-none" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
