import React, { useState, useRef } from 'react';
import { AppTheme, Book, Booklist, CoverPattern } from '../types/library';
import { extractPdfMetadata } from '../utils/pdfParser';
import { storePdfBlob, storeBookCover } from '../services/db';
import { X, Upload, Loader2, Trash2 } from 'lucide-react';

interface ImportPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBookImported: (book: Book, targetListId?: string) => void;
  onDeleteBook?: (bookId: string) => void;
  booklists: Booklist[];
  editingBook?: Book | null;
  theme?: AppTheme;
}

const PALETTE = [
  '#1E293B', // Slate
  '#27272A', // Charcoal
  '#3D2817', // Umber
  '#14532D', // Spruce
  '#581C1A', // Wine
  '#1E1B4B', // Indigo
];

export const ImportPdfModal: React.FC<ImportPdfModalProps> = ({
  isOpen,
  onClose,
  onBookImported,
  onDeleteBook,
  editingBook,
  theme = 'spotify-dark',
}) => {
  const isDark = theme === 'spotify-dark';
  const isWarm = theme === 'warm-minimal';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Editing state for existing book
  const [editTitle, setEditTitle] = useState(editingBook?.title || '');
  const [editAuthor, setEditAuthor] = useState(editingBook?.author || '');

  React.useEffect(() => {
    if (editingBook) {
      setEditTitle(editingBook.title);
      setEditAuthor(editingBook.author);
    } else {
      setEditTitle('');
      setEditAuthor('');
      setIsProcessing(false);
      setStatusMessage('');
    }
  }, [editingBook, isOpen]);

  if (!isOpen) return null;

  // Fully automatic import: extracts pages, author, title, and cover image
  const handleProcessPdfFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return;
    }

    setIsProcessing(true);
    setStatusMessage('Parsing PDF structure with PDF.js...');

    try {
      const metadata = await extractPdfMetadata(file);
      setStatusMessage(
        `Extracted: "${metadata.title}" (${metadata.pageCount} pages)`
      );

      const bookId = 'book_' + Date.now().toString(36);

      await storePdfBlob(bookId, file);
      if (metadata.coverImage) {
        await storeBookCover(bookId, metadata.coverImage);
      }

      const colorIndex = Math.abs(
        metadata.title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
      ) % PALETTE.length;
      const spineColor = PALETTE[colorIndex];

      const patterns: CoverPattern[] = ['botanical', 'geometric', 'embossed', 'classical'];
      const coverPattern = patterns[colorIndex % patterns.length];

      const newBook: Book = {
        id: bookId,
        title: metadata.title,
        author: metadata.author,
        fileName: file.name,
        fileSize: file.size,
        pageCount: metadata.pageCount,
        currentPage: 1,
        status: 'to-read',
        spineColor,
        spineTexture: 'leather',
        coverPattern,
        coverImage: metadata.coverImage,
        dateAdded: new Date().toISOString().split('T')[0],
        lastRead: null,
        pdfBlobKey: bookId,
      };

      setTimeout(() => {
        onBookImported(newBook);
        setIsProcessing(false);
        onClose();
      }, 400);
    } catch (err) {
      console.error('Failed to import PDF automatically:', err);
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleProcessPdfFile(e.dataTransfer.files[0]);
    }
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBook || !editTitle.trim()) return;

    onBookImported({
      ...editingBook,
      title: editTitle.trim(),
      author: editAuthor.trim(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
      <div
        className={`w-full max-w-md rounded-xl shadow-2xl border overflow-hidden flex flex-col transition-colors ${
          isDark
            ? 'bg-[#181818] text-white border-[#282828]'
            : isWarm
            ? 'bg-[#FAF6EE] text-[#292524] border-[#E2D9C5]'
            : 'bg-white text-zinc-900 border-zinc-200'
        }`}
      >
        {/* Header */}
        <div
          className={`px-5 py-3.5 border-b flex items-center justify-between ${
            isDark
              ? 'bg-[#1F1F1F] border-[#282828]'
              : isWarm
              ? 'bg-[#F2EBDD] border-[#E2D9C5]'
              : 'bg-zinc-50 border-zinc-200'
          }`}
        >
          <h2 className="text-sm font-bold tracking-tight">
            {editingBook ? 'Edit Book Info' : 'Import PDF Book'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {editingBook ? (
            /* Editing form for existing book only */
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className={`w-full text-xs px-3 py-2 rounded border focus:outline-hidden ${
                    isDark
                      ? 'bg-[#242424] border-[#333333] text-white focus:border-white'
                      : isWarm
                      ? 'bg-white border-[#D5C9B8] text-[#292524] focus:border-[#3D2817]'
                      : 'bg-white border-zinc-300 text-zinc-900 focus:border-zinc-900'
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">
                  Writer
                </label>
                <input
                  type="text"
                  value={editAuthor}
                  onChange={e => setEditAuthor(e.target.value)}
                  className={`w-full text-xs px-3 py-2 rounded border focus:outline-hidden ${
                    isDark
                      ? 'bg-[#242424] border-[#333333] text-white focus:border-white'
                      : isWarm
                      ? 'bg-white border-[#D5C9B8] text-[#292524] focus:border-[#3D2817]'
                      : 'bg-white border-zinc-300 text-zinc-900 focus:border-zinc-900'
                  }`}
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                {onDeleteBook ? (
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteBook(editingBook.id);
                      onClose();
                    }}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-500 hover:bg-rose-500/25 flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove from Library</span>
                  </button>
                ) : <div />}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3.5 py-1.5 text-xs opacity-70 hover:opacity-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`px-4 py-1.5 text-xs font-semibold rounded-full ${
                      isDark
                        ? 'bg-[#1DB954] text-black'
                        : isWarm
                        ? 'bg-[#3D2817] text-amber-100'
                        : 'bg-zinc-900 text-white'
                    }`}
                  >
                    Save
                  </button>
                </div>
              </div>
            </form>
          ) : (
            /* Automatic 1-click Drop / Pick zone: Zero questions asked! */
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={e => e.target.files?.[0] && handleProcessPdfFile(e.target.files[0])}
              />

              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => !isProcessing && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
                  isProcessing
                    ? 'border-[#1DB954] bg-[#1DB954]/5 cursor-wait'
                    : isDragging
                    ? 'border-[#1DB954] bg-[#1DB954]/10'
                    : isDark
                    ? 'border-[#333333] hover:border-[#555555] bg-[#121212]'
                    : isWarm
                    ? 'border-[#D5C9B8] hover:border-[#3D2817] bg-[#F3EDE0]'
                    : 'border-zinc-300 hover:border-zinc-500 bg-zinc-50'
                }`}
              >
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                    isProcessing
                      ? 'bg-[#1DB954]/20 text-[#1DB954]'
                      : isDark
                      ? 'bg-[#242424] text-white'
                      : isWarm
                      ? 'bg-[#E5DEC9] text-[#292524]'
                      : 'bg-zinc-200 text-zinc-800'
                  }`}
                >
                  {isProcessing ? (
                    <Loader2 className="w-6 h-6 animate-spin text-[#1DB954]" />
                  ) : (
                    <Upload className="w-6 h-6 opacity-80" />
                  )}
                </div>

                {isProcessing ? (
                  <div>
                    <p className="text-xs font-semibold text-[#1DB954] mb-1">
                      Auto-detecting writer &amp; pages...
                    </p>
                    <p className="text-[11px] opacity-70 truncate max-w-xs font-mono">
                      {statusMessage}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-semibold mb-1">
                      Drop your PDF file here
                    </p>
                    <p className="text-xs opacity-60 mb-3">
                      or click to browse from your computer
                    </p>
                    <span
                      className={`inline-block px-4 py-1.5 rounded-full text-xs font-semibold transition-colors shadow-xs ${
                        isDark
                          ? 'bg-white text-black hover:bg-zinc-200'
                          : isWarm
                          ? 'bg-[#3D2817] text-amber-100 hover:bg-[#2B1B0E]'
                          : 'bg-zinc-900 text-white hover:bg-zinc-800'
                      }`}
                    >
                      Select PDF
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4 text-center">
                <p className="text-[11px] opacity-60">
                  Writer, title, and page count are detected automatically from your PDF.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
