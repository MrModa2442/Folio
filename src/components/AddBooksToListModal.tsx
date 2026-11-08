import React, { useState } from 'react';
import { Book, Booklist } from '../types/library';
import { addBookToBooklist, removeBookFromBooklist } from '../utils/library';
import { X, Check, Search, BookOpen } from 'lucide-react';

interface AddBooksToListModalProps {
  isOpen: boolean;
  onClose: () => void;
  booklist: Booklist;
  allBooks: Book[];
  onUpdateBooklist: (updated: Booklist) => void;
}

export const AddBooksToListModal: React.FC<AddBooksToListModalProps> = ({
  isOpen,
  onClose,
  booklist,
  allBooks,
  onUpdateBooklist,
}) => {
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-[#FAF7F0] w-full max-w-md rounded-xl shadow-2xl border border-[#E5DECF] overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-[#F2EBDE] border-b border-[#E5DECF] flex items-center justify-between">
          <div>
            <h2 className="font-serif text-lg font-bold text-[#2B1E16]">
              Add Books to &ldquo;{booklist.title}&rdquo;
            </h2>
            <p className="text-xs text-[#7A6B5C]">
              Select which imported PDF books to include on this shelf
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#E2D8C7] text-[#6B5E51] transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-[#E5DECF] bg-white">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#8A7968] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by title or author..."
              className="w-full text-xs pl-8 pr-3 py-1.5 rounded border border-[#D5C9B8] bg-white focus:outline-hidden"
            />
          </div>
        </div>

        {/* Book List Selection */}
        <div className="p-4 overflow-y-auto divide-y divide-[#EAE2D4] flex-1">
          {filteredBooks.map(book => {
            const isAdded = booklist.bookIds.includes(book.id);

            return (
              <div
                key={book.id}
                onClick={() => handleToggleBook(book.id)}
                className="py-2.5 px-2 flex items-center justify-between hover:bg-[#F3ECE1] rounded cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-4 h-6 rounded-xs shrink-0"
                    style={{ backgroundColor: book.spineColor }}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-serif font-bold text-[#2B1E16] truncate">
                      {book.title}
                    </p>
                    <p className="text-[11px] text-[#7A6B5C] truncate">
                      {book.author}
                    </p>
                  </div>
                </div>

                <div
                  className={`w-5 h-5 rounded-sm border flex items-center justify-center transition-colors ${
                    isAdded
                      ? 'bg-[#3D2817] border-[#3D2817] text-amber-100'
                      : 'border-[#C7BBAA] bg-white'
                  }`}
                >
                  {isAdded && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </div>
            );
          })}

          {filteredBooks.length === 0 && (
            <div className="py-8 text-center text-xs text-[#7A6B5C]">
              No books found in library.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#F2EBDE] border-t border-[#E5DECF] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-semibold text-amber-100 bg-[#3D2817] hover:bg-[#25170C] rounded shadow-sm transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
