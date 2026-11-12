import React, { useState, useMemo } from 'react';
import { AppTheme, Book, SavedVocabularyItem } from '../types/library';
import { deleteVocabularyItem, upsertVocabularyItem } from '../services/vocabularyStore';
import {
  Languages,
  Search,
  Sparkles,
  BookOpen,
  ExternalLink,
  Trash2,
  Copy,
  Check,
  Eye,
  EyeOff,
  Plus,
  Loader2,
} from 'lucide-react';

interface VocabularyHubProps {
  vocabulary: SavedVocabularyItem[];
  books: Book[];
  onOpenBookAtPage: (book: Book, page: number) => void;
  onVocabularyChange: (next: SavedVocabularyItem[]) => void;
  theme: AppTheme;
}

export const VocabularyHub: React.FC<VocabularyHubProps> = ({
  vocabulary,
  books,
  onOpenBookAtPage,
  onVocabularyChange,
  theme,
}) => {
  const isDark = theme === 'spotify-dark';
  const isWarm = theme === 'warm-minimal';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBookTitle, setSelectedBookTitle] = useState<string>('all');
  const [flashcardMode, setFlashcardMode] = useState<boolean>(false);
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [copiedAll, setCopiedAll] = useState<boolean>(false);

  // Quick lookup & add word bar inside Vocabulary Hub
  const [newWordInput, setNewWordInput] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const uniqueBookTitles = useMemo(() => {
    const set = new Set<string>();
    for (const item of vocabulary) {
      if (item.bookTitle && item.bookTitle.trim()) {
        set.add(item.bookTitle.trim());
      }
    }
    return Array.from(set);
  }, [vocabulary]);

  const filteredVocabulary = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vocabulary.filter(item => {
      if (selectedBookTitle !== 'all' && item.bookTitle !== selectedBookTitle) {
        return false;
      }
      if (!q) return true;
      return (
        item.word.toLowerCase().includes(q) ||
        (item.persianMeaning || '').toLowerCase().includes(q) ||
        (item.englishMeaning || '').toLowerCase().includes(q) ||
        (item.contextExplanation || '').toLowerCase().includes(q) ||
        (item.bookTitle || '').toLowerCase().includes(q)
      );
    });
  }, [vocabulary, selectedBookTitle, searchQuery]);

  const handleQuickAddWord = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newWordInput.trim();
    if (!clean || isLookingUp) return;

    setIsLookingUp(true);
    setLookupError(null);
    try {
      const res = await fetch('/api/dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term: clean,
          mode: 'ai',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.result) {
        throw new Error(data.error || 'Could not define this word.');
      }
      const next = upsertVocabularyItem({
        word: data.result.word || clean,
        pronunciation: data.result.pronunciation || '',
        partOfSpeech: data.result.partOfSpeech || '',
        persianMeaning: data.result.persianMeaning || '',
        englishMeaning: data.result.englishMeaning || '',
        contextExplanation: data.result.contextExplanation || '',
        bookTitle: selectedBookTitle !== 'all' ? selectedBookTitle : 'Personal Word Bank',
        page: 1,
      });
      onVocabularyChange(next);
      setNewWordInput('');
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed.');
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleDeleteWord = (id: string) => {
    const next = deleteVocabularyItem(id);
    onVocabularyChange(next);
  };

  const handleCopyVocabularySheet = async () => {
    const lines = [
      '# Folio Saved Vocabulary & Literary Glossary',
      '',
      ...filteredVocabulary.map(
        item =>
          `- **${item.word}** ${item.partOfSpeech ? `(${item.partOfSpeech})` : ''}: ${
            item.persianMeaning
          } | ${item.englishMeaning}${
            item.bookTitle ? ` — *${item.bookTitle}, p. ${item.page}*` : ''
          }`
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const findMatchingBook = (item: SavedVocabularyItem): Book | undefined => {
    if (item.bookId) {
      const byId = books.find(b => b.id === item.bookId);
      if (byId) return byId;
    }
    if (item.bookTitle) {
      const clean = item.bookTitle.trim().toLowerCase();
      return books.find(b => b.title.trim().toLowerCase() === clean);
    }
    return undefined;
  };

  const cardSurface = isDark
    ? 'bg-[#181818] border-[#282828] text-white'
    : isWarm
    ? 'bg-[#F5EFE6] border-[#E2D9C5] text-[#292524]'
    : 'bg-white border-zinc-200 text-zinc-900';

  const mutedText = isDark
    ? 'text-[#B3B3B3]'
    : isWarm
    ? 'text-[#78716C]'
    : 'text-zinc-500';

  return (
    <div className="flex-1 p-6 lg:p-8 max-w-6xl w-full mx-auto overflow-y-auto select-none space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight flex items-center gap-2.5">
            <span>Saved Vocabulary &amp; Word Bank</span>
          </h1>
          <p className={`text-xs sm:text-sm mt-1 font-medium ${mutedText}`}>
            Every word you look up in the AI Dictionary while reading is automatically saved here with its book &amp; page context
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {vocabulary.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  setFlashcardMode(v => !v);
                  setRevealedIds({});
                }}
                className={`px-3.5 py-2 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition-colors ${
                  flashcardMode
                    ? 'bg-sky-400 text-black border-sky-400 font-bold'
                    : isDark
                    ? 'bg-[#181818] border-[#282828] hover:bg-[#242424] text-white'
                    : isWarm
                    ? 'bg-[#F5EFE6] border-[#D8CEB8] hover:bg-[#EAE0CE] text-[#292524]'
                    : 'bg-white border-zinc-200 hover:bg-zinc-100 text-zinc-900'
                }`}
                title="Hide meanings so you can quiz yourself like flashcards"
              >
                {flashcardMode ? (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>Exit Flashcard Quiz</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Flashcard Quiz Mode</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleCopyVocabularySheet}
                className={`px-3.5 py-2 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition-colors ${
                  isDark
                    ? 'bg-[#181818] border-[#282828] hover:bg-[#242424] text-white'
                    : isWarm
                    ? 'bg-[#F5EFE6] border-[#D8CEB8] hover:bg-[#EAE0CE] text-[#292524]'
                    : 'bg-white border-zinc-200 hover:bg-zinc-100 text-zinc-900'
                }`}
                title="Copy formatted vocabulary list to clipboard"
              >
                {copiedAll ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#1DB954]" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Glossary</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Quick AI Lookup & Add Word Bar */}
      <div className={`p-4 rounded-2xl border ${cardSurface}`}>
        <form onSubmit={handleQuickAddWord} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-sky-400 shrink-0">
            <Languages className="w-4 h-4" />
            <span>Quick AI Define &amp; Save:</span>
          </div>
          <input
            type="text"
            dir="auto"
            value={newWordInput}
            onChange={e => setNewWordInput(e.target.value)}
            placeholder="Type any Persian, Arabic, or English word or phrase to define and add to your Word Bank..."
            className={`flex-1 text-xs px-3.5 py-2 rounded-xl border focus:outline-hidden ${
              isDark
                ? 'bg-[#121212] border-[#333333] text-white placeholder-zinc-500 focus:border-sky-400'
                : isWarm
                ? 'bg-[#FAF6EE] border-[#D5C9B8] text-[#292524] placeholder-[#8A7968] focus:border-[#3D2817]'
                : 'bg-zinc-50 border-zinc-300 text-zinc-900 placeholder-zinc-400 focus:border-zinc-900'
            }`}
          />
          <button
            type="submit"
            disabled={isLookingUp || !newWordInput.trim()}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-sky-400 text-black hover:bg-sky-300 disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0 transition-colors"
          >
            {isLookingUp ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Defining...</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Define &amp; Save</span>
              </>
            )}
          </button>
        </form>
        {lookupError && (
          <p className="text-xs text-rose-400 mt-2">{lookupError}</p>
        )}
      </div>

      {/* Filter & Search Bar */}
      {vocabulary.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold ${mutedText}`}>
              {filteredVocabulary.length} {filteredVocabulary.length === 1 ? 'word' : 'words'} saved
            </span>
            {uniqueBookTitles.length > 1 && (
              <select
                value={selectedBookTitle}
                onChange={e => setSelectedBookTitle(e.target.value)}
                aria-label="Filter vocabulary by book"
                className={`text-xs font-medium px-3 py-1.5 rounded-full border focus:outline-hidden ${cardSurface}`}
              >
                <option value="all">All Books ({vocabulary.length})</option>
                {uniqueBookTitles.map(title => (
                  <option key={title} value={title}>
                    {title}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 opacity-50 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              dir="auto"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search saved words or meanings..."
              className={`w-full text-xs pl-8 pr-3 py-2 rounded-full border focus:outline-hidden ${
                isDark
                  ? 'bg-[#242424] border-[#333333] text-white placeholder-zinc-500'
                  : isWarm
                  ? 'bg-[#FAF6EE] border-[#D5C9B8] text-[#292524]'
                  : 'bg-white border-zinc-200 text-zinc-900'
              }`}
            />
          </div>
        </div>
      )}

      {/* Vocabulary Cards Grid */}
      {vocabulary.length === 0 ? (
        <div className={`p-10 rounded-2xl border text-center space-y-3 ${cardSurface}`}>
          <div className="w-11 h-11 rounded-full bg-sky-400/15 text-sky-400 flex items-center justify-center mx-auto">
            <Languages className="w-5 h-5" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-sm font-bold">Your Vocabulary Bank is Empty</h3>
            <p className={`text-xs leading-relaxed ${mutedText}`}>
              While reading any PDF book, open the <strong>Dictionary</strong> tool in the top toolbar to look up any Persian, Arabic, or English word. Every word you look up is automatically saved here with its book and page number!
            </p>
          </div>
        </div>
      ) : filteredVocabulary.length === 0 ? (
        <div className={`p-8 rounded-2xl border text-center text-xs ${cardSurface} ${mutedText}`}>
          No saved words match your current search or book filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredVocabulary.map(item => {
            const matchedBook = findMatchingBook(item);
            const isHiddenInQuiz = flashcardMode && !revealedIds[item.id];

            return (
              <div
                key={item.id}
                className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 transition-all ${cardSurface}`}
              >
                <div className="space-y-3">
                  {/* Top Row: Word + Part of Speech + Book/Page Link */}
                  <div className="flex items-start justify-between gap-2 border-b border-current/10 pb-2.5">
                    <div dir="auto">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold">{item.word}</h3>
                        {item.partOfSpeech && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-400/15 text-sky-400">
                            {item.partOfSpeech}
                          </span>
                        )}
                      </div>
                      {item.pronunciation && (
                        <p className={`text-[11px] font-mono mt-0.5 ${mutedText}`}>
                          {item.pronunciation}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {matchedBook ? (
                        <button
                          type="button"
                          onClick={() => onOpenBookAtPage(matchedBook, item.page || 1)}
                          className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#1DB954]/15 text-[#1DB954] hover:bg-[#1DB954] hover:text-black transition-colors flex items-center gap-1"
                          title={`Open "${matchedBook.title}" to Page ${item.page}`}
                        >
                          <BookOpen className="w-3 h-3" />
                          <span className="max-w-[130px] truncate">{matchedBook.title}</span>
                          <span className="font-mono">· p.{item.page}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      ) : item.bookTitle ? (
                        <span className={`text-[11px] px-2.5 py-0.5 rounded-full border border-current/10 ${mutedText}`}>
                          {item.bookTitle} {item.page > 1 ? `· p.${item.page}` : ''}
                        </span>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => handleDeleteWord(item.id)}
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15 transition-colors"
                        title="Remove from Vocabulary"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Meanings Body (or Flashcard Reveal Button) */}
                  {isHiddenInQuiz ? (
                    <button
                      type="button"
                      onClick={() =>
                        setRevealedIds(prev => ({
                          ...prev,
                          [item.id]: true,
                        }))
                      }
                      className={`w-full py-6 rounded-xl border border-dashed text-xs font-semibold flex flex-col items-center justify-center gap-1.5 transition-colors ${
                        isDark
                          ? 'border-[#333333] bg-[#121212] text-sky-400 hover:bg-[#202020]'
                          : 'border-zinc-300 bg-zinc-50 text-sky-600 hover:bg-zinc-100'
                      }`}
                    >
                      <Eye className="w-4 h-4" />
                      <span>Tap to Reveal Meaning &amp; Context</span>
                    </button>
                  ) : (
                    <div className="space-y-2.5">
                      {item.persianMeaning && (
                        <div className="space-y-0.5" dir="rtl">
                          <div className="text-[10px] font-bold text-sky-400">معنی فارسی:</div>
                          <p className="text-xs leading-relaxed">{item.persianMeaning}</p>
                        </div>
                      )}

                      {item.englishMeaning && (
                        <div className="space-y-0.5" dir="ltr">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                            English Meaning:
                          </div>
                          <p className="text-xs leading-relaxed">{item.englishMeaning}</p>
                        </div>
                      )}

                      {item.contextExplanation && (
                        <div
                          dir="auto"
                          className={`p-2.5 rounded-xl border text-[11px] leading-relaxed space-y-1 ${
                            isDark
                              ? 'bg-[#121212] border-[#282828] text-white/85'
                              : isWarm
                              ? 'bg-[#FAF6EE] border-[#E2D9C5] text-[#292524]'
                              : 'bg-zinc-50 border-zinc-200 text-zinc-700'
                          }`}
                        >
                          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-500 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            <span>Literary &amp; Page Context</span>
                          </div>
                          <p>{item.contextExplanation}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
