import React, { useState, useRef } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { Book, Booklist, AppTheme } from '../types/library';
import { getPdfBlob, storePdfBlob } from '../services/db';
import {
  Download,
  Smartphone,
  HardDriveDownload,
  Upload,
  CheckCircle2,
  X,
  Share,
  PlusSquare,
  ShieldCheck,
  Loader2,
} from 'lucide-react';

interface PWAInstallButtonProps {
  books: Book[];
  booklists: Booklist[];
  onRestoreLibrary: (books: Book[], booklists: Booklist[]) => void;
  theme: AppTheme;
}

interface BackupPayload {
  version: number;
  exportedAt: string;
  books: Book[];
  booklists: Booklist[];
  pdfBase64Map: Record<string, string>;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType = 'application/pdf'): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  books,
  booklists,
  onRestoreLibrary,
  theme,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const isOnline = useOnlineStatus();
  const [showModal, setShowModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDark = theme === 'spotify-dark';
  const isWarm = theme === 'warm-minimal';

  const modalShell = isDark
    ? 'bg-[#181818] text-white border-[#282828]'
    : isWarm
    ? 'bg-[#FAF6EE] text-[#292524] border-[#E2D9C5]'
    : 'bg-white text-zinc-900 border-zinc-200';

  const modalHeader = isDark
    ? 'bg-[#1F1F1F] border-[#282828]'
    : isWarm
    ? 'bg-[#F2EBDD] border-[#E2D9C5]'
    : 'bg-zinc-50 border-zinc-200';

  const innerCard = isDark
    ? 'bg-[#121212] border-[#282828]'
    : isWarm
    ? 'bg-[#F3EDE0] border-[#E2D9C5]'
    : 'bg-zinc-50 border-zinc-200';

  const mutedText = isDark
    ? 'text-[#B3B3B3]'
    : isWarm
    ? 'text-[#78716C]'
    : 'text-zinc-500';

  const primaryBtn = isDark
    ? 'bg-[#1DB954] text-black hover:bg-[#1ed760]'
    : isWarm
    ? 'bg-[#3D2817] text-amber-100 hover:bg-[#2B1B0E]'
    : 'bg-zinc-900 text-white hover:bg-zinc-800';

  const secondaryBtn = isDark
    ? 'bg-[#282828] hover:bg-[#333333] text-white'
    : isWarm
    ? 'bg-[#E5DEC9] hover:bg-[#D8CEB5] text-[#292524]'
    : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-900';

  const accentText = isDark ? 'text-[#1DB954]' : isWarm ? 'text-amber-800' : 'text-emerald-600';
  const accentBadgeBg = isDark
    ? 'bg-[#1DB954]/15 text-[#1DB954]'
    : isWarm
    ? 'bg-amber-900/10 text-amber-900'
    : 'bg-emerald-50 text-emerald-700';

  const handleExportFullBackup = async () => {
    setIsExporting(true);
    setStatusMsg(null);
    try {
      const pdfBase64Map: Record<string, string> = {};
      for (const book of books) {
        const key = book.pdfBlobKey || book.id;
        const blob = await getPdfBlob(key);
        if (blob) {
          pdfBase64Map[key] = await blobToBase64(blob);
        }
      }

      const payload: BackupPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        books,
        booklists,
        pdfBase64Map,
      };

      const jsonStr = JSON.stringify(payload);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `folio-offline-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatusMsg(
        `Saved ${books.length} books (with full PDF files) to your device! Keep this file in "On My iPad" in the Files app.`
      );
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to export backup.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFullBackup = async (file: File) => {
    setIsImporting(true);
    setStatusMsg(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as BackupPayload;

      if (!Array.isArray(payload.books)) {
        throw new Error('Invalid Folio backup file.');
      }

      if (payload.pdfBase64Map) {
        for (const [key, b64] of Object.entries(payload.pdfBase64Map)) {
          if (b64) {
            const pdfBlob = base64ToBlob(b64);
            await storePdfBlob(key, pdfBlob);
          }
        }
      }

      onRestoreLibrary(payload.books, Array.isArray(payload.booklists) ? payload.booklists : []);
      setStatusMsg(`Restored ${payload.books.length} books and all PDF files for offline reading!`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Could not restore backup file.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
          isDark
            ? 'bg-[#1F1F1F] border-[#333333] text-white hover:bg-[#282828]'
            : isWarm
            ? 'bg-[#EFE9DC] border-[#DED5C3] text-[#292524] hover:bg-[#E5DEC9]'
            : 'bg-zinc-100 border-zinc-200 text-zinc-900 hover:bg-zinc-200'
        }`}
        title="Install Offline iPad App & Backup PDFs"
      >
        <Smartphone className={`w-3.5 h-3.5 ${accentText}`} />
        <span>{isInstalled ? 'Offline Ready' : 'iPad Offline App'}</span>
        <span
          className={`w-2 h-2 rounded-full ${isOnline ? 'bg-[#1DB954]' : 'bg-amber-400 animate-pulse'}`}
        />
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs select-none">
          <div
            className={`w-full max-w-lg rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[88vh] transition-colors ${modalShell}`}
          >
            {/* Header */}
            <div className={`px-5 py-4 border-b flex items-center justify-between ${modalHeader}`}>
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${accentBadgeBg}`}>
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold tracking-tight">
                    100% Offline iPad App &amp; Vault
                  </h2>
                  <p className={`text-[11px] ${mutedText}`}>
                    Works without internet or when external sites/Vercel are unreachable
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className={`p-1.5 rounded-lg opacity-60 hover:opacity-100 transition-all ${
                  isDark ? 'hover:bg-[#282828]' : 'hover:bg-black/5'
                }`}
                aria-label="Close Offline modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              {/* Status Strip */}
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                  isDark
                    ? 'bg-[#1DB954]/10 border-[#1DB954]/30'
                    : isWarm
                    ? 'bg-amber-900/10 border-amber-900/20'
                    : 'bg-emerald-50 border-emerald-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className={`w-4 h-4 shrink-0 ${accentText}`} />
                  <div className="text-xs">
                    <p className="font-semibold">
                      {isInstalled
                        ? 'Installed as Standalone Offline App'
                        : 'Offline Service Worker Cached & Active'}
                    </p>
                    <p className={`text-[11px] ${mutedText}`}>
                      All UI, PDF.js reader engine, ambient audio, and {books.length} PDF books are stored locally on your device.
                    </p>
                  </div>
                </div>

                {isInstallable && !isInstalled && (
                  <button
                    onClick={install}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 shrink-0 ${primaryBtn}`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Install App</span>
                  </button>
                )}
              </div>

              {/* How to Install on iPad / iPhone so it opens without Vercel */}
              <div className={`p-4 rounded-xl border space-y-3 ${innerCard}`}>
                <h3 className={`text-xs font-bold flex items-center gap-2 ${accentText}`}>
                  <Smartphone className="w-4 h-4" />
                  <span>
                    How to Install on iPad (So It Opens Even When Vercel Is Blocked)
                  </span>
                </h3>
                <ol className={`space-y-2 text-xs leading-relaxed ${mutedText}`}>
                  <li className="flex items-start gap-2">
                    <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5 ${secondaryBtn}`}>
                      1
                    </span>
                    <span>
                      Open Folio once in <strong>Safari</strong> on your iPad while connected.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5 ${secondaryBtn}`}>
                      2
                    </span>
                    <span className="flex items-center gap-1 flex-wrap">
                      Tap the Safari <strong>Share</strong> icon{' '}
                      <Share className="w-3.5 h-3.5 inline" /> in the top bar.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5 ${secondaryBtn}`}>
                      3
                    </span>
                    <span className="flex items-center gap-1 flex-wrap">
                      Tap <strong>Add to Home Screen</strong>{' '}
                      <PlusSquare className="w-3.5 h-3.5 inline" />.
                    </span>
                  </li>
                </ol>
                <p
                  className={`text-[11px] pt-2 border-t ${mutedText} ${
                    isDark ? 'border-[#242424]' : isWarm ? 'border-[#E2D9C5]' : 'border-zinc-200'
                  }`}
                >
                  Once added to your iPad Home Screen, iPadOS saves the entire app and PDF reader locally. Even if the internet is completely cut off or restricted to domestic sites, tapping the <strong>Folio</strong> icon on your Home Screen opens immediately offline!
                  {isIOS && !isInstalled && ' (Detected iPad/iOS device — ready to Add to Home Screen!)'}
                </p>
              </div>

              {/* Full Offline Vault Backup / Restore (To iPad "Files" App) */}
              <div className={`p-4 rounded-xl border space-y-3 ${innerCard}`}>
                <div>
                  <h3 className="text-xs font-bold flex items-center gap-2">
                    <HardDriveDownload className={`w-4 h-4 ${accentText}`} />
                    <span>Offline PDF Vault Backup (Save to iPad &ldquo;Files&rdquo; App)</span>
                  </h3>
                  <p className={`text-[11px] mt-1 ${mutedText}`}>
                    Export all your books, playlists, reading progress, and raw PDF files into a single offline file on your iPad, or import PDFs straight from your iPad Files app anytime.
                  </p>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleImportFullBackup(f);
                  }}
                />

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleExportFullBackup}
                    disabled={isExporting}
                    className={`flex-1 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${primaryBtn}`}
                  >
                    {isExporting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <HardDriveDownload className="w-3.5 h-3.5" />
                    )}
                    <span>Download Full Offline Backup ({books.length} Books)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImporting}
                    className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${secondaryBtn}`}
                  >
                    {isImporting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    <span>Restore Backup</span>
                  </button>
                </div>

                {statusMsg && (
                  <p className={`text-xs rounded-lg px-3 py-2 border ${accentBadgeBg} border-current/25`}>
                    {statusMsg}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
