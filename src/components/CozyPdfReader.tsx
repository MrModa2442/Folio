import React, { useState, useEffect } from 'react';
import { Book } from '../types/library';
import { getPdfBlob, createSamplePdfBlob } from '../services/db';
import { ambientSound } from '../services/ambientAudio';
import { RealPdfViewer } from './RealPdfViewer';
import { X, ChevronLeft, CloudRain, Flame, Building2, Check, BookOpen } from 'lucide-react';

interface CozyPdfReaderProps {
  book: Book;
  onClose: () => void;
  onUpdateBook: (updated: Book) => void;
}

type ReaderTheme = 'white' | 'cream' | 'sepia' | 'night';

export const CozyPdfReader: React.FC<CozyPdfReaderProps> = ({
  book,
  onClose,
  onUpdateBook,
}) => {
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(book.currentPage || 1);
  const [totalPages, setTotalPages] = useState<number>(book.pageCount || 1);
  const [theme, setTheme] = useState<ReaderTheme>('cream');
  const [activeSound, setActiveSound] = useState<'none' | 'rain' | 'fireplace' | 'library'>('none');
  const [isLoadingPdf, setIsLoadingPdf] = useState<boolean>(true);

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
            <p className="text-[11px] opacity-60 truncate">
              {book.author}
            </p>
          </div>
        </div>

        {/* Ambient Sounds, Themes & Close */}
        <div className="flex items-center gap-3">
          {/* Ambient Sound Buttons */}
          <div className="hidden sm:flex items-center gap-1 bg-white/5 p-1 rounded-md text-xs">
            <button
              onClick={() => handleSoundToggle('rain')}
              className={`p-1.5 rounded transition-colors flex items-center gap-1 ${
                activeSound === 'rain' ? 'bg-[#1DB954] text-black font-semibold' : 'hover:bg-white/10'
              }`}
              title="Rain soundscape"
              aria-label="Rain soundscape"
            >
              <CloudRain className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Rain</span>
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
              <span className="hidden md:inline">Fire</span>
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
              <span className="hidden md:inline">Library</span>
            </button>
          </div>

          {/* Theme Color Picker */}
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-md">
            {(['cream', 'sepia', 'night', 'white'] as ReaderTheme[]).map(t => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`w-4 h-4 rounded-full border border-white/20 capitalize transition-transform ${
                  theme === t ? 'scale-125 ring-2 ring-white' : 'hover:scale-110'
                }`}
                style={{
                  backgroundColor:
                    t === 'cream' ? '#FBF9F5' : t === 'sepia' ? '#F4ECE1' : t === 'night' ? '#18181B' : '#FFFFFF',
                }}
                title={`${t} paper mode`}
                aria-label={`${t} paper mode`}
              />
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
            arrayBuffer={arrayBuffer}
            initialPage={currentPage}
            onPageChange={handlePageChange}
            paperTheme={theme}
          />
        )}
      </div>
    </div>
  );
};
