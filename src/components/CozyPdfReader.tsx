import React, { useState, useEffect } from 'react';
import { Book, PageBookmark, PageHighlightStroke } from '../types/library';
import { getPdfBlob, createSamplePdfBlob } from '../services/db';
import { ambientSound } from '../services/ambientAudio';
import { RealPdfViewer } from './RealPdfViewer';
import { X, ChevronLeft, CloudRain, Flame, Building2, Check, BookOpen, Trash2 } from 'lucide-react';

interface CozyPdfReaderProps {
  book: Book;
  onClose: () => void;
  onUpdateBook: (updated: Book) => void;
  onDeleteBook?: (bookId: string) => void;
}

type ReaderTheme = 'white' | 'cream' | 'sepia' | 'night';

export const CozyPdfReader: React.FC<CozyPdfReaderProps> = ({
  book,
  onClose,
  onUpdateBook,
  onDeleteBook,
}) => {
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(book.currentPage || 1);
  const [totalPages, setTotalPages] = useState<number>(book.pageCount || 1);
  const [theme, setTheme] = useState<ReaderTheme>('cream');
  const [activeSound, setActiveSound] = useState<'none' | 'rain' | 'fireplace' | 'library'>('none');
  const [isLoadingPdf, setIsLoadingPdf] = useState<boolean>(true);
  const [confirmRemove, setConfirmRemove] = useState<boolean>(false);

  // Load PDF Blob as ArrayBuffer
  useEffect(() => {
    let active = true;

    async function loadPdf() {
      setIsLoadingPdf(true);
      try {
        let blob = book.pdfBlobKey ? await getPdfBlob(book.pdfBlobKey) : null;
        if (!blob) {
          blob = createSamplePdfBlob(
            book.title,
            book.author,
            book.notes || 'A distinguished work from the Folio collection.'
          );
        }

        if (active && blob) {
          const buffer = await blob.arrayBuffer();
          if (active) {
            setArrayBuffer(buffer);
          }
        }
      } catch (err) {
        console.error('Failed to load PDF in reader', err);
      } finally {
        if (active) setIsLoadingPdf(false);
      }
    }

    loadPdf();

    return () => {
      active = false;
    };
  }, [book.id, book.pdfBlobKey]);

  const handleSoundToggle = (soundType: 'rain' | 'fireplace' | 'library') => {
    if (activeSound === soundType) {
      ambientSound.stop();
      setActiveSound('none');
    } else {
      ambientSound.play(soundType, 0.4);
      setActiveSound(soundType);
    }
  };

  const handlePageChange = (page: number, total: number) => {
    setCurrentPage(page);
    setTotalPages(total);
    const isCompleted = page >= total;
    onUpdateBook({
      ...book,
      currentPage: page,
      pageCount: total,
      status: isCompleted ? 'completed' : 'reading',
      lastRead: new Date().toISOString().split('T')[0],
    });
  };

  const handleToggleBookmark = (page: number, note = '') => {
    const currentBookmarks = book.bookmarks || [];
    const existing = currentBookmarks.find(b => b.page === page);
    let nextBookmarks: PageBookmark[];
    if (existing && !note) {
      nextBookmarks = currentBookmarks.filter(b => b.page !== page);
    } else if (existing && note) {
      nextBookmarks = currentBookmarks.map(b => (b.page === page ? { ...b, note } : b));
    } else {
      nextBookmarks = [
        ...currentBookmarks,
        {
          id: 'bm_' + Date.now().toString(36),
          page,
          note,
          createdAt: new Date().toISOString(),
        },
      ].sort((a, b) => a.page - b.page);
    }

    onUpdateBook({
      ...book,
      bookmarks: nextBookmarks,
    });
  };

  const handleUpdateBookmarkNote = (bookmarkId: string, note: string) => {
    const nextBookmarks = (book.bookmarks || []).map(b =>
      b.id === bookmarkId ? { ...b, note } : b
    );
    onUpdateBook({
      ...book,
      bookmarks: nextBookmarks,
    });
  };

  const handleRemoveBookmark = (bookmarkId: string) => {
    const nextBookmarks = (book.bookmarks || []).filter(b => b.id !== bookmarkId);
    onUpdateBook({
      ...book,
      bookmarks: nextBookmarks,
    });
  };

  const handleUpdatePageHighlights = (page: number, strokes: PageHighlightStroke[]) => {
    const nextHighlights = { ...(book.highlights || {}) };
    if (strokes.length === 0) {
      delete nextHighlights[page];
    } else {
      nextHighlights[page] = strokes;
    }
    onUpdateBook({
      ...book,
      highlights: nextHighlights,
    });
  };

  const getContainerBg = () => {
    switch (theme) {
      case 'sepia':
        return 'bg-[#4A3B32] text-[#F4ECE1]';
      case 'cream':
        return 'bg-[#2B231D] text-[#FBF9F5]';
      case 'white':
        return 'bg-[#262626] text-white';
      case 'night':
      default:
        return 'bg-[#121212] text-white';
    }
  };

  return (
    <div className={`fixed inset-0 z-50 flex flex-col select-none transition-colors duration-200 ${getContainerBg()}`}>
      {/* Top Header */}
      <header className="h-12 px-4 border-b border-white/10 flex items-center justify-between gap-4 shrink-0 bg-black/40 backdrop-blur-md">
        {/* Book Title & Author */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-white/10 transition-colors"
            title="Exit Reader"
            aria-label="Exit Reader"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-bold truncate">
              {book.title}
            </h2>
            {book.author && (
              <p className="text-[11px] opacity-60 truncate">
                {book.author}
              </p>
            )}
          </div>
        </div>

        {/* Ambient Sounds, PDF Page Color Modes, Remove & Close */}
        <div className="flex items-center gap-2">
          {/* Ambient Sound Buttons */}
          <div className="hidden md:flex items-center gap-1 bg-white/5 p-1 rounded-md text-xs">
            <button
              onClick={() => handleSoundToggle('rain')}
              className={`p-1.5 rounded transition-colors flex items-center gap-1 ${
                activeSound === 'rain' ? 'bg-[#1DB954] text-black font-semibold' : 'hover:bg-white/10'
              }`}
              title="Rain soundscape"
              aria-label="Rain soundscape"
            >
              <CloudRain className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Rain</span>
            </button>
            <button
              onClick={() => handleSoundToggle('fireplace')}
              className={`p-1.5 rounded transition-colors flex items-center gap-1 ${
                activeSound === 'fireplace' ? 'bg-[#1DB954] text-black font-semibold' : 'hover:bg-white/10'
              }`}
              title="Fireplace crackle"
              aria-label="Fireplace crackle"
            >
              <Flame className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Fire</span>
            </button>
            <button
              onClick={() => handleSoundToggle('library')}
              className={`p-1.5 rounded transition-colors flex items-center gap-1 ${
                activeSound === 'library' ? 'bg-[#1DB954] text-black font-semibold' : 'hover:bg-white/10'
              }`}
              title="Quiet library ambiance"
              aria-label="Quiet library ambiance"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Library</span>
            </button>
          </div>

          {/* PDF Page Color Filter Switcher (Cream / Sepia / Night Dark / White) */}
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-full border border-white/10">
            {(
              [
                { id: 'cream', label: 'Cream', bg: '#FBF9F5' },
                { id: 'sepia', label: 'Sepia', bg: '#F4ECE1' },
                { id: 'night', label: 'Night', bg: '#18181B' },
                { id: 'white', label: 'White', bg: '#FFFFFF' },
              ] as Array<{ id: ReaderTheme; label: string; bg: string }>
            ).map(t => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1 transition-all ${
                  theme === t.id
                    ? 'bg-white text-black font-semibold shadow-xs'
                    : 'text-white/75 hover:text-white'
                }`}
                title={`${t.label} page mode`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full border border-black/20"
                  style={{ backgroundColor: t.bg }}
                />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>

          {/* Mark as Finished */}
          {book.status !== 'completed' ? (
            <button
              onClick={() => handlePageChange(totalPages, totalPages)}
              className="hidden md:flex items-center gap-1 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold transition-colors"
            >
              <Check className="w-3 h-3 text-[#1DB954]" />
              <span>Finish</span>
            </button>
          ) : (
            <span className="hidden md:flex items-center gap-1 text-[#1DB954] text-xs font-semibold">
              <Check className="w-3 h-3" />
              <span>Finished</span>
            </span>
          )}

          {/* Remove Book from Library */}
          {onDeleteBook && (
            confirmRemove ? (
              <button
                onClick={() => {
                  onDeleteBook(book.id);
                  onClose();
                }}
                className="px-2.5 py-1 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1 transition-colors"
                title="Confirm removing book from library"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Confirm Remove</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  setConfirmRemove(true);
                  setTimeout(() => setConfirmRemove(false), 4000);
                }}
                className="p-1.5 rounded-full text-rose-400 hover:bg-rose-500/20 transition-colors"
                title="Remove book from library"
                aria-label="Remove book from library"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )
          )}

          {/* Exit Button */}
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-white/10 transition-colors"
            title="Close Reader"
            aria-label="Close Reader"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Real PDF Canvas Viewer */}
      <div className="flex-1 flex overflow-hidden">
        {isLoadingPdf ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-xs opacity-70">
            <BookOpen className="w-8 h-8 animate-pulse text-[#1DB954]" />
            <span>Loading PDF pages...</span>
          </div>
        ) : (
          <RealPdfViewer
            bookId={book.id}
            bookTitle={book.title}
            bookAuthor={book.author}
            arrayBuffer={arrayBuffer}
            initialPage={currentPage}
            onPageChange={handlePageChange}
            paperTheme={theme}
            bookmarks={book.bookmarks || []}
            onToggleBookmark={handleToggleBookmark}
            onUpdateBookmarkNote={handleUpdateBookmarkNote}
            onRemoveBookmark={handleRemoveBookmark}
            highlights={book.highlights || {}}
            onUpdatePageHighlights={handleUpdatePageHighlights}
          />
        )}
      </div>
    </div>
  );
};
