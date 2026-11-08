import React from 'react';
import { Book } from '../types/library';
import { BookCover } from './BookCoverArt';
import { Play } from 'lucide-react';

interface BookGridCardProps {
  book: Book;
  onOpenBook: (book: Book) => void;
  onEditBook: (book: Book) => void;
}

export const BookGridCard: React.FC<BookGridCardProps> = ({
  book,
  onOpenBook,
}) => {
  const progress = book.pageCount > 0 ? Math.round((book.currentPage / book.pageCount) * 100) : 0;

  return (
    <div
      onClick={() => onOpenBook(book)}
      className="group rounded-md p-3 transition-all cursor-pointer flex flex-col justify-between bg-black/5 hover:bg-black/10 select-none"
    >
      <div className="relative mb-2.5 flex justify-center">
        <BookCover
          title={book.title}
          author={book.author}
          color={book.spineColor}
          pattern={book.coverPattern}
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
        <h4 className="font-semibold text-xs truncate">
          {book.title}
        </h4>
        <p className="text-[11px] opacity-60 truncate mb-1.5">
          {book.author}
        </p>

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
