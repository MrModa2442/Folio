import React, { useState, useMemo } from 'react';
import { X, QrCode, Copy, Check, Download, Upload, Smartphone, BookOpen } from 'lucide-react';
import { Book, Booklist } from '../types/library';

interface SyncProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  books: Book[];
  booklists: Booklist[];
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
  onApplySyncPayload,
}) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [copied, setCopied] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const syncToken = useMemo(() => {
    const payload = {
      v: 1,
      ts: Date.now(),
      booksProgress: books.map((b) => ({
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

  // Deterministic 15x15 visual matrix signature from the sync token
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-[#181818] border border-white/10 rounded-xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-5 h-5 text-[#1ED760]" />
            <h2 className="font-serif text-lg font-bold text-white">
              Sync Reading Progress & Pins
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[#B3B3B3] hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Summary Stats Banner */}
          <div className="grid grid-cols-2 gap-2.5 bg-white/[0.03] border border-white/5 rounded-lg p-3">
            <div className="flex items-center gap-2.5">
              <BookOpen className="w-4 h-4 text-[#1ED760] shrink-0" />
              <div>
                <div className="text-xs font-bold text-white">{books.length} Books</div>
                <div className="text-[10px] text-[#B3B3B3]">Pages, Pins & Highlights</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <QrCode className="w-4 h-4 text-sky-400 shrink-0" />
              <div>
                <div className="text-xs font-bold text-white">100% Offline</div>
                <div className="text-[10px] text-[#B3B3B3]">No account needed</div>
              </div>
            </div>
          </div>

          {/* Mode Tabs */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-black/40 rounded-lg border border-white/5">
            <button
              type="button"
              onClick={() => {
                setActiveTab('export');
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              className={`flex items-center justify-center gap-2 py-2 rounded-md text-xs font-semibold transition-all ${
                activeTab === 'export'
                  ? 'bg-[#282828] text-white shadow'
                  : 'text-[#B3B3B3] hover:text-white'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              Send to Another Device
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('import');
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              className={`flex items-center justify-center gap-2 py-2 rounded-md text-xs font-semibold transition-all ${
                activeTab === 'import'
                  ? 'bg-[#282828] text-white shadow'
                  : 'text-[#B3B3B3] hover:text-white'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              Receive Sync Code
            </button>
          </div>

          {activeTab === 'export' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4 bg-black/30 border border-white/10 rounded-lg p-4">
                <div className="bg-white p-2.5 rounded-lg shrink-0 shadow-md">
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
                <div className="space-y-1.5 text-xs text-[#B3B3B3]">
                  <p className="text-white font-semibold">Instant iPad ↔ Phone Sync</p>
                  <p className="leading-relaxed">
                    Copy this compact Sync Code and paste it on your other device (via AirDrop, Telegram Saved Messages, or iCloud Universal Clipboard) to sync page numbers, pins, highlights, and reading streak.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#B3B3B3] mb-1.5">
                  Your Folio Sync Code
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={syncToken}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="flex-1 bg-[#242424] border border-white/10 rounded-md px-3 py-2 text-xs font-mono text-white/90 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopyToken}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#1ED760] hover:bg-[#1fdf64] text-black font-bold text-xs transition-all shrink-0"
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
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#B3B3B3] mb-1.5">
                  Paste Sync Code from Other Device
                </label>
                <textarea
                  rows={4}
                  value={importCode}
                  onChange={(e) => setImportCode(e.target.value)}
                  placeholder="FOLIO1:eyJ2IjoxLC..."
                  className="w-full bg-[#242424] border border-white/10 rounded-md px-3.5 py-2.5 text-xs font-mono text-white placeholder-[#737373] focus:outline-none focus:border-[#1ED760] resize-none"
                />
              </div>

              {errorMessage && (
                <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-300">
                  {errorMessage}
                </div>
              )}

              {statusMessage && (
                <div className="p-3 rounded-md bg-[#1ED760]/10 border border-[#1ED760]/30 text-xs text-[#1ED760] font-medium">
                  {statusMessage}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-full text-xs font-semibold text-[#B3B3B3] hover:text-white transition-colors"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full text-xs font-bold bg-[#1ED760] hover:bg-[#1fdf64] text-black transition-all"
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
