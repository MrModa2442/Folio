import React from 'react';
import { Book, AppTheme } from '../types/library';
import { BookCover } from './BookCoverArt';
import { Play, Trash2, Edit3, BookOpen, Plus } from 'lucide-react';
import { formatBytes, sanitizeBookTitle, sanitizeBookAuthor } from '../utils/library';

interface BookTableViewProps {
  books: Book[];
  onOpenBook: (book: Book) => void;
  onEditBook: (book: Book) => void;
  onRemoveBook?: (bookId: string) => void;
  onDeleteBook?: (bookId: string) => void;
  isListContext?: boolean;
  theme: AppTheme;
  onImportClick?: () => void;
}

export const BookTableView: React.FC<BookTableViewProps> = ({
  books,
  onOpenBook,
  onEditBook,
  onRemoveBook,
  onDeleteBook,
  isListContext = false,
  theme,
  onImportClick,
}) => {
  const isDark = theme === 'spotify-dark';

  if (books.length === 0) {
    return (
      <div className="py-20 text-center select-none">
        <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <h3 className="font-semibold text-sm mb-1">
          {isListContext ? 'This playlist is empty' : 'Your library is empty'}
        </h3>
        <p className={`text-xs mb-4 ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
          {isListContext
            ? 'Add books from your library or import new PDF files.'
            : 'Import your own PDF books to begin your reading library.'}
        </p>
        {onImportClick && (
          <button
            onClick={onImportClick}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold shadow-xs ${
              isDark ? 'bg-[#1DB954] text-black hover:bg-[#1ed760]' : 'bg-zinc-900 text-white hover:bg-zinc-800'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>Import Your First PDF</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto select-none">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr
            className={`border-b text-[11px] font-bold uppercase tracking-wider ${
              isDark ? 'border-[#242424] text-[#B3B3B3]' : 'border-zinc-200 text-zinc-500'
            }`}
          >
            <th className="py-2.5 px-3 w-10 text-center">#</th>
            <th className="py-2.5 px-3">Title</th>
            <th className="py-2.5 px-3">Progress</th>
            <th className="py-2.5 px-3 hidden sm:table-cell">File Size</th>
            <th className="py-2.5 px-3 text-right"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-transparent">
          {books.map((book, idx) => {
            const progress = book.pageCount > 0 ? Math.round((book.currentPage / book.pageCount) * 100) : 0;
            const cleanTitle = sanitizeBookTitle(book.title);
            const cleanAuthor = sanitizeBookAuthor(book.author);

            return (
              <tr
                key={book.id}
                onClick={() => onOpenBook(book)}
                className={`group cursor-pointer rounded transition-colors ${
                  isDark ? 'hover:bg-[#282828]' : 'hover:bg-zinc-100'
                }`}
              >
                {/* Index / Play */}
                <td className="py-3 px-3 text-center opacity-60 font-mono w-10">
                  <span className="group-hover:hidden tabular-nums">{idx + 1}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBook(book);
                    }}
                    className="hidden group-hover:inline-flex p-1 rounded hover:scale-110 transition-transform"
                    title="Read PDF"
                    aria-label={`Read ${cleanTitle}`}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                </td>

                {/* Title & Author with miniature cover */}
                <td className="py-3 px-3">
                  <div className="flex items-center gap-3">
                    <BookCover
                      title={cleanTitle}
                      author={cleanAuthor}
                      color={book.spineColor}
                      pattern={book.coverPattern}
                      coverImage={book.coverImage}
                      showDetails={false}
                      className="w-8 h-11 shrink-0 rounded-xs shadow-xs"
                    />
                    <div className="min-w-0">
                      <p className={`font-semibold text-xs truncate ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                        {cleanTitle}
                      </p>
                      {cleanAuthor && (
                        <p className={`text-[11px] truncate ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
                          {cleanAuthor}
                        </p>
                      )}
                    </div>
                  </div>
                </td>

                {/* Progress */}
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-20 h-1 rounded-full overflow-hidden ${isDark ? 'bg-[#333333]' : 'bg-zinc-200'}`}>
                      <div
                        className={`h-full rounded-full ${isDark ? 'bg-[#1DB954]' : 'bg-zinc-900'}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-mono tabular-nums opacity-75">
                      {progress}%
                    </span>
                  </div>
                </td>

                {/* Size */}
                <td className="py-3 px-3 hidden sm:table-cell opacity-60 font-mono text-[11px]">
                  {formatBytes(book.fileSize)}
                </td>

                {/* Actions */}
                <td className="py-3 px-3 text-right">
                  <div className="flex items-center justify-end gap-1.5 opacity-80 sm:opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditBook(book);
                      }}
                      className="p-1.5 rounded hover:bg-white/10 opacity-80 hover:opacity-100"
                      title="Edit book"
                      aria-label="Edit book"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    {isListContext && onRemoveBook && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveBook(book.id);
                        }}
                        className="p-1.5 rounded text-rose-500 hover:bg-rose-500/15 opacity-85 hover:opacity-100"
                        title="Remove from playlist"
                        aria-label="Remove from playlist"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {!isListContext && onDeleteBook && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteBook(book.id);
                        }}
                        className="p-1.5 rounded text-rose-500 hover:bg-rose-500/15 opacity-85 hover:opacity-100"
                        title="Remove from library"
                        aria-label="Remove book from library"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
