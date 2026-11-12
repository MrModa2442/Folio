import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  Upload,
  Smartphone,
  BookOpen,
  Cloud,
  LogOut,
  RefreshCw,
  UserCheck,
  Info,
  HardDrive,
  ShieldCheck,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { AppTheme, Book, Booklist } from '../types/library';
import {
  signInWithGooglePopup,
  signOutFromFolio,
  syncBooksWithCloudSql,
  fetchCloudSqlLibrary,
  syncBookToFirestore,
  CloudSqlSyncResponse,
} from '../services/cloudSync';

interface SyncProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  books: Book[];
  booklists: Booklist[];
  currentUser?: User | null;
  theme?: AppTheme;
  onApplySyncPayload: (payload: {
    booksProgress: Array<{
      id: string;
      title: string;
      currentPage: number;
      pageCount: number;
      status: Book['status'];
      bookmarks?: Book['bookmarks'];
      highlights?: Book['highlights'];
    }>;
    booklists?: Booklist[];
  }) => void;
}

function encodeBase64Unicode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeBase64Unicode(base64: string): string {
  const binary = atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export const SyncProgressModal: React.FC<SyncProgressModalProps> = ({
  isOpen,
  onClose,
  books,
  booklists,
  currentUser = null,
  theme = 'spotify-dark',
  onApplySyncPayload,
}) => {
  const [activeTab, setActiveTab] = useState<'cloud' | 'export' | 'import'>('cloud');
  const [copied, setCopied] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCloudWorking, setIsCloudWorking] = useState(false);
  const [cloudData, setCloudData] = useState<CloudSqlSyncResponse | null>(null);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isInfoPinned, setIsInfoPinned] = useState(false);

  const isDark = theme === 'spotify-dark';
  const isWarm = theme === 'warm-minimal';

  const modalShell = isDark
    ? 'bg-[#181818] text-white border-white/10'
    : isWarm
    ? 'bg-[#FAF6EE] text-[#292524] border-[#E2D9C5]'
    : 'bg-white text-zinc-900 border-zinc-200';

  const modalHeader = isDark
    ? 'border-white/10'
    : isWarm
    ? 'bg-[#F2EBDD] border-[#E2D9C5]'
    : 'bg-zinc-50 border-zinc-200';

  const innerCard = isDark
    ? 'bg-black/30 border-white/10'
    : isWarm
    ? 'bg-[#F3EDE0] border-[#E2D9C5]'
    : 'bg-zinc-50 border-zinc-200';

  const inputField = isDark
    ? 'bg-[#242424] border-white/10 text-white placeholder-[#737373]'
    : isWarm
    ? 'bg-white border-[#D5C9B8] text-[#292524] placeholder-[#8A7968]'
    : 'bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400';

  const mutedText = isDark
    ? 'text-[#B3B3B3]'
    : isWarm
    ? 'text-[#78716C]'
    : 'text-zinc-500';

  const primaryBtn = isDark
    ? 'bg-[#1ED760] hover:bg-[#1fdf64] text-black'
    : isWarm
    ? 'bg-[#3D2817] hover:bg-[#2B1B0E] text-amber-100'
    : 'bg-zinc-900 hover:bg-zinc-800 text-white';

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    let mounted = true;
    fetchCloudSqlLibrary()
      .then(res => {
        if (mounted) setCloudData(res);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [isOpen, currentUser]);

  const syncToken = useMemo(() => {
    const payload = {
      v: 1,
      ts: Date.now(),
      booksProgress: books.map(b => ({
        id: b.id,
        title: b.title,
        currentPage: b.currentPage,
        pageCount: b.pageCount,
        status: b.status,
        bookmarks: b.bookmarks,
        highlights: b.highlights,
      })),
      booklists,
    };
    try {
      return 'FOLIO1:' + encodeBase64Unicode(JSON.stringify(payload));
    } catch {
      return '';
    }
  }, [books, booklists]);

  const matrixCells = useMemo(() => {
    const size = 15;
    const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
    let hash = 2166136261;
    for (let i = 0; i < syncToken.length; i++) {
      hash ^= syncToken.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    const drawFinder = (r0: number, c0: number) => {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const isBorder = r === 0 || r === 4 || c === 0 || c === 4;
          const isCenter = r === 2 && c === 2;
          grid[r0 + r][c0 + c] = isBorder || isCenter;
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(0, size - 5);
    drawFinder(size - 5, 0);

    let seed = Math.abs(hash) || 1234567;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const inFinder =
          (r < 5 && c < 5) ||
          (r < 5 && c >= size - 5) ||
          (r >= size - 5 && c < 5);
        if (inFinder) continue;
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        grid[r][c] = (seed & 1) === 1;
      }
    }
    return grid;
  }, [syncToken]);

  if (!isOpen) return null;

  const showInfoPopover = isInfoOpen || isInfoPinned;

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsCloudWorking(true);
    try {
      const user = await signInWithGooglePopup();
      for (const b of books) {
        await syncBookToFirestore(user, b).catch(() => {});
      }
      const sqlSynced = await syncBooksWithCloudSql(books);
      setCloudData(sqlSynced);
      setStatusMessage(
        `Signed in as ${user.displayName || user.email} and synced ${books.length} books!`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setIsCloudWorking(false);
    }
  };

  const handleCloudSyncNow = async () => {
    if (!currentUser) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setIsCloudWorking(true);
    try {
      for (const b of books) {
        await syncBookToFirestore(currentUser, b).catch(() => {});
      }
      const sqlSynced = await syncBooksWithCloudSql(books);
      setCloudData(sqlSynced);

      if (sqlSynced.books.length > 0) {
        onApplySyncPayload({
          booksProgress: sqlSynced.books.map(sb => ({
            id: sb.bookKey,
            title: sb.title,
            currentPage: sb.currentPage,
            pageCount: sb.totalPages,
            status: sb.currentPage >= sb.totalPages ? 'completed' : 'reading',
          })),
        });
      }

      setStatusMessage(
        `Synced ${sqlSynced.books.length} books & ${sqlSynced.notes.length} pinned notes to Cloud!`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Cloud sync failed.');
    } finally {
      setIsCloudWorking(false);
    }
  };

  const handleSignOut = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    await signOutFromFolio();
    setCloudData(null);
    setStatusMessage('Signed out of cloud account.');
  };

  const handleCopyToken = async () => {
    try {
      await navigator.clipboard.writeText(syncToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMessage('Could not copy automatically. Select and copy the code manually.');
    }
  };

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    const raw = importCode.trim();
    if (!raw) {
      setErrorMessage('Paste a Folio Sync Code first.');
      return;
    }

    try {
      const cleaned = raw.startsWith('FOLIO1:') ? raw.slice(7) : raw;
      const jsonStr = decodeBase64Unicode(cleaned);
      const parsed = JSON.parse(jsonStr);
      if (!parsed || !Array.isArray(parsed.booksProgress)) {
        throw new Error('Invalid sync code format');
      }
      onApplySyncPayload({
        booksProgress: parsed.booksProgress,
        booklists: parsed.booklists,
      });
      setStatusMessage(
        `Synced ${parsed.booksProgress.length} book records, bookmarks, and highlights!`
      );
      setImportCode('');
    } catch {
      setErrorMessage('Invalid or corrupted Folio Sync Code. Make sure you copied the full code.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in">
      <div
        className={`border rounded-xl w-full max-w-lg overflow-visible shadow-2xl relative transition-colors ${modalShell}`}
      >
        <div className={`flex items-center justify-between px-6 py-4 border-b rounded-t-xl ${modalHeader}`}>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Smartphone className={`w-5 h-5 ${isDark ? 'text-[#1ED760]' : isWarm ? 'text-amber-800' : 'text-emerald-600'}`} />
            <h2 className="font-serif text-lg font-bold">
              Sign In &amp; Cloud Sync
            </h2>

            {/* Interactive Hover / Click Info Trigger */}
            <div
              className="relative"
              onMouseEnter={() => setIsInfoOpen(true)}
              onMouseLeave={() => setIsInfoOpen(false)}
            >
              <button
                type="button"
                onClick={() => setIsInfoPinned(prev => !prev)}
                className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
                  showInfoPopover
                    ? isDark
                      ? 'bg-sky-400/20 border-sky-400/50 text-sky-300'
                      : isWarm
                      ? 'bg-amber-900/15 border-amber-800/40 text-amber-950'
                      : 'bg-sky-50 border-sky-300 text-sky-800'
                    : isDark
                    ? 'bg-white/5 border-white/10 text-[#B3B3B3] hover:text-white hover:border-white/25'
                    : isWarm
                    ? 'bg-[#E5DEC9]/70 border-[#D5C9B8] text-[#5C4F42] hover:text-[#292524]'
                    : 'bg-zinc-100 border-zinc-200 text-zinc-600 hover:text-zinc-900'
                }`}
                aria-label="How local and cloud storage work"
              >
                <Info className={`w-3.5 h-3.5 shrink-0 ${isDark ? 'text-sky-400' : isWarm ? 'text-amber-800' : 'text-sky-600'}`} />
                <span>How it works</span>
              </button>

              {showInfoPopover && (
                <div
                  className={`absolute left-0 sm:left-auto sm:-right-12 top-full mt-2.5 w-80 sm:w-96 z-50 border rounded-xl p-4 shadow-2xl text-left space-y-3 animate-fade-in ${
                    isDark
                      ? 'bg-[#202020] border-sky-400/35 text-white'
                      : isWarm
                      ? 'bg-[#FAF6EE] border-[#D5C9B8] text-[#292524]'
                      : 'bg-white border-zinc-200 text-zinc-900'
                  }`}
                >
                  <div
                    className={`flex items-center justify-between border-b pb-2 ${
                      isDark ? 'border-white/10' : isWarm ? 'border-[#E2D9C5]' : 'border-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-6 h-6 rounded-lg flex items-center justify-center ${
                          isDark
                            ? 'bg-sky-400/15 text-sky-400'
                            : isWarm
                            ? 'bg-amber-900/15 text-amber-800'
                            : 'bg-sky-50 text-sky-600'
                        }`}
                      >
                        <Info className="w-3.5 h-3.5" />
                      </span>
                      <span className="text-xs font-bold">
                        Local Storage vs. Cloud Sync
                      </span>
                    </div>
                    {isInfoPinned && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          setIsInfoPinned(false);
                          setIsInfoOpen(false);
                        }}
                        className={`${mutedText} hover:opacity-100 p-0.5`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="space-y-2.5 text-xs leading-relaxed">
                    <div className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${innerCard}`}>
                      <HardDrive className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className={`font-semibold ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>
                          If You Don&apos;t Sign In (Browser Local Only)
                        </p>
                        <p className={`text-[11px] mt-0.5 ${mutedText}`}>
                          Your books, reading progress, highlights, and pinned notes are saved{' '}
                          <span className="font-semibold">
                            only inside this browser&apos;s local storage
                          </span>
                          . You won&apos;t be able to auto-sync across multiple devices, and clearing browser data can reset it.
                        </p>
                      </div>
                    </div>

                    <div className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${innerCard}`}>
                      <Cloud className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? 'text-sky-400' : 'text-sky-600'}`} />
                      <div>
                        <p className={`font-semibold ${isDark ? 'text-sky-300' : 'text-sky-800'}`}>
                          When You Sign In (Instant Multi-Device Sync)
                        </p>
                        <p className={`text-[11px] mt-0.5 ${mutedText}`}>
                          Everything already stored in your browser is{' '}
                          <span className="font-semibold">
                            automatically backed up to your cloud account
                          </span>
                          —nothing is lost, and your progress, pins, and vocabulary stay synced across your phone, tablet, and computer.
                        </p>
                      </div>
                    </div>

                    <div className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${innerCard}`}>
                      <ShieldCheck className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? 'text-[#1ED760]' : 'text-emerald-600'}`} />
                      <div>
                        <p className={`font-semibold ${isDark ? 'text-[#1ED760]' : 'text-emerald-700'}`}>
                          100% Private to You
                        </p>
                        <p className={`text-[11px] mt-0.5 ${mutedText}`}>
                          Your personal library, notes, and saved words are locked to your Google account—no one else can view or access them.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-full transition-colors ${mutedText} hover:opacity-100 ${
              isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Summary Stats Banner */}
          <div className={`grid grid-cols-2 gap-2.5 border rounded-lg p-3 ${innerCard}`}>
            <div className="flex items-center gap-2.5">
              <BookOpen className={`w-4 h-4 shrink-0 ${isDark ? 'text-[#1ED760]' : isWarm ? 'text-amber-800' : 'text-emerald-600'}`} />
              <div>
                <div className="text-xs font-bold">{books.length} Books</div>
                <div className={`text-[10px] ${mutedText}`}>Pages, Pins &amp; Highlights</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <Cloud className={`w-4 h-4 shrink-0 ${isDark ? 'text-sky-400' : 'text-sky-600'}`} />
              <div>
                <div className="text-xs font-bold">
                  {currentUser ? 'Cloud Connected' : 'Browser Local Mode'}
                </div>
                <div className={`text-[10px] truncate max-w-[140px] ${mutedText}`}>
                  {currentUser ? currentUser.email || currentUser.displayName : 'Saved on this device only'}
                </div>
              </div>
            </div>
          </div>

          {/* Mode Tabs */}
          <div
            className={`grid grid-cols-3 gap-1 p-1 rounded-lg border ${
              isDark
                ? 'bg-black/40 border-white/5'
                : isWarm
                ? 'bg-[#EBE3D2] border-[#DED5C3]'
                : 'bg-zinc-100 border-zinc-200'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setActiveTab('cloud');
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-all ${
                activeTab === 'cloud'
                  ? isDark
                    ? 'bg-[#282828] text-white shadow'
                    : isWarm
                    ? 'bg-[#FAF6EE] text-[#292524] shadow-xs'
                    : 'bg-white text-zinc-900 shadow-xs'
                  : mutedText
              }`}
            >
              <Cloud className={`w-3.5 h-3.5 ${isDark ? 'text-sky-400' : 'text-sky-600'}`} />
              Cloud Sync
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('export');
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-all ${
                activeTab === 'export'
                  ? isDark
                    ? 'bg-[#282828] text-white shadow'
                    : isWarm
                    ? 'bg-[#FAF6EE] text-[#292524] shadow-xs'
                    : 'bg-white text-zinc-900 shadow-xs'
                  : mutedText
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              Send Code
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('import');
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-all ${
                activeTab === 'import'
                  ? isDark
                    ? 'bg-[#282828] text-white shadow'
                    : isWarm
                    ? 'bg-[#FAF6EE] text-[#292524] shadow-xs'
                    : 'bg-white text-zinc-900 shadow-xs'
                  : mutedText
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              Paste Code
            </button>
          </div>

          {activeTab === 'cloud' ? (
            <div className="space-y-4">
              {!currentUser ? (
                <div className={`border rounded-xl p-5 text-center space-y-3.5 ${innerCard}`}>
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto ${
                      isDark ? 'bg-sky-400/15 text-sky-400' : 'bg-sky-100 text-sky-600'
                    }`}
                  >
                    <Cloud className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold">
                      Sign in to Sync Across All Devices
                    </h3>
                    <p className={`text-xs leading-relaxed ${mutedText}`}>
                      Without signing in, your data stays only in this browser&apos;s local storage. Sign in with Google to back up and sync across your phone, tablet, and computer.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isCloudWorking}
                    onClick={handleGoogleSignIn}
                    className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${primaryBtn}`}
                  >
                    <UserCheck className="w-4 h-4" />
                    <span>{isCloudWorking ? 'Connecting...' : 'Sign in with Google'}</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3.5">
                  <div className={`flex items-center justify-between border rounded-xl p-3.5 ${innerCard}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      {currentUser.photoURL ? (
                        <img
                          src={currentUser.photoURL}
                          alt={currentUser.displayName || 'Reader'}
                          className="w-9 h-9 rounded-full object-cover border border-black/10"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-emerald-500/20 text-emerald-600 flex items-center justify-center font-bold text-sm">
                          {(currentUser.displayName || currentUser.email || 'R')[0].toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">
                          {currentUser.displayName || 'Reader'}
                        </p>
                        <p className={`text-[11px] truncate ${mutedText}`}>{currentUser.email}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className={`px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 shrink-0 ${
                        isDark
                          ? 'bg-white/5 hover:bg-white/10 text-[#B3B3B3] hover:text-white'
                          : 'bg-black/5 hover:bg-black/10 text-zinc-700'
                      }`}
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>

                  {cloudData && (
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className={`p-2.5 rounded-lg border ${innerCard}`}>
                        <div className="text-sm font-bold">{cloudData.books.length}</div>
                        <div className={`text-[10px] ${mutedText}`}>Synced Books</div>
                      </div>
                      <div className={`p-2.5 rounded-lg border ${innerCard}`}>
                        <div className="text-sm font-bold text-amber-500">
                          {cloudData.notes.length}
                        </div>
                        <div className={`text-[10px] ${mutedText}`}>Pinned Notes</div>
                      </div>
                      <div className={`p-2.5 rounded-lg border ${innerCard}`}>
                        <div className="text-sm font-bold text-sky-500">
                          {cloudData.vocabulary.length}
                        </div>
                        <div className={`text-[10px] ${mutedText}`}>Saved Words</div>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={isCloudWorking}
                    onClick={handleCloudSyncNow}
                    className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${primaryBtn}`}
                  >
                    <RefreshCw className={`w-4 h-4 ${isCloudWorking ? 'animate-spin' : ''}`} />
                    <span>
                      {isCloudWorking ? 'Syncing with Cloud...' : 'Sync Library & Notes Now'}
                    </span>
                  </button>
                </div>
              )}

              {errorMessage && (
                <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-500">
                  {errorMessage}
                </div>
              )}

              {statusMessage && (
                <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-600 font-medium">
                  {statusMessage}
                </div>
              )}
            </div>
          ) : activeTab === 'export' ? (
            <div className="space-y-4">
              <div className={`flex items-center gap-4 border rounded-lg p-4 ${innerCard}`}>
                <div className="bg-white p-2.5 rounded-lg shrink-0 shadow-md border border-black/10">
                  <svg width="90" height="90" viewBox="0 0 15 15" shapeRendering="crispEdges">
                    {matrixCells.map((row, rIdx) =>
                      row.map((cell, cIdx) =>
                        cell ? (
                          <rect
                            key={`${rIdx}-${cIdx}`}
                            x={cIdx}
                            y={rIdx}
                            width={1}
                            height={1}
                            fill="#121212"
                          />
                        ) : null
                      )
                    )}
                  </svg>
                </div>
                <div className={`space-y-1.5 text-xs ${mutedText}`}>
                  <p className="font-semibold">Instant iPad ↔ Phone Sync</p>
                  <p className="leading-relaxed">
                    Copy this compact Sync Code and paste it on your other device to sync page numbers, pins, and highlights offline.
                  </p>
                </div>
              </div>

              <div>
                <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-1.5 ${mutedText}`}>
                  Your Folio Sync Code
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={syncToken}
                    onClick={e => (e.target as HTMLInputElement).select()}
                    className={`flex-1 border rounded-md px-3 py-2 text-xs font-mono focus:outline-none ${inputField}`}
                  />
                  <button
                    type="button"
                    onClick={handleCopyToken}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-md font-bold text-xs transition-all shrink-0 ${primaryBtn}`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy Code
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleImportSubmit} className="space-y-4">
              <div>
                <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-1.5 ${mutedText}`}>
                  Paste Sync Code from Other Device
                </label>
                <textarea
                  rows={4}
                  value={importCode}
                  onChange={e => setImportCode(e.target.value)}
                  placeholder="FOLIO1:eyJ2IjoxLC..."
                  className={`w-full border rounded-md px-3.5 py-2.5 text-xs font-mono focus:outline-none resize-none ${inputField}`}
                />
              </div>

              {errorMessage && (
                <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-500">
                  {errorMessage}
                </div>
              )}

              {statusMessage && (
                <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-600 font-medium">
                  {statusMessage}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${mutedText}`}
                >
                  Close
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 rounded-full text-xs font-bold transition-all ${primaryBtn}`}
                >
                  Apply Sync Code
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
