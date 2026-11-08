import React, { useState } from 'react';
import { Book, Booklist } from '../types/library';
import { BookCover } from './BookCoverArt';
import { BookOpen, Bookmark, Clock, CheckCircle2, Flame, Sparkles, ArrowRight, Play } from 'lucide-react';
import { calculateReadingStats } from '../utils/library';

interface ReadingNookProps {
  books: Book[];
  booklists: Booklist[];
  onOpenBook: (book: Book) => void;
  onOpenBookshelf: () => void;
  onOpenImport: () => void;
}

const LITERARY_QUOTES = [
  {
    quote: 'A room without books is like a body without a soul.',
    author: 'Marcus Tullius Cicero',
  },
  {
    quote: 'I have always imagined that Paradise will be a kind of library.',
    author: 'Jorge Luis Borges',
  },
  {
    quote: 'Books are a uniquely portable magic.',
    author: 'Stephen King',
  },
  {
    quote: 'That is part of the beauty of all literature. You discover that your longings are universal longings.',
    author: 'F. Scott Fitzgerald',
  },
];

export const ReadingNook: React.FC<ReadingNookProps> = ({
  books,
  booklists,
  onOpenBook,
  onOpenBookshelf,
  onOpenImport,
}) => {
  const currentRead = books.find(b => b.status === 'reading') || books[0];
  const stats = calculateReadingStats(books);
  const [quoteIdx, setQuoteIdx] = useState(0);

  const quote = LITERARY_QUOTES[quoteIdx % LITERARY_QUOTES.length];

  return (
    <div className="flex-1 p-6 lg:p-8 max-w-6xl mx-auto overflow-y-auto">
      {/* Editorial Nook Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#7A6B5C] font-semibold mb-1">
          <Sparkles className="w-3.5 h-3.5 text-amber-800" />
          <span>Cozy Reading Haven</span>
        </div>
        <h2 className="font-serif text-3xl lg:text-4xl font-bold text-[#2B1E16] mb-2">
          The Reader's Sanctuary
        </h2>
        <p className="text-sm text-[#6B5E51] max-w-2xl font-sans">
          Step away from screens and noise. Immerse yourself in your personal book collection, track your journey through pages, and find quiet contemplation.
        </p>
      </div>

      {/* Main Sanctuary Card Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Currently Reading Spotlight */}
        <div className="lg:col-span-2 bg-[#F5EFE6] rounded-xl p-6 lg:p-8 border border-[#E5DECF] relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-64 h-64 bg-radial from-amber-400/10 to-transparent blur-2xl pointer-events-none" />

          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-mono uppercase tracking-wider text-[#7A6B5C] font-semibold flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5 text-amber-800" /> Current Volume
              </span>
              {currentRead && (
                <span className="text-xs font-mono text-[#8A7968]">
                  {Math.round((currentRead.currentPage / currentRead.pageCount) * 100)}% Completed
                </span>
              )}
            </div>

            {currentRead ? (
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
                <BookCover
                  title={currentRead.title}
                  author={currentRead.author}
                  color={currentRead.spineColor}
                  pattern={currentRead.coverPattern}
                  coverImage={currentRead.coverImage}
                  className="w-36 h-52 shrink-0 shadow-xl"
                />

                <div className="flex-1 min-w-0 text-center sm:text-left">
                  <h3 className="font-serif text-2xl font-bold text-[#2B1E16] mb-1">
                    {currentRead.title}
                  </h3>
                  {currentRead.author && (
                    <p className="text-xs text-[#7A6B5C] mb-3 font-sans">
                      By {currentRead.author}
                    </p>
                  )}

                  {/* Excerpt / Notes */}
                  {currentRead.notes ? (
                    <blockquote className="text-xs font-serif italic text-[#5C4F42] bg-[#FAF7F0] p-3 rounded border-l-2 border-amber-800/40 mb-4">
                      &ldquo;{currentRead.notes}&rdquo;
                    </blockquote>
                  ) : (
                    <p className="text-xs text-[#6B5E51] mb-4">
                      Continue where you left off on page {currentRead.currentPage} of {currentRead.pageCount}.
                    </p>
                  )}

                  {/* Progress bar */}
                  <div className="mb-4">
                    <div className="w-full bg-[#E2D8C7] rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-[#3D2817] h-full rounded-full transition-all"
                        style={{
                          width: `${(currentRead.currentPage / currentRead.pageCount) * 100}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] font-mono text-[#7A6B5C] mt-1.5">
                      <span>Page {currentRead.currentPage}</span>
                      <span>{currentRead.pageCount} pages total</span>
                    </div>
                  </div>

                  <button
                    onClick={() => onOpenBook(currentRead)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#3D2817] text-amber-100 hover:bg-[#25170C] text-xs font-semibold shadow-md transition-transform hover:scale-[1.02]"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>CONTINUE READING PDF</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="text-xs text-[#7A6B5C] mb-3">No active book in progress.</p>
                <button
                  onClick={onOpenImport}
                  className="px-4 py-2 bg-[#3D2817] text-amber-100 rounded text-xs font-semibold"
                >
                  Import Your First PDF
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Daily Literary Reflection & Habits */}
        <div className="bg-[#FAF7F0] rounded-xl p-6 border border-[#E5DECF] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-mono uppercase tracking-wider text-[#7A6B5C] font-semibold">
                Daily Reflection
              </span>
              <button
                onClick={() => setQuoteIdx(i => i + 1)}
                className="text-[11px] text-amber-900 hover:underline"
              >
                Next Thought
              </button>
            </div>

            <blockquote className="font-serif text-base italic text-[#2B1E16] leading-relaxed mb-3">
              &ldquo;{quote.quote}&rdquo;
            </blockquote>
            <p className="text-xs text-[#8A7968] font-sans">
              — {quote.author}
            </p>
          </div>

          <div className="pt-6 border-t border-[#E5DECF] mt-6">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#7A6B5C] font-semibold block mb-2">
              Virtual Bookshelf Quick Access
            </span>
            <p className="text-xs text-[#6B5E51] mb-3">
              Switch to the handcrafted wooden bookshelf view to browse spines in 3D.
            </p>
            <button
              onClick={onOpenBookshelf}
              className="w-full py-2 px-3 rounded bg-[#EAE2D4] hover:bg-[#DFCDBB] text-xs font-semibold text-[#2B1E16] transition-colors flex items-center justify-center gap-1.5"
            >
              <span>View On Wooden Shelves</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Reading Statistics Strip (Quantitative Rigor) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#F5EFE6] rounded-lg p-4 border border-[#E5DECF]">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[#7A6B5C] font-semibold block mb-1">
            Total PDF Volumes
          </span>
          <p className="text-2xl font-serif font-bold text-[#2B1E16] tabular-nums">
            {stats.totalBooks}
          </p>
          <span className="text-[11px] text-[#8A7968]">In your local library</span>
        </div>

        <div className="bg-[#F5EFE6] rounded-lg p-4 border border-[#E5DECF]">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[#7A6B5C] font-semibold block mb-1">
            Pages Read
          </span>
          <p className="text-2xl font-serif font-bold text-[#2B1E16] tabular-nums">
            {stats.pagesRead}
          </p>
          <span className="text-[11px] text-[#8A7968]">Across all documents</span>
        </div>

        <div className="bg-[#F5EFE6] rounded-lg p-4 border border-[#E5DECF]">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[#7A6B5C] font-semibold block mb-1">
            Finished Books
          </span>
          <p className="text-2xl font-serif font-bold text-emerald-900 tabular-nums">
            {stats.completedBooks}
          </p>
          <span className="text-[11px] text-[#8A7968]">{stats.completionRate}% completion rate</span>
        </div>

        <div className="bg-[#F5EFE6] rounded-lg p-4 border border-[#E5DECF]">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[#7A6B5C] font-semibold block mb-1">
            Est. Hours Remaining
          </span>
          <p className="text-2xl font-serif font-bold text-amber-900 tabular-nums">
            {stats.estimatedHoursLeft}h
          </p>
          <span className="text-[11px] text-[#8A7968]">At steady reading pace</span>
        </div>
      </div>
    </div>
  );
};
