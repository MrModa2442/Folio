import React, { useState, useEffect } from 'react';
import { AppTheme, Book, TelegramConfigStatus, TelegramPdfItem } from '../types/library';
import {
  fetchTelegramStatus,
  fetchExploreChannelFeed,
  downloadAndImportTelegramPdf,
  normalizeChannelInput,
  normalizeMultipleChannels,
  getStoredTelegramSession,
  setStoredTelegramSession,
} from '../services/telegramSync';
import {
  X,
  Send,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  Sparkles,
  Radio,
  Smartphone,
  LogOut,
  Copy,
  Check,
  Server,
} from 'lucide-react';

interface TelegramChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel: string;
  onChangeChannel: (channel: string) => void;
  autoSync: boolean;
  onToggleAutoSync: (enabled: boolean) => void;
  existingBooks: Book[];
  onBookImported: (book: Book) => void;
  theme?: AppTheme;
}

export const TelegramChannelModal: React.FC<TelegramChannelModalProps> = ({
  isOpen,
  onClose,
  channel,
  onChangeChannel,
  autoSync,
  onToggleAutoSync,
  existingBooks,
  onBookImported,
  theme = 'spotify-dark',
}) => {
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

  const inputClass = isDark
    ? 'bg-[#121212] border-[#333333] text-white placeholder-zinc-500 focus:border-[#1DB954]'
    : isWarm
    ? 'bg-white border-[#D5C9B8] text-[#292524] placeholder-[#8A7968] focus:border-[#3D2817]'
    : 'bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400 focus:border-zinc-900';

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
  const [status, setStatus] = useState<TelegramConfigStatus>(() => ({
    configured: Boolean(getStoredTelegramSession()),
    hasApiId: true,
    hasApiHash: true,
    hasSession: Boolean(getStoredTelegramSession()),
    defaultChannel: '',
  }));
  const [channelInput, setChannelInput] = useState(channel);
  const [pdfs, setPdfs] = useState<TelegramPdfItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isSyncingNewest, setIsSyncingNewest] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [copiedSession, setCopiedSession] = useState(false);

  // Stateless Phone Login State
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [pendingSession, setPendingSession] = useState('');
  const [twoFaPassword, setTwoFaPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [isAuthBusy, setIsAuthBusy] = useState(false);

  useEffect(() => {
    setChannelInput(channel);
  }, [channel]);

  const refreshStatus = () => {
    fetchTelegramStatus().then(st => {
      setStatus(st);
      if (!channelInput && st.defaultChannel) {
        setChannelInput(st.defaultChannel);
        onChangeChannel(st.defaultChannel);
      }
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    setErrorMessage(null);
    setSuccessBanner(null);
    refreshStatus();
  }, [isOpen]);

  if (!isOpen) return null;

  const isBookAlreadyImported = (item: TelegramPdfItem) => {
    const cleanCh = normalizeChannelInput(item.channelUsername);
    const itemTitle = (item.cleanTitle || item.fileName.replace(/\.pdf$/i, '')).toLowerCase().trim();
    return existingBooks.some(
      b =>
        (b.telegramChannel?.toLowerCase() === cleanCh && b.telegramMessageId === item.messageId) ||
        b.id.toLowerCase() === `tg_${cleanCh}_${item.messageId}` ||
        (itemTitle && b.title.toLowerCase().trim() === itemTitle)
    );
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim()) {
      setErrorMessage('Enter your phone number with country code (e.g. +1234567890).');
      return;
    }

    setIsAuthBusy(true);
    setErrorMessage(null);
    setSuccessBanner(null);

    try {
      const res = await fetch('/api/telegram/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phoneNumber.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false || data.error) {
        setErrorMessage(data.error || 'Could not send login code.');
        return;
      }
      setPhoneCodeHash(data.phoneCodeHash || '');
      setPendingSession(data.pendingSession || '');
      setCodeSent(true);
      setSuccessBanner('Code sent! Check your Telegram app for a 5-digit login code.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send login code.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneCode.trim()) {
      setErrorMessage('Enter the 5-digit code sent to your Telegram app.');
      return;
    }

    setIsAuthBusy(true);
    setErrorMessage(null);
    setSuccessBanner(null);

    try {
      const res = await fetch('/api/telegram/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phoneNumber.trim(),
          phoneCode: phoneCode.trim(),
          phoneCodeHash,
          pendingSession,
          password: twoFaPassword.trim(),
        }),
      });
      const data = await res.json();
      if (data.needsPassword) {
        setNeedsPassword(true);
        setErrorMessage(data.error);
        return;
      }
      if (!res.ok || data.ok === false || data.error) {
        setErrorMessage(data.error || 'Failed to verify login code.');
        return;
      }

      if (data.sessionString) {
        setStoredTelegramSession(data.sessionString);
      }

      setCodeSent(false);
      setNeedsPassword(false);
      setPhoneCode('');
      setTwoFaPassword('');
      refreshStatus();

      const targetChannels = normalizeMultipleChannels(channelInput || '@ocbooks').join(', ') || 'ocbooks';
      onChangeChannel(targetChannels);
      setSuccessBanner('Connected! Baking @ocbooks catalog & session directly into the app for Vercel...');
      const feed = await fetchExploreChannelFeed(targetChannels, true);
      setPdfs(feed.allPdfs);
      setSuccessBanner(
        `Saved ${feed.allPdfs.length} books & your session directly into the app code (src/data/builtInExploreCatalog.json)! Ready for Vercel with zero setup needed.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to verify code.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    setStoredTelegramSession('');
    await fetch('/api/telegram/auth/logout', { method: 'POST' }).catch(() => {});
    setPdfs([]);
    setCodeSent(false);
    refreshStatus();
  };

  const handleScanChannel = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const channels = normalizeMultipleChannels(channelInput);
    if (channels.length === 0) {
      setErrorMessage('Enter one or more Telegram channels separated by commas (e.g. @Channel1, @Channel2).');
      return;
    }

    const joined = channels.join(', ');
    onChangeChannel(joined);
    setIsLoadingList(true);
    setErrorMessage(null);
    setSuccessBanner(null);

    try {
      const feed = await fetchExploreChannelFeed(joined, true);
      setPdfs(feed.allPdfs);
      if (feed.sessionInvalidated) {
        refreshStatus();
      }
      if (feed.allPdfs.length === 0) {
        setErrorMessage(
          feed.sessionInvalidated
            ? 'Your previous Telegram session was reset because it was active in two locations simultaneously. Please sign in with your phone number above to scan new channels.'
            : `Scanned ${channels.length} channel(s), but no PDF files were found in recent messages.`
        );
      } else {
        setSuccessBanner(
          `Loaded ${feed.allPdfs.length} PDF books across ${feed.channels.length} channel(s)! They are now visible in Explore.`
        );
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to read channels.');
    } finally {
      setIsLoadingList(false);
    }
  };

  const handleImportSinglePdf = async (item: TelegramPdfItem) => {
    const key = `${item.channelUsername}_${item.messageId}`;
    setDownloadingId(key);
    setErrorMessage(null);
    setSuccessBanner(null);

    try {
      const importedBook = await downloadAndImportTelegramPdf(item);
      onBookImported(importedBook);
      setSuccessBanner(`Imported "${importedBook.title}" (${importedBook.pageCount} pages) into your library!`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to download PDF from Telegram.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleSyncNewestPdfNow = async () => {
    const channels = normalizeMultipleChannels(channelInput);
    if (channels.length === 0) {
      setErrorMessage('Please enter at least one Telegram channel username first.');
      return;
    }

    const joined = channels.join(', ');
    onChangeChannel(joined);
    setIsSyncingNewest(true);
    setErrorMessage(null);
    setSuccessBanner(null);

    try {
      const feed = await fetchExploreChannelFeed(joined, true);
      setPdfs(feed.allPdfs);

      if (feed.allPdfs.length === 0) {
        setErrorMessage('No PDF documents found in the specified channel(s).');
        return;
      }

      const newestPdf = feed.allPdfs[0];
      if (isBookAlreadyImported(newestPdf)) {
        setSuccessBanner(`Newest PDF ("${newestPdf.fileName}") is already in your Folio library!`);
        return;
      }

      const key = `${newestPdf.channelUsername}_${newestPdf.messageId}`;
      setDownloadingId(key);
      const importedBook = await downloadAndImportTelegramPdf(newestPdf);
      onBookImported(importedBook);
      setSuccessBanner(
        `Auto-downloaded newest PDF: "${importedBook.title}" (${importedBook.pageCount} pages)`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to sync newest PDF.');
    } finally {
      setDownloadingId(null);
      setIsSyncingNewest(false);
    }
  };

  const handleCopySessionForServer = () => {
    const session = getStoredTelegramSession();
    if (!session) return;
    navigator.clipboard.writeText(session);
    setCopiedSession(true);
    setTimeout(() => setCopiedSession(false), 3000);
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return 'PDF';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  };

  const localSessionString = getStoredTelegramSession();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
      <div className={`w-full max-w-xl rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[88vh] transition-colors ${modalShell}`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${modalHeader}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#1DB954]/15 text-[#1DB954] flex items-center justify-center">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                <span>Multi-Channel Telegram Sync &amp; Explore Server</span>
              </h2>
              <p className={`text-[11px] ${mutedText}`}>
                Connect multiple book channels so all PDFs appear automatically in Explore for every user
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg opacity-60 hover:opacity-100 transition-all ${
              isDark ? 'hover:bg-[#282828]' : 'hover:bg-black/5'
            }`}
            aria-label="Close Telegram Sync modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Step 1: In-App Phone Sign-In */}
          {!status.configured ? (
            <div className={`p-4 rounded-xl border space-y-3 ${innerCard}`}>
              <div className="flex items-center gap-2 text-xs font-semibold text-[#1DB954]">
                <Smartphone className="w-4 h-4" />
                <span>Step 1: Sign In with Your Server Telegram Account</span>
              </div>
              <p className={`text-[11px] leading-relaxed ${mutedText}`}>
                Sign in once with the Telegram account that has joined your book channels:
              </p>

              {!codeSent ? (
                <form onSubmit={handleSendCode} className="flex gap-2">
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={e => setPhoneNumber(e.target.value)}
                    placeholder="+1 234 567 8900 (with country code)"
                    className={`flex-1 text-xs px-3.5 py-2.5 rounded-xl border focus:outline-hidden ${inputClass}`}
                  />
                  <button
                    type="submit"
                    disabled={isAuthBusy}
                    className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 ${primaryBtn}`}
                  >
                    {isAuthBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    <span>Send Login Code</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyCode} className="space-y-2.5">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={phoneCode}
                      onChange={e => setPhoneCode(e.target.value)}
                      placeholder="5-digit code from Telegram app"
                      className={`flex-1 text-xs px-3.5 py-2.5 rounded-xl border focus:outline-hidden ${inputClass}`}
                    />
                    <button
                      type="submit"
                      disabled={isAuthBusy}
                      className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 ${primaryBtn}`}
                    >
                      {isAuthBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      <span>Verify &amp; Connect</span>
                    </button>
                  </div>

                  {needsPassword && (
                    <input
                      type="password"
                      value={twoFaPassword}
                      onChange={e => setTwoFaPassword(e.target.value)}
                      placeholder="Telegram 2-Step Verification (2FA) Password"
                      className={`w-full text-xs px-3.5 py-2.5 rounded-xl border focus:outline-hidden ${inputClass}`}
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setCodeSent(false);
                      setNeedsPassword(false);
                    }}
                    className={`text-[11px] underline ${mutedText}`}
                  >
                    Change phone number
                  </button>
                </form>
              )}
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-[#1DB954]/10 border border-[#1DB954]/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-[#1DB954]" />
                  <span className="font-semibold">Telegram Account Connected</span>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className={`text-[11px] flex items-center gap-1 px-2 py-1 rounded hover:bg-black/10 transition-colors ${mutedText}`}
                >
                  <LogOut className="w-3 h-3" />
                  <span>Disconnect</span>
                </button>
              </div>

              {localSessionString && (
                <div className={`p-3 rounded-lg border space-y-2 text-[11px] ${innerCard}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5 text-[#1DB954]" />
                      <span>Make Global for All New Users (Vercel Env Vars):</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleCopySessionForServer}
                      className={`px-2.5 py-1 rounded font-semibold flex items-center gap-1 transition-colors ${primaryBtn}`}
                    >
                      {copiedSession ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedSession ? 'Copied Session!' : 'Copy TELEGRAM_SESSION'}</span>
                    </button>
                  </div>
                  <p className={`${mutedText} leading-relaxed`}>
                    To let <strong>every visitor</strong> see your channels in <strong>Explore</strong> without logging in: paste this copied value as{' '}
                    <code className="text-emerald-600 font-semibold">TELEGRAM_SESSION</code> and your channel list as{' '}
                    <code className="text-emerald-600 font-semibold">TELEGRAM_CHANNELS</code> in your environment variables.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Multi-Channel Input */}
          <form onSubmit={handleScanChannel} className="space-y-2">
            <label className={`block text-xs font-semibold ${mutedText}`}>
              Telegram Book Channels (comma-separated for multiple channels)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={channelInput}
                onChange={e => setChannelInput(e.target.value)}
                placeholder="@SciFiBooks, @HistoryPDFs, @PhilosophyClub"
                className={`flex-1 text-xs px-3.5 py-2.5 rounded-xl border focus:outline-hidden ${inputClass}`}
              />
              <button
                type="submit"
                disabled={isLoadingList || isSyncingNewest}
                className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 ${secondaryBtn}`}
              >
                {isLoadingList ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>Scan All</span>
              </button>
            </div>
          </form>

          {/* Auto-Sync Toggle + 1-Click Fetch Newest */}
          <div className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${innerCard}`}>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={e => {
                  const channels = normalizeMultipleChannels(channelInput);
                  if (channels.length > 0) onChangeChannel(channels.join(', '));
                  onToggleAutoSync(e.target.checked);
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-400/50 peer-checked:bg-[#1DB954] rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
              <div>
                <div className="text-xs font-semibold flex items-center gap-1.5">
                  <Radio className={`w-3.5 h-3.5 ${autoSync ? 'text-[#1DB954] animate-pulse' : 'opacity-50'}`} />
                  <span>Auto-Download Newest PDF</span>
                </div>
                <p className={`text-[11px] ${mutedText}`}>
                  Automatically pulls the newest PDF from all listed channels
                </p>
              </div>
            </label>

            <button
              type="button"
              onClick={handleSyncNewestPdfNow}
              disabled={isSyncingNewest || isLoadingList}
              className={`px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50 ${primaryBtn}`}
            >
              {isSyncingNewest ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>Pull Newest PDF Now</span>
            </button>
          </div>

          {/* Feedback Banners */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successBanner && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-600 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successBanner}</span>
            </div>
          )}

          {/* Multi-Channel PDF Feed */}
          {pdfs.length > 0 && (
            <div className="space-y-2">
              <div className={`flex items-center justify-between text-xs px-1 ${mutedText}`}>
                <span>Recent PDFs across connected channels</span>
                <span className="font-mono text-[11px]">{pdfs.length} PDFs found</span>
              </div>

              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {pdfs.map((item, idx) => {
                  const imported = isBookAlreadyImported(item);
                  const key = `${item.channelUsername}_${item.messageId}`;
                  const isDownloading = downloadingId === key;

                  return (
                    <div
                      key={key}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${innerCard}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-[#1DB954]/15 flex items-center justify-center shrink-0 text-[#1DB954]">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {idx === 0 && (
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#1DB954]/20 text-[#1DB954]">
                                Newest
                              </span>
                            )}
                            <p className="text-xs font-semibold truncate">
                              {item.cleanTitle || item.fileName.replace(/\.pdf$/i, '')}
                            </p>
                          </div>
                          <p className={`text-[11px] truncate ${mutedText}`}>
                            {formatBytes(item.fileSize)} · {new Date(item.date).toLocaleDateString()}
                            {item.caption ? ` · ${item.caption}` : ''}
                          </p>
                        </div>
                      </div>

                      {imported ? (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#1DB954]/15 text-[#1DB954] flex items-center gap-1 shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>In Library</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleImportSinglePdf(item)}
                          disabled={isDownloading}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors disabled:opacity-50 ${primaryBtn}`}
                        >
                          {isDownloading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                          <span>{isDownloading ? 'Importing...' : 'Import'}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
