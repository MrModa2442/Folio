import React, { useState, useMemo } from 'react';
import { Book, AppTheme } from '../types/library';
import { BookCover } from './BookCoverArt';
import {
  Bookmark,
  Highlighter,
  Search,
  FileText,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  Sparkles,
  Printer,
  Edit3,
} from 'lucide-react';

interface NotesHighlightsHubProps {
  books: Book[];
  onOpenBookAtPage: (book: Book, page: number) => void;
  onUpdateBook: (book: Book) => void;
  theme: AppTheme;
}

type AnnotationFilter = 'all' | 'pins' | 'highlights';

const HIGHLIGHT_COLOR_LABELS: Record<string, { label: string; dot: string }> = {
  '#FACC15': { label: 'Yellow Highlight', dot: '#FACC15' },
  '#4ADE80': { label: 'Green Highlight', dot: '#4ADE80' },
  '#FB7185': { label: 'Rose Highlight', dot: '#FB7185' },
  '#38BDF8': { label: 'Sky Highlight', dot: '#38BDF8' },
  '#111827': { label: 'Black Pen', dot: '#111827' },
  '#1D4ED8': { label: 'Blue Pen', dot: '#1D4ED8' },
  '#DC2626': { label: 'Red Pen', dot: '#DC2626' },
  '#047857': { label: 'Emerald Pen', dot: '#047857' },
  '#78350F': { label: 'Walnut Pen', dot: '#78350F' },
  '#FFFFFF': { label: 'White Pen', dot: '#FFFFFF' },
};

export const NotesHighlightsHub: React.FC<NotesHighlightsHubProps> = ({
  books,
  onOpenBookAtPage,
  onUpdateBook,
  theme,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<AnnotationFilter>('all');
  const [selectedBookId, setSelectedBookId] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingPinKey, setEditingPinKey] = useState<string | null>(null);
  const [editingNoteDraft, setEditingNoteDraft] = useState<string>('');

  const isDark = theme === 'spotify-dark';

  // Collect all books that have pins/bookmarks or highlights
  const annotatedBooks = useMemo(() => {
    return books
      .map(book => {
        const bookmarks = [...(book.bookmarks || [])].sort((a, b) => a.page - b.page);
        const highlightEntries = Object.entries(book.highlights || {})
          .map(([pageStr, strokes]) => ({
            page: Number(pageStr),
            strokes: strokes || [],
          }))
          .filter(entry => entry.strokes.length > 0 && !Number.isNaN(entry.page))
          .sort((a, b) => a.page - b.page);

        return {
          book,
          bookmarks,
          highlightEntries,
          totalCount: bookmarks.length + highlightEntries.length,
        };
      })
      .filter(item => item.totalCount > 0);
  }, [books]);

  const totalPinsCount = useMemo(
    () => annotatedBooks.reduce((sum, item) => sum + item.bookmarks.length, 0),
    [annotatedBooks]
  );

  const totalHighlightedPagesCount = useMemo(
    () => annotatedBooks.reduce((sum, item) => sum + item.highlightEntries.length, 0),
    [annotatedBooks]
  );

  // Filter by selected book, filterType, and searchQuery
  const filteredBookGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return annotatedBooks
      .filter(group => selectedBookId === 'all' || group.book.id === selectedBookId)
      .map(group => {
        const bookMatchesQuery =
          !q ||
          group.book.title.toLowerCase().includes(q) ||
          (group.book.author || '').toLowerCase().includes(q);

        const bookmarks =
          filterType === 'highlights'
            ? []
            : group.bookmarks.filter(
                bm =>
                  bookMatchesQuery ||
                  (bm.note || '').toLowerCase().includes(q) ||
                  `page ${bm.page}`.includes(q) ||
                  `p. ${bm.page}`.includes(q)
              );

        const highlightEntries =
          filterType === 'pins'
            ? []
            : group.highlightEntries.filter(
                hl =>
                  bookMatchesQuery ||
                  `page ${hl.page}`.includes(q) ||
                  `p. ${hl.page}`.includes(q)
              );

        return {
          ...group,
          bookmarks,
          highlightEntries,
        };
      })
      .filter(group => group.bookmarks.length > 0 || group.highlightEntries.length > 0);
  }, [annotatedBooks, selectedBookId, filterType, searchQuery]);

  // Build Markdown study sheet content
  const generateMarkdownStudySheet = (targetGroups = filteredBookGroups): string => {
    const dateStr = new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const lines: string[] = [
      `# Folio Study Sheet — Notes & Highlights`,
      `_Exported on ${dateStr}_`,
      '',
    ];

    for (const group of targetGroups) {
      const { book, bookmarks, highlightEntries } = group;
      lines.push(`## ${book.title}${book.author ? ` — ${book.author}` : ''}`);
      lines.push(
        `- **Progress**: Page ${book.currentPage} of ${book.pageCount} (${Math.round(
          (book.currentPage / Math.max(1, book.pageCount)) * 100
        )}%)`
      );
      lines.push('');

      if (bookmarks.length > 0) {
        lines.push(`### Pinned Pages & Notes (${bookmarks.length})`);
        for (const bm of bookmarks) {
          if (bm.note && bm.note.trim()) {
            lines.push(`- **Page ${bm.page}**: ${bm.note.trim()}`);
          } else {
            lines.push(`- **Page ${bm.page}** _(Pinned page)_`);
          }
        }
        lines.push('');
      }

      if (highlightEntries.length > 0) {
        lines.push(`### Highlighted Pages (${highlightEntries.length})`);
        for (const hl of highlightEntries) {
          const uniqueColors = Array.from(
            new Set(
              hl.strokes.map(s => HIGHLIGHT_COLOR_LABELS[s.color]?.label || 'Highlight')
            )
          );
          lines.push(
            `- **Page ${hl.page}**: ${hl.strokes.length} highlight stroke${
              hl.strokes.length === 1 ? '' : 's'
            } (${uniqueColors.join(', ')})`
          );
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  };

  const handlePrintPdfStudySheet = (groups = filteredBookGroups) => {
    const dateStr = new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const htmlSections = groups
      .map(({ book, bookmarks, highlightEntries }) => {
        const pinsHtml =
          bookmarks.length > 0
            ? `
          <div class="sub-section">
            <h3>Pinned Pages &amp; Notes (${bookmarks.length})</h3>
            <ul>
              ${bookmarks
                .map(
                  bm => `
                <li>
                  <span class="page-badge">Page ${bm.page}</span>
                  <span dir="auto">${
                    bm.note
                      ? bm.note.replace(/</g, '&lt;').replace(/>/g, '&gt;')
                      : '<em>Pinned page</em>'
                  }</span>
                </li>`
                )
                .join('')}
            </ul>
          </div>`
            : '';

        const highlightsHtml =
          highlightEntries.length > 0
            ? `
          <div class="sub-section">
            <h3>Highlighted Pages (${highlightEntries.length})</h3>
            <div class="chips">
              ${highlightEntries
                .map(
                  hl =>
                    `<span class="hl-chip">Page ${hl.page} · ${hl.strokes.length} stroke${
                      hl.strokes.length === 1 ? '' : 's'
                    }</span>`
                )
                .join('')}
            </div>
          </div>`
            : '';

        return `
        <section class="book-card" dir="auto">
          <div class="book-header">
            <h2>${book.title.replace(/</g, '&lt;')}</h2>
            <p>${book.author ? book.author.replace(/</g, '&lt;') + ' · ' : ''}Page ${
          book.currentPage
        } of ${book.pageCount}</p>
          </div>
          ${pinsHtml}
          ${highlightsHtml}
        </section>`;
      })
      .join('');

    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Folio Study Sheet</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #18181b;
      background: #ffffff;
      max-width: 820px;
      margin: 0 auto;
      padding: 32px 24px;
      line-height: 1.6;
    }
    header {
      border-bottom: 2px solid #18181b;
      padding-bottom: 14px;
      margin-bottom: 28px;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    header h1 {
      font-size: 24px;
      margin: 0;
    }
    header span {
      font-size: 12px;
      color: #71717a;
    }
    .book-card {
      border: 1px solid #e4e4e7;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    .book-header h2 {
      font-size: 18px;
      margin: 0 0 4px 0;
    }
    .book-header p {
      font-size: 12px;
      color: #71717a;
      margin: 0 0 14px 0;
    }
    .sub-section h3 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #52525b;
      margin: 14px 0 8px 0;
    }
    ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    li {
      padding: 8px 10px;
      border-bottom: 1px solid #f4f4f5;
      display: flex;
      align-items: baseline;
      gap: 10px;
      font-size: 14px;
    }
    .page-badge {
      font-family: monospace;
      font-weight: 700;
      font-size: 12px;
      background: #fef3c7;
      color: #92400e;
      padding: 2px 8px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .hl-chip {
      font-family: monospace;
      font-size: 12px;
      background: #fef9c3;
      border: 1px solid #fde047;
      color: #854d0e;
      padding: 4px 10px;
      border-radius: 999px;
    }
  </style>
</head>
<body>
  <header>
    <h1>Folio Study Sheet — Notes &amp; Highlights</h1>
    <span>${dateStr}</span>
  </header>
  ${htmlSections}
</body>
</html>`;

    // Print via hidden iframe so we never use window.open and work cleanly on iPad Safari/Brave
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(fullHtml);
      doc.close();
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          // Fallback: download as printable HTML study sheet
          const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'folio-study-sheet.html';
          a.click();
          URL.revokeObjectURL(url);
        } finally {
          setTimeout(() => {
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
          }, 2000);
        }
      }, 250);
    }
  };

  const handleCopyStudySheet = async (groups = filteredBookGroups, copyKey = 'global') => {
    const md = generateMarkdownStudySheet(groups);
    try {
      await navigator.clipboard.writeText(md);
      setCopiedId(copyKey);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleSavePinNote = (book: Book, bookmarkId: string) => {
    const updatedBookmarks = (book.bookmarks || []).map(bm =>
      bm.id === bookmarkId ? { ...bm, note: editingNoteDraft.trim() } : bm
    );
    onUpdateBook({
      ...book,
      bookmarks: updatedBookmarks,
    });
    setEditingPinKey(null);
    setEditingNoteDraft('');
  };

  const handleDeletePin = (book: Book, bookmarkId: string) => {
    const updatedBookmarks = (book.bookmarks || []).filter(bm => bm.id !== bookmarkId);
    onUpdateBook({
      ...book,
      bookmarks: updatedBookmarks,
    });
  };

  const handleDeleteHighlightPage = (book: Book, pageNum: number) => {
    const nextHighlights = { ...(book.highlights || {}) };
    delete nextHighlights[pageNum];
    onUpdateBook({
      ...book,
      highlights: nextHighlights,
    });
  };

  return (
    <div className="flex-1 p-6 lg:p-8 max-w-6xl w-full mx-auto overflow-y-auto select-none space-y-8">
      {/* Top Header & 1-Tap Study Sheet Export Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight">
            Notes &amp; Highlights Hub
          </h1>
          <p className={`text-xs sm:text-sm mt-1 font-medium ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
            All your pinned pages, study notes, and Apple Pencil highlights across every book in one place
          </p>
        </div>

        {annotatedBooks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleCopyStudySheet(filteredBookGroups, 'global')}
              className={`px-3.5 py-2 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition-colors ${
                isDark
                  ? 'bg-[#181818] border-[#282828] hover:bg-[#242424] text-white'
                  : 'bg-white border-zinc-200 hover:bg-zinc-100 text-zinc-900'
              }`}
              title="Copy formatted study sheet to clipboard"
            >
              {copiedId === 'global' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#1DB954]" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Notes</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => handlePrintPdfStudySheet(filteredBookGroups)}
              className="px-4 py-2 rounded-full text-xs font-bold bg-[#1DB954] text-black hover:bg-[#1ed760] flex items-center gap-1.5 transition-all shadow-sm"
              title="Export or print a clean PDF Study Sheet"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Export PDF Study Sheet</span>
            </button>
          </div>
        )}
      </div>

      {/* Summary Stats Cards */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <div
          className={`p-4 rounded-2xl border flex items-center gap-3 ${
            isDark ? 'bg-[#181818] border-[#282828]' : 'bg-white border-zinc-200/80'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-[#1DB954]/15 text-[#1DB954] flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg sm:text-xl font-bold font-mono tabular-nums">
              {annotatedBooks.length}
            </div>
            <div className={`text-[11px] font-medium ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
              Annotated Books
            </div>
          </div>
        </div>

        <div
          className={`p-4 rounded-2xl border flex items-center gap-3 ${
            isDark ? 'bg-[#181818] border-[#282828]' : 'bg-white border-zinc-200/80'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-amber-400/15 text-amber-400 flex items-center justify-center shrink-0">
            <Bookmark className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg sm:text-xl font-bold font-mono tabular-nums">
              {totalPinsCount}
            </div>
            <div className={`text-[11px] font-medium ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
              Pinned Pages &amp; Notes
            </div>
          </div>
        </div>

        <div
          className={`p-4 rounded-2xl border flex items-center gap-3 ${
            isDark ? 'bg-[#181818] border-[#282828]' : 'bg-white border-zinc-200/80'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-yellow-400/15 text-yellow-400 flex items-center justify-center shrink-0">
            <Highlighter className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg sm:text-xl font-bold font-mono tabular-nums">
              {totalHighlightedPagesCount}
            </div>
            <div className={`text-[11px] font-medium ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
              Highlights &amp; Pen Pages
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      {annotatedBooks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All (${totalPinsCount + totalHighlightedPagesCount})` },
                { id: 'pins', label: `Pins & Notes (${totalPinsCount})` },
                { id: 'highlights', label: `Highlights & Pen (${totalHighlightedPagesCount})` },
              ] as const
            ).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterType(tab.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  filterType === tab.id
                    ? 'bg-[#1DB954] text-black'
                    : isDark
                    ? 'bg-[#181818] text-[#B3B3B3] hover:text-white'
                    : 'bg-zinc-100 text-zinc-700 hover:text-zinc-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Book selector */}
            {annotatedBooks.length > 1 && (
              <select
                value={selectedBookId}
                onChange={e => setSelectedBookId(e.target.value)}
                aria-label="Filter by book"
                className={`text-xs font-medium px-3 py-2 rounded-full border focus:outline-hidden ${
                  isDark
                    ? 'bg-[#181818] border-[#282828] text-white'
                    : 'bg-white border-zinc-200 text-zinc-900'
                }`}
              >
                <option value="all">All Annotated Books ({annotatedBooks.length})</option>
                {annotatedBooks.map(item => (
                  <option key={item.book.id} value={item.book.id}>
                    {item.book.title} ({item.totalCount})
                  </option>
                ))}
              </select>
            )}

            {/* Search notes */}
            <div className="relative w-56 sm:w-64">
              <Search className="w-3.5 h-3.5 opacity-50 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                dir="auto"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search notes, book, or page..."
                className={`w-full text-xs pl-8 pr-3 py-2 rounded-full border focus:outline-hidden ${
                  isDark
                    ? 'bg-[#242424] border-[#333333] text-white placeholder-zinc-500'
                    : 'bg-white border-zinc-200 text-zinc-900'
                }`}
              />
            </div>
          </div>
        </div>
      )}

      {/* Annotated Books List */}
      {annotatedBooks.length === 0 ? (
        <div
          className={`p-10 rounded-2xl border text-center space-y-3 ${
            isDark ? 'bg-[#181818] border-[#282828]' : 'bg-zinc-50 border-zinc-200'
          }`}
        >
          <div className="w-11 h-11 rounded-full bg-amber-400/15 text-amber-400 flex items-center justify-center mx-auto">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-sm font-bold">No Notes or Highlights Yet</h3>
            <p className={`text-xs leading-relaxed ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
              While reading any PDF book, tap <strong>Pin Page</strong> to bookmark a page or add a note, or tap{' '}
              <strong>Highlight</strong> to draw highlights with your finger or Apple Pencil. Everything you save will automatically appear here.
            </p>
          </div>
        </div>
      ) : filteredBookGroups.length === 0 ? (
        <div
          className={`p-8 rounded-2xl border text-center text-xs ${
            isDark ? 'bg-[#181818] border-[#282828] text-[#B3B3B3]' : 'bg-zinc-50 border-zinc-200 text-zinc-500'
          }`}
        >
          No annotations match your current filter or search query.
        </div>
      ) : (
        <div className="space-y-6">
          {filteredBookGroups.map(group => {
            const { book, bookmarks, highlightEntries } = group;

            return (
              <div
                key={book.id}
                className={`rounded-2xl border overflow-hidden transition-colors ${
                  isDark ? 'bg-[#181818] border-[#282828]' : 'bg-white border-zinc-200'
                }`}
              >
                {/* Book Header */}
                <div
                  className={`p-4 sm:p-5 ${
                    bookmarks.length > 0 ? 'border-b' : ''
                  } flex flex-wrap items-center justify-between gap-4 ${
                    isDark ? 'bg-[#1E1E1E] border-[#282828]' : 'bg-zinc-50/80 border-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      onClick={() =>
                        onOpenBookAtPage(
                          book,
                          highlightEntries[0]?.page || bookmarks[0]?.page || book.currentPage
                        )
                      }
                      className="cursor-pointer shrink-0"
                    >
                      <BookCover
                        title={book.title}
                        author={book.author}
                        color={book.spineColor}
                        pattern={book.coverPattern}
                        className="w-12 h-16 rounded-md shadow-md hover:scale-105 transition-transform"
                      />
                    </div>
                    <div className="min-w-0">
                      <h2
                        dir="auto"
                        onClick={() =>
                          onOpenBookAtPage(
                            book,
                            highlightEntries[0]?.page || bookmarks[0]?.page || book.currentPage
                          )
                        }
                        className="font-serif font-bold text-base sm:text-lg truncate cursor-pointer hover:text-[#1DB954] transition-colors"
                      >
                        {book.title}
                      </h2>
                      <p className={`text-xs truncate ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
                        {book.author ? `${book.author} · ` : ''}
                        {highlightEntries.length > 0
                          ? `Highlighted on Page ${highlightEntries.map(h => h.page).join(', ')}`
                          : `Page ${book.currentPage} of ${book.pageCount}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {highlightEntries.length > 1 ? (
                      highlightEntries.map(hl => (
                        <div key={hl.page} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onOpenBookAtPage(book, hl.page)}
                            className="px-3.5 py-1.5 rounded-full text-[11px] font-bold bg-[#1DB954] text-black hover:bg-[#1ed760] flex items-center gap-1 transition-colors"
                            title={`Open "${book.title}" directly to highlighted page ${hl.page}`}
                          >
                            <span>Open Highlighted Page (p. {hl.page})</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteHighlightPage(book, hl.page)}
                            className="p-1.5 rounded-full text-rose-400/80 hover:text-rose-400 hover:bg-rose-500/15 transition-colors"
                            title={`Clear highlights on page ${hl.page}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            onOpenBookAtPage(
                              book,
                              highlightEntries[0]?.page || bookmarks[0]?.page || book.currentPage
                            )
                          }
                          className="px-3.5 py-1.5 rounded-full text-[11px] font-bold bg-[#1DB954] text-black hover:bg-[#1ed760] flex items-center gap-1 transition-colors"
                        >
                          <span>Open Highlighted Page</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                        {highlightEntries.length === 1 && (
                          <button
                            type="button"
                            onClick={() => handleDeleteHighlightPage(book, highlightEntries[0].page)}
                            className="p-1.5 rounded-full text-rose-400/80 hover:text-rose-400 hover:bg-rose-500/15 transition-colors"
                            title={`Clear highlights on page ${highlightEntries[0].page}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Book Annotations Body (Pinned Pages & Notes) */}
                {bookmarks.length > 0 && (
                  <div className="p-4 sm:p-5 space-y-5">
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-400">
                        <Bookmark className="w-3.5 h-3.5" />
                        <span>Pinned Pages &amp; Notes ({bookmarks.length})</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {bookmarks.map(bm => {
                          const pinKey = `${book.id}_${bm.id}`;
                          const isEditing = editingPinKey === pinKey;

                          return (
                            <div
                              key={bm.id}
                              className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2 transition-colors ${
                                isDark
                                  ? 'bg-[#121212] border-[#282828] hover:border-[#383838]'
                                  : 'bg-zinc-50/70 border-zinc-200/80 hover:border-zinc-300'
                              }`}
                            >
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => onOpenBookAtPage(book, bm.page)}
                                    className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-400/15 text-amber-400 hover:bg-amber-400 hover:text-black transition-colors flex items-center gap-1"
                                    title={`Open "${book.title}" directly to page ${bm.page}`}
                                  >
                                    <span>Page {bm.page}</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </button>

                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingPinKey(isEditing ? null : pinKey);
                                        setEditingNoteDraft(bm.note || '');
                                      }}
                                      className={`p-1 rounded transition-colors ${
                                        isDark
                                          ? 'text-[#B3B3B3] hover:text-white hover:bg-white/10'
                                          : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200'
                                      }`}
                                      title="Edit note"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeletePin(book, bm.id)}
                                      className="p-1 rounded text-rose-400 hover:bg-rose-500/15 transition-colors"
                                      title="Remove pin"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {isEditing ? (
                                  <div className="space-y-2 pt-1">
                                    <textarea
                                      rows={2}
                                      dir="auto"
                                      value={editingNoteDraft}
                                      onChange={e => setEditingNoteDraft(e.target.value)}
                                      placeholder="Write your study note for this page..."
                                      className={`w-full text-xs px-2.5 py-1.5 rounded-lg border focus:outline-hidden resize-none ${
                                        isDark
                                          ? 'bg-[#1E1E1E] border-[#383838] text-white focus:border-amber-400'
                                          : 'bg-white border-zinc-300 text-zinc-900 focus:border-amber-500'
                                      }`}
                                    />
                                    <div className="flex justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setEditingPinKey(null)}
                                        className="px-2.5 py-1 rounded text-[11px] opacity-70 hover:opacity-100"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleSavePinNote(book, bm.id)}
                                        className="px-3 py-1 rounded text-[11px] font-bold bg-amber-400 text-black hover:bg-amber-300"
                                      >
                                        Save Note
                                      </button>
                                    </div>
                                  </div>
                                ) : bm.note ? (
                                  <p
                                    dir="auto"
                                    onClick={() => onOpenBookAtPage(book, bm.page)}
                                    className="text-xs leading-relaxed cursor-pointer break-words"
                                  >
                                    {bm.note}
                                  </p>
                                ) : (
                                  <p
                                    onClick={() => {
                                      setEditingPinKey(pinKey);
                                      setEditingNoteDraft('');
                                    }}
                                    className={`text-xs italic cursor-pointer ${
                                      isDark ? 'text-white/40 hover:text-white/70' : 'text-zinc-400 hover:text-zinc-600'
                                    }`}
                                  >
                                    Pinned page — tap to add a note...
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
