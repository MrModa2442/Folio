import React from 'react';
import { Book } from '../types/library';
import { BookCover } from './BookCoverArt';
import { sanitizeBookTitle, sanitizeBookAuthor } from '../utils/library';
import { Play, Trash2, Edit3 } from 'lucide-react';

interface BookGridCardProps {
  book: Book;
  onOpenBook: (book: Book) => void;
  onEditBook: (book: Book) => void;
  onDeleteBook?: (bookId: string) => void;
}

export const BookGridCard: React.FC<BookGridCardProps> = ({
  book,
  onOpenBook,
  onEditBook,
  onDeleteBook,
}) => {
  const progress = book.pageCount > 0 ? Math.round((book.currentPage / book.pageCount) * 100) : 0;
  const cleanTitle = sanitizeBookTitle(book.title);
  const cleanAuthor = sanitizeBookAuthor(book.author);

  return (
    <div
      onClick={() => onOpenBook(book)}
      className="group rounded-md p-3 transition-all cursor-pointer flex flex-col justify-between bg-black/5 hover:bg-black/10 select-none"
    >
      <div className="relative mb-2.5 flex justify-center">
        <BookCover
          title={cleanTitle}
          author={cleanAuthor}
          color={book.spineColor}
          pattern={book.coverPattern}
          coverImage={book.coverImage}
          className="w-full aspect-[3/4] max-h-52 rounded shadow-md group-hover:scale-[1.02] transition-transform"
        />

        {/* Hover play button overlay */}
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded">
          <span className="w-10 h-10 rounded-full bg-[#1DB954] text-black flex items-center justify-center shadow-lg">
            <Play className="w-4 h-4 fill-current ml-0.5" />
          </span>
        </div>
      </div>

      <div>
        <div className="flex items-start justify-between gap-1 mb-1.5">
          <div className="min-w-0 flex-1">
            <h4 className="font-semibold text-xs truncate">
              {cleanTitle}
            </h4>
            {cleanAuthor && (
              <p className="text-[11px] opacity-60 truncate">
                {cleanAuthor}
              </p>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onEditBook(book);
              }}
              className="p-1 rounded opacity-60 hover:opacity-100 hover:bg-white/10 transition-opacity"
              title="Edit book"
              aria-label="Edit book"
            >
              <Edit3 className="w-3 h-3" />
            </button>
            {onDeleteBook && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onDeleteBook(book.id);
                }}
                className="p-1 rounded text-rose-500 opacity-70 hover:opacity-100 hover:bg-rose-500/15 transition-opacity"
                title="Remove from library"
                aria-label="Remove book from library"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-white/20 rounded-full h-1 overflow-hidden">
          <div
            className="bg-[#1DB954] h-full rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
};
