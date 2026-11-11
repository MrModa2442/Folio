import React, { useState, useEffect } from 'react';
import { Book, Booklist, ReadingStatus, ViewMode, SortOption, AppTheme } from './types/library';
import { INITIAL_BOOKS, INITIAL_BOOKLISTS } from './data/initialData';
import {
  filterBooks,
  sortBooks,
  toggleBooklistPrivacy,
  sanitizeBookTitle,
  sanitizeBookAuthor,
  deduplicateBooks,
} from './utils/library';
import { Navigation } from './components/Navigation';
import { Sidebar } from './components/Sidebar';
import { VirtualBookshelf } from './components/VirtualBookshelf';
import { BooklistHero } from './components/BooklistHero';
import { BookTableView } from './components/BookTableView';
import { BookGridCard } from './components/BookGridCard';
import { ImportPdfModal } from './components/ImportPdfModal';
import { CreateBooklistModal } from './components/CreateBooklistModal';
import { CollaboratorsModal } from './components/CollaboratorsModal';
import { AddBooksToListModal } from './components/AddBooksToListModal';
import { CozyPdfReader } from './components/CozyPdfReader';
import { ExploreShelvesView } from './components/ExploreShelvesView';
import { SpotifyPlayerBar } from './components/SpotifyPlayerBar';
import { TelegramChannelModal } from './components/TelegramChannelModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { SyncProgressModal } from './components/SyncProgressModal';
import { NotesHighlightsHub } from './components/NotesHighlightsHub';
import {
  fetchExploreChannelFeed,
  downloadAndImportTelegramPdf,
  normalizeChannelInput,
} from './services/telegramSync';
import { deletePdfBlob } from './services/db';
import { Search, LayoutGrid, List as ListIcon, Plus, Send, ArrowUpDown } from 'lucide-react';

// Use clean v3 storage keys to ensure a complete fresh zero-state first-time experience
const STORAGE_BOOKS_KEY = 'folio_books_v3_zero';
const STORAGE_BOOKLISTS_KEY = 'folio_booklists_v3_zero';
const STORAGE_THEME_KEY = 'folio_theme_v3';
const STORAGE_TG_CHANNEL_KEY = 'folio_tg_channel_v1';
const STORAGE_TG_AUTOSYNC_KEY = 'folio_tg_autosync_v1';

export default function App() {
  // Theme state: defaults to spotify-dark
  const [theme, setTheme] = useState<AppTheme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_THEME_KEY);
      return (stored as AppTheme) || 'spotify-dark';
    } catch {
      return 'spotify-dark';
    }
  });

  // Zero-state initialization: starts completely empty for first-time user
  // Also sanitizes and deduplicates any previously stored books so duplicates, @handles, and channel names are removed
  const [books, setBooks] = useState<Book[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_BOOKS_KEY);
      const parsed: Book[] = stored ? JSON.parse(stored) : INITIAL_BOOKS;
      return deduplicateBooks(parsed);
    } catch {
      return INITIAL_BOOKS;
    }
  });

  const [booklists, setBooklists] = useState<Booklist[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_BOOKLISTS_KEY);
      return stored ? JSON.parse(stored) : INITIAL_BOOKLISTS;
    } catch {
      return INITIAL_BOOKLISTS;
    }
  });

  // Navigation State
  const [currentTab, setCurrentTab] = useState<'library' | 'explore' | 'bookshelf' | 'notes'>('library');
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<ReadingStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [sortBy, setSortBy] = useState<SortOption>('recently-added');

  // Currently Playing / Reading Book (for Spotify Bottom Bar)
  const [activeReadingBook, setActiveReadingBook] = useState<Book | null>(() => {
    return books.find(b => b.status === 'reading') || books[0] || null;
  });

  // Modals & Fullscreen Reader
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isTelegramSyncOpen, setIsTelegramSyncOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isAddBooksModalOpen, setIsAddBooksModalOpen] = useState(false);
  const [fullscreenReaderBook, setFullscreenReaderBook] = useState<Book | null>(null);

  // Telegram Channel Auto-Sync State
  const [telegramChannel, setTelegramChannel] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_TG_CHANNEL_KEY) || '';
    } catch {
      return '';
    }
  });

  const [telegramAutoSync, setTelegramAutoSync] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_TG_AUTOSYNC_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [autoSyncedNotice, setAutoSyncedNotice] = useState<string | null>(null);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_BOOKS_KEY, JSON.stringify(books));
  }, [books]);

  useEffect(() => {
    localStorage.setItem(STORAGE_BOOKLISTS_KEY, JSON.stringify(booklists));
  }, [booklists]);

  useEffect(() => {
    localStorage.setItem(STORAGE_TG_CHANNEL_KEY, telegramChannel);
  }, [telegramChannel]);

  useEffect(() => {
    localStorage.setItem(STORAGE_TG_AUTOSYNC_KEY, String(telegramAutoSync));
  }, [telegramAutoSync]);

  const currentBooklist = selectedListId
    ? booklists.find(l => l.id === selectedListId) || null
    : null;

  const baseBooks = currentBooklist
    ? books.filter(b => currentBooklist.bookIds.includes(b.id))
    : books;

  const displayedBooks = sortBooks(
    filterBooks(deduplicateBooks(baseBooks), searchQuery, selectedStatus),
    sortBy
  );

  const readingBooksCount = books.filter(b => b.status === 'reading').length;
  const finishedBooksCount = books.filter(b => b.status === 'completed').length;
  const annotationsCount = books.reduce((sum, b) => {
    const pinsCount = b.bookmarks?.length || 0;
    const hlPagesCount = Object.values(b.highlights || {}).filter(
      strokes => Array.isArray(strokes) && strokes.length > 0
    ).length;
    return sum + pinsCount + hlPagesCount;
  }, 0);

  // Handlers
  const handleSaveBook = (book: Book, targetListId?: string) => {
    setBooks(prev => {
      const existing = prev.findIndex(
        b =>
          b.id.toLowerCase() === book.id.toLowerCase() ||
          sanitizeBookTitle(b.title).toLowerCase() === sanitizeBookTitle(book.title).toLowerCase() ||
          (b.telegramChannel &&
            book.telegramChannel &&
            b.telegramChannel.toLowerCase() === book.telegramChannel.toLowerCase() &&
            b.telegramMessageId === book.telegramMessageId)
      );
      if (existing >= 0) {
        const copy = [...prev];
        copy[existing] = {
          ...copy[existing],
          ...book,
          id: copy[existing].id,
        };
        return deduplicateBooks(copy);
      }
      return deduplicateBooks([book, ...prev]);
    });

    if (!activeReadingBook || activeReadingBook.id === book.id) {
      setActiveReadingBook(book);
    }

    if (targetListId) {
      setBooklists(prev =>
        prev.map(list => {
          if (list.id === targetListId && !list.bookIds.includes(book.id)) {
            return { ...list, bookIds: [...list.bookIds, book.id] };
          }
          return list;
        })
      );
    }
  };

  const handleUpdateBookProgress = (book: Book, newPage: number) => {
    const clamped = Math.max(1, Math.min(book.pageCount, newPage));
    const isCompleted = clamped >= book.pageCount;
    const updated: Book = {
      ...book,
      currentPage: clamped,
      status: isCompleted ? 'completed' : 'reading',
      lastRead: new Date().toISOString().split('T')[0],
    };
    handleSaveBook(updated);
    setActiveReadingBook(updated);
  };

  const handleDeleteBook = (bookId: string) => {
    const targetBook = books.find(b => b.id === bookId);
    if (targetBook?.pdfBlobKey) {
      deletePdfBlob(targetBook.pdfBlobKey).catch(() => {});
    }
    deletePdfBlob(bookId).catch(() => {});

    setBooks(prev => prev.filter(b => b.id !== bookId));
    setBooklists(prev =>
      prev.map(l => ({ ...l, bookIds: l.bookIds.filter(id => id !== bookId) }))
    );
    if (activeReadingBook?.id === bookId) {
      setActiveReadingBook(null);
    }
    if (fullscreenReaderBook?.id === bookId) {
      setFullscreenReaderBook(null);
    }
  };

  const handleRemoveFromList = (bookId: string) => {
    if (currentBooklist) {
      setBooklists(prev =>
        prev.map(l => {
          if (l.id === currentBooklist.id) {
            return { ...l, bookIds: l.bookIds.filter(id => id !== bookId) };
          }
          return l;
        })
      );
    }
  };

  const handleCreateList = (newList: Booklist) => {
    setBooklists(prev => [newList, ...prev]);
    setSelectedListId(newList.id);
    setCurrentTab('library');
  };

  const handleUpdateBooklist = (updated: Booklist) => {
    setBooklists(prev => prev.map(l => (l.id === updated.id ? updated : l)));
  };

  const handleTogglePrivacyCurrentList = () => {
    if (currentBooklist) {
      const updated = toggleBooklistPrivacy(currentBooklist, !currentBooklist.isPublic);
      handleUpdateBooklist(updated);
    }
  };

  const handleToggleSaveList = (listId: string) => {
    setBooklists(prev =>
      prev.map(l => {
        if (l.id === listId) {
          const isSaved = !l.isSavedByUser;
          return {
            ...l,
            isSavedByUser: isSaved,
            savesCount: isSaved ? l.savesCount + 1 : Math.max(0, l.savesCount - 1),
          };
        }
        return l;
      })
    );
  };

  const handleStartReadingBook = (book: Book) => {
    setActiveReadingBook(book);
    setFullscreenReaderBook(book);
  };

  // Automatic Background Sync for Newest PDF across connected Telegram Channels
  useEffect(() => {
    if (!telegramAutoSync) return;

    let cancelled = false;

    const checkNewestFromChannels = async () => {
      try {
        const feed = await fetchExploreChannelFeed(telegramChannel, false);
        if (cancelled || feed.allPdfs.length === 0) return;

        const newestPdf = feed.allPdfs[0];
        const cleanChannel = normalizeChannelInput(newestPdf.channelUsername);
        const alreadyExists = books.some(
          b =>
            (b.telegramChannel === cleanChannel && b.telegramMessageId === newestPdf.messageId) ||
            b.id === `tg_${cleanChannel}_${newestPdf.messageId}`
        );

        if (!alreadyExists) {
          const importedBook = await downloadAndImportTelegramPdf(newestPdf);
          if (!cancelled) {
            handleSaveBook(importedBook);
            setAutoSyncedNotice(
              `Synced newest PDF from @${cleanChannel}: "${importedBook.title}"`
            );
            setTimeout(() => setAutoSyncedNotice(null), 6000);
          }
        }
      } catch {
        // Silently ignore background poll errors until user opens modal
      }
    };

    checkNewestFromChannels();
    const timer = setInterval(checkNewestFromChannels, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [telegramAutoSync, telegramChannel, books]);

  const isDark = theme === 'spotify-dark';

  return (
    <div className={`h-full w-full overflow-hidden flex flex-col font-sans transition-colors duration-200 theme-${theme}`}>
      {/* Sleek Top Navigation */}
      <Navigation
        currentTab={currentTab}
        onSelectTab={tab => {
          setCurrentTab(tab);
          if (tab !== 'library') setSelectedListId(null);
        }}
        onOpenImport={() => {
          setEditingBook(null);
          setIsImportOpen(true);
        }}
        onOpenTelegramSync={() => setIsTelegramSyncOpen(true)}
        telegramAutoSync={telegramAutoSync}
        telegramChannel={telegramChannel}
        books={books}
        booklists={booklists}
        onRestoreLibrary={(restoredBooks, restoredLists) => {
          setBooks(restoredBooks);
          if (restoredLists.length > 0) {
            setBooklists(restoredLists);
          }
          if (restoredBooks.length > 0) {
            setActiveReadingBook(restoredBooks[0]);
          }
        }}
        theme={theme}
        onChangeTheme={setTheme}
      />

      <OfflineIndicator />

      {autoSyncedNotice && (
        <div className="bg-[#1DB954] text-black px-4 py-1.5 text-xs font-semibold flex items-center justify-center gap-2 shadow-sm shrink-0">
          <Send className="w-3.5 h-3.5" />
          <span>{autoSyncedNotice}</span>
        </div>
      )}

      {/* Main Workspace Frame */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Spotify-style Sidebar */}
        <Sidebar
          booklists={booklists}
          selectedListId={selectedListId}
          selectedStatus={selectedStatus}
          isNotesHubActive={currentTab === 'notes'}
          totalBooksCount={books.length}
          readingBooksCount={readingBooksCount}
          finishedBooksCount={finishedBooksCount}
          annotationsCount={annotationsCount}
          onSelectList={id => {
            setSelectedListId(id);
            setCurrentTab('library');
          }}
          onSelectStatus={st => {
            setSelectedStatus(st);
            setCurrentTab('library');
          }}
          onSelectNotesHub={() => {
            setSelectedListId(null);
            setCurrentTab('notes');
          }}
          onOpenCreateList={() => setIsCreateListOpen(true)}
          onOpenSyncModal={() => setIsSyncModalOpen(true)}
          theme={theme}
        />

        {/* Center Main View Area */}
        <main
          className={`flex-1 flex flex-col overflow-y-auto ${
            isDark ? 'bg-[#121212]' : theme === 'nordic-light' ? 'bg-white' : 'bg-[#FAF8F4]'
          }`}
        >
          {currentTab === 'notes' && (
            <NotesHighlightsHub
              books={books}
              onOpenBookAtPage={(book, page) => {
                const clamped = Math.max(1, Math.min(book.pageCount, page));
                const updated: Book = {
                  ...book,
                  currentPage: clamped,
                  status: clamped >= book.pageCount ? 'completed' : 'reading',
                  lastRead: new Date().toISOString().split('T')[0],
                };
                handleSaveBook(updated);
                handleStartReadingBook(updated);
              }}
              onUpdateBook={updated => handleSaveBook(updated)}
              theme={theme}
            />
          )}
          {currentTab === 'bookshelf' && (
            <VirtualBookshelf
              books={books}
              onOpenBook={handleStartReadingBook}
              onEditBook={book => {
                setEditingBook(book);
                setIsImportOpen(true);
              }}
              theme={theme}
            />
          )}

          {currentTab === 'explore' && (
            <ExploreShelvesView
              publicBooklists={booklists.filter(l => l.isPublic)}
              existingBooks={books}
              configuredChannels={telegramChannel}
              onSelectBooklist={id => {
                setSelectedListId(id);
                setCurrentTab('library');
              }}
              onToggleSaveList={handleToggleSaveList}
              onBookImported={(book, openImmediately) => {
                handleSaveBook(book);
                if (openImmediately) {
                  handleStartReadingBook(book);
                }
              }}
              onOpenTelegramSetup={() => setIsTelegramSyncOpen(true)}
              theme={theme}
            />
          )}

          {currentTab === 'library' && (
            <div className="flex-1 flex flex-col">
              {/* If a Booklist is active, show Spotify Playlist Hero */}
              {currentBooklist ? (
                <BooklistHero
                  booklist={currentBooklist}
                  booksInList={baseBooks}
                  onStartReading={() => {
                    if (baseBooks.length > 0) {
                      const firstUnread = baseBooks.find(b => b.status !== 'completed') || baseBooks[0];
                      handleStartReadingBook(firstUnread);
                    }
                  }}
                  onOpenShareModal={() => setIsShareModalOpen(true)}
                  onTogglePrivacy={handleTogglePrivacyCurrentList}
                  onToggleSaveList={() => handleToggleSaveList(currentBooklist.id)}
                  onOpenAddBooks={() => setIsAddBooksModalOpen(true)}
                  theme={theme}
                />
              ) : (
                /* Clean Library Header */
                <div
                  className={`p-6 border-b flex flex-wrap items-center justify-between gap-4 ${
                    isDark
                      ? 'bg-gradient-to-b from-[#1E1E1E] to-[#121212] border-[#242424]'
                      : 'bg-gradient-to-b from-zinc-100 to-white border-zinc-200'
                  }`}
                >
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight mb-1">
                      {selectedStatus === 'reading'
                        ? 'Reading'
                        : selectedStatus === 'completed'
                        ? 'Finished'
                        : 'Your Library'}
                    </h1>
                    <p className={`text-xs sm:text-sm font-medium ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
                      {books.length} {books.length === 1 ? 'PDF book' : 'PDF books'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5">
                    {/* Sort Dropdown in Library View Header */}
                    <div className="relative flex items-center">
                      <ArrowUpDown className="w-3.5 h-3.5 opacity-60 absolute left-3 pointer-events-none" />
                      <select
                        value={sortBy}
                        onChange={e => setSortBy(e.target.value as SortOption)}
                        aria-label="Sort books"
                        className={`text-xs font-medium pl-8 pr-7 py-1.5 rounded-full border appearance-none cursor-pointer focus:outline-hidden transition-colors ${
                          isDark
                            ? 'bg-[#242424] border-[#333333] text-white hover:border-[#555555]'
                            : 'bg-white border-zinc-200 text-zinc-900 hover:border-zinc-400'
                        }`}
                      >
                        <option value="recently-added">Recently Added</option>
                        <option value="title-asc">Title (A-Z)</option>
                        <option value="progress-desc">Reading Progress</option>
                      </select>
                      <span className="pointer-events-none absolute right-2.5 text-[10px] opacity-60">
                        ▾
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        setEditingBook(null);
                        setIsImportOpen(true);
                      }}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold ${
                        isDark ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-900 text-white hover:bg-zinc-800'
                      }`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Import PDF</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Minimal Filter & View Switcher Strip */}
              {books.length > 0 && (
                <div
                  className={`px-6 py-2.5 border-b flex flex-wrap items-center justify-between gap-4 text-xs ${
                    isDark ? 'border-[#242424]' : 'border-zinc-200'
                  }`}
                >
                  {/* Search */}
                  <div className="relative w-56">
                    <Search className="w-3.5 h-3.5 opacity-50 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search books..."
                      className={`w-full text-xs pl-7 pr-3 py-1 rounded-full border focus:outline-hidden ${
                        isDark
                          ? 'bg-[#242424] border-[#333333] text-white placeholder-zinc-500'
                          : 'bg-white border-zinc-200 text-zinc-900'
                      }`}
                    />
                  </div>

                  {/* Sort & View Mode */}
                  <div className="flex items-center gap-2.5">
                    {currentBooklist && (
                      <div className="relative flex items-center">
                        <ArrowUpDown className="w-3 h-3 opacity-60 absolute left-2.5 pointer-events-none" />
                        <select
                          value={sortBy}
                          onChange={e => setSortBy(e.target.value as SortOption)}
                          aria-label="Sort playlist books"
                          className={`text-xs pl-7 pr-6 py-1 rounded-full border appearance-none cursor-pointer focus:outline-hidden ${
                            isDark
                              ? 'bg-[#242424] border-[#333333] text-white'
                              : 'bg-white border-zinc-200 text-zinc-900'
                          }`}
                        >
                          <option value="recently-added">Recently Added</option>
                          <option value="title-asc">Title (A-Z)</option>
                          <option value="progress-desc">Reading Progress</option>
                        </select>
                      </div>
                    )}

                    <span className="opacity-60 text-[11px] font-mono tabular-nums">
                      {displayedBooks.length} items
                    </span>

                    <div
                      className={`flex items-center gap-0.5 p-0.5 rounded-md border ${
                        isDark ? 'bg-[#181818] border-[#282828]' : 'bg-zinc-100 border-zinc-200'
                      }`}
                    >
                      <button
                        onClick={() => setViewMode('table')}
                        className={`p-1 rounded transition-colors ${
                          viewMode === 'table'
                            ? isDark ? 'bg-[#333333] text-white' : 'bg-white text-zinc-900 shadow-xs'
                            : 'opacity-50 hover:opacity-100'
                        }`}
                        title="Table tracklist"
                        aria-label="Table view"
                      >
                        <ListIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setViewMode('grid')}
                        className={`p-1 rounded transition-colors ${
                          viewMode === 'grid'
                            ? isDark ? 'bg-[#333333] text-white' : 'bg-white text-zinc-900 shadow-xs'
                            : 'opacity-50 hover:opacity-100'
                        }`}
                        title="Grid covers"
                        aria-label="Grid view"
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Book List / Table View */}
              <div className="p-6 flex-1">
                {viewMode === 'table' ? (
                  <BookTableView
                    books={displayedBooks}
                    onOpenBook={handleStartReadingBook}
                    onEditBook={book => {
                      setEditingBook(book);
                      setIsImportOpen(true);
                    }}
                    onRemoveBook={currentBooklist ? handleRemoveFromList : undefined}
                    onDeleteBook={!currentBooklist ? handleDeleteBook : undefined}
                    isListContext={Boolean(currentBooklist)}
                    theme={theme}
                    onImportClick={() => {
                      setEditingBook(null);
                      setIsImportOpen(true);
                    }}
                  />
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {displayedBooks.map(book => (
                      <BookGridCard
                        key={book.id}
                        book={book}
                        onOpenBook={handleStartReadingBook}
                        onEditBook={b => {
                          setEditingBook(b);
                          setIsImportOpen(true);
                        }}
                        onDeleteBook={!currentBooklist ? handleDeleteBook : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Spotify Bottom Now-Playing & Reading Bar */}
      {currentTab !== 'notes' && (
        <SpotifyPlayerBar
          currentBook={activeReadingBook}
          onOpenReader={handleStartReadingBook}
          onUpdateBookProgress={handleUpdateBookProgress}
          theme={theme}
        />
      )}

      {/* Modals & Fullscreen Reader */}
      <ImportPdfModal
        isOpen={isImportOpen}
        onClose={() => {
          setIsImportOpen(false);
          setEditingBook(null);
        }}
        onBookImported={handleSaveBook}
        onDeleteBook={handleDeleteBook}
        booklists={booklists}
        editingBook={editingBook}
      />

      <TelegramChannelModal
        isOpen={isTelegramSyncOpen}
        onClose={() => setIsTelegramSyncOpen(false)}
        channel={telegramChannel}
        onChangeChannel={setTelegramChannel}
        autoSync={telegramAutoSync}
        onToggleAutoSync={setTelegramAutoSync}
        existingBooks={books}
        onBookImported={handleSaveBook}
      />

      <CreateBooklistModal
        isOpen={isCreateListOpen}
        onClose={() => setIsCreateListOpen(false)}
        onCreateList={handleCreateList}
      />

      <SyncProgressModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        books={books}
        booklists={booklists}
        onApplySyncPayload={({ booksProgress, booklists: syncedLists }) => {
          setBooks(prev =>
            prev.map(book => {
              const match = booksProgress.find(
                p => p.id === book.id || p.title.toLowerCase() === book.title.toLowerCase()
              );
              if (!match) return book;
              const mergedPage = Math.max(book.currentPage, match.currentPage || 1);
              return {
                ...book,
                currentPage: mergedPage,
                status: mergedPage >= book.pageCount ? 'completed' : match.status || book.status,
                bookmarks: match.bookmarks && match.bookmarks.length > 0 ? match.bookmarks : book.bookmarks,
                highlights:
                  match.highlights && Object.keys(match.highlights).length > 0
                    ? { ...(book.highlights || {}), ...match.highlights }
                    : book.highlights,
              };
            })
          );
          if (syncedLists && syncedLists.length > 0) {
            setBooklists(prev => {
              const existingIds = new Set(prev.map(l => l.id));
              const additions = syncedLists.filter(l => !existingIds.has(l.id));
              return [...prev, ...additions];
            });
          }
        }}
      />

      {currentBooklist && (
        <>
          <CollaboratorsModal
            isOpen={isShareModalOpen}
            onClose={() => setIsShareModalOpen(false)}
            booklist={currentBooklist}
            onUpdateBooklist={handleUpdateBooklist}
          />

          <AddBooksToListModal
            isOpen={isAddBooksModalOpen}
            onClose={() => setIsAddBooksModalOpen(false)}
            booklist={currentBooklist}
            allBooks={books}
            onUpdateBooklist={handleUpdateBooklist}
          />
        </>
      )}

      {fullscreenReaderBook && (
        <CozyPdfReader
          book={fullscreenReaderBook}
          onClose={() => setFullscreenReaderBook(null)}
          onUpdateBook={updated => {
            handleSaveBook(updated);
            setFullscreenReaderBook(updated);
          }}
          onDeleteBook={handleDeleteBook}
        />
      )}
    </div>
  );
}
