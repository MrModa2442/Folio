import React, { useState, useRef } from 'react';
import { Book, Booklist, SpineTexture, CoverPattern } from '../types/library';
import { extractPdfMetadata } from '../utils/pdfParser';
import { storePdfBlob } from '../services/db';
import { X, Upload, Check, Loader2, FileText } from 'lucide-react';

interface ImportPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBookImported: (book: Book, targetListId?: string) => void;
  booklists: Booklist[];
  editingBook?: Book | null;
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
  booklists,
  editingBook,
}) => {
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

  // Fully automatic import: extracts pages, author, and title with zero questions asked!
  const handleProcessPdfFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      alert('Please select a valid PDF file.');
      return;
    }

    setIsProcessing(true);
    setStatusMessage('Parsing PDF structure with PDF.js...');

    try {
      // 1. Automatically extract metadata (author, title, page count) via PDF.js
      const metadata = await extractPdfMetadata(file);
      setStatusMessage(`Extracted: "${metadata.title}" by ${metadata.author} (${metadata.pageCount} pages)`);

      const bookId = 'book_' + Date.now().toString(36);

      // 2. Store binary blob in IndexedDB
      await storePdfBlob(bookId, file);

      // 3. Automatically assign palette tone based on title
      const colorIndex = Math.abs(
        metadata.title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
      ) % PALETTE.length;
      const spineColor = PALETTE[colorIndex];

      const patterns: CoverPattern[] = ['classical', 'minimal', 'botanical', 'geometric'];
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
        dateAdded: new Date().toISOString().split('T')[0],
        lastRead: null,
        pdfBlobKey: bookId,
      };

      // Brief gentle transition so user sees the detected title
      setTimeout(() => {
        onBookImported(newBook);
        setIsProcessing(false);
        onClose();
      }, 500);
    } catch (err) {
      console.error('Failed to import PDF automatically:', err);
      setIsProcessing(false);
      alert('Could not parse PDF. Please try again.');
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
      author: editAuthor.trim() || 'Unknown Writer',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs select-none">
      <div className="bg-[#181818] text-white w-full max-w-md rounded-xl shadow-2xl border border-[#282828] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#1F1F1F] border-b border-[#282828] flex items-center justify-between">
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
                  className="w-full text-xs px-3 py-2 rounded bg-[#242424] border border-[#333333] focus:outline-hidden focus:border-white"
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
                  className="w-full text-xs px-3 py-2 rounded bg-[#242424] border border-[#333333] focus:outline-hidden focus:border-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-1.5 text-xs opacity-70 hover:opacity-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold bg-[#1DB954] text-black rounded-full"
                >
                  Save
                </button>
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
                    : 'border-[#333333] hover:border-[#555555] bg-[#121212]'
                }`}
              >
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                    isProcessing
                      ? 'bg-[#1DB954]/20 text-[#1DB954]'
                      : 'bg-[#242424] text-white'
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
                    <p className="text-xs opacity-50 mb-3">
                      or click to browse from your computer
                    </p>
                    <span className="inline-block px-4 py-1.5 rounded-full text-xs font-semibold bg-white text-black hover:bg-zinc-200 transition-colors shadow-xs">
                      Select PDF
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4 text-center">
                <p className="text-[11px] opacity-40">
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
