import React, { useState } from 'react';
import { AppTheme, Book, Booklist } from '../types/library';
import { addBookToBooklist, removeBookFromBooklist } from '../utils/library';
import { X, Check, Search } from 'lucide-react';

interface AddBooksToListModalProps {
  isOpen: boolean;
  onClose: () => void;
  booklist: Booklist;
  allBooks: Book[];
  onUpdateBooklist: (updated: Booklist) => void;
  theme?: AppTheme;
}

export const AddBooksToListModal: React.FC<AddBooksToListModalProps> = ({
  isOpen,
  onClose,
  booklist,
  allBooks,
  onUpdateBooklist,
  theme = 'spotify-dark',
}) => {
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  const isDark = theme === 'spotify-dark';
  const isWarm = theme === 'warm-minimal';

  const modalShell = isDark
    ? 'bg-[#181818] text-white border-[#282828]'
    : isWarm
    ? 'bg-[#FAF7F0] text-[#2B1E16] border-[#E5DECF]'
    : 'bg-white text-zinc-900 border-zinc-200';

  const modalHeader = isDark
    ? 'bg-[#1F1F1F] border-[#282828]'
    : isWarm
    ? 'bg-[#F2EBDE] border-[#E5DECF]'
    : 'bg-zinc-50 border-zinc-200';

  const mutedText = isDark
    ? 'text-[#B3B3B3]'
    : isWarm
    ? 'text-[#7A6B5C]'
    : 'text-zinc-500';

  const primaryBtn = isDark
    ? 'bg-[#1DB954] text-black hover:bg-[#1ed760]'
    : isWarm
    ? 'bg-[#3D2817] text-amber-100 hover:bg-[#25170C]'
    : 'bg-zinc-900 text-white hover:bg-zinc-800';

  const handleToggleBook = (bookId: string) => {
    let updated: Booklist;
    if (booklist.bookIds.includes(bookId)) {
      updated = removeBookFromBooklist(booklist, bookId);
    } else {
      updated = addBookToBooklist(booklist, bookId);
    }
    onUpdateBooklist(updated);
  };

  const filteredBooks = allBooks.filter(b => {
    const q = search.toLowerCase();
    return b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className={`w-full max-w-md rounded-xl shadow-2xl border overflow-hidden flex flex-col max-h-[80vh] transition-colors ${modalShell}`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${modalHeader}`}>
          <div>
            <h2 className="font-serif text-lg font-bold">
              Add Books to &ldquo;{booklist.title}&rdquo;
            </h2>
            <p className={`text-xs ${mutedText}`}>
              Select which imported PDF books to include on this shelf
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div
          className={`p-4 border-b ${
            isDark
              ? 'border-[#282828] bg-[#121212]'
              : isWarm
              ? 'border-[#E5DECF] bg-[#F5EFE6]'
              : 'border-zinc-200 bg-zinc-50'
          }`}
        >
          <div className="relative">
            <Search className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${mutedText}`} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by title or author..."
              className={`w-full text-xs pl-8 pr-3 py-1.5 rounded border focus:outline-hidden ${
                isDark
                  ? 'border-[#333333] bg-[#242424] text-white'
                  : isWarm
                  ? 'border-[#D5C9B8] bg-white text-[#2B1E16]'
                  : 'border-zinc-300 bg-white text-zinc-900'
              }`}
            />
          </div>
        </div>

        {/* Book List Selection */}
        <div
          className={`p-4 overflow-y-auto divide-y flex-1 ${
            isDark ? 'divide-[#242424]' : isWarm ? 'divide-[#EAE2D4]' : 'divide-zinc-200'
          }`}
        >
          {filteredBooks.map(book => {
            const isAdded = booklist.bookIds.includes(book.id);

            return (
              <div
                key={book.id}
                onClick={() => handleToggleBook(book.id)}
                className={`py-2.5 px-2 flex items-center justify-between rounded cursor-pointer transition-colors ${
                  isDark
                    ? 'hover:bg-[#242424]'
                    : isWarm
                    ? 'hover:bg-[#F3ECE1]'
                    : 'hover:bg-zinc-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-4 h-6 rounded-xs shrink-0"
                    style={{ backgroundColor: book.spineColor }}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-serif font-bold truncate">
                      {book.title}
                    </p>
                    <p className={`text-[11px] truncate ${mutedText}`}>
                      {book.author}
                    </p>
                  </div>
                </div>

                <div
                  className={`w-5 h-5 rounded-sm border flex items-center justify-center transition-colors ${
                    isAdded
                      ? isDark
                        ? 'bg-[#1DB954] border-[#1DB954] text-black'
                        : 'bg-[#3D2817] border-[#3D2817] text-amber-100'
                      : isDark
                      ? 'border-[#444444] bg-[#242424]'
                      : 'border-zinc-300 bg-white'
                  }`}
                >
                  {isAdded && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </div>
            );
          })}

          {filteredBooks.length === 0 && (
            <div className={`py-8 text-center text-xs ${mutedText}`}>
              No books found in library.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-6 py-3 border-t flex justify-end ${modalHeader}`}>
          <button
            onClick={onClose}
            className={`px-5 py-2 text-xs font-semibold rounded shadow-sm transition-colors ${primaryBtn}`}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
