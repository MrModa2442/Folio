import React, { useState, useEffect } from 'react';
import { Book, TelegramConfigStatus, TelegramPdfItem } from '../types/library';
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
}) => {
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
    return existingBooks.some(
      b =>
        (b.telegramChannel === cleanCh && b.telegramMessageId === item.messageId) ||
        b.id === `tg_${cleanCh}_${item.messageId}`
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
      if (!res.ok) {
        throw new Error(data.error || 'Could not send login code.');
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
      if (res.status === 401 && data.needsPassword) {
        setNeedsPassword(true);
        setErrorMessage(data.error);
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || 'Failed to verify login code.');
      }

      if (data.sessionString) {
        setStoredTelegramSession(data.sessionString);
      }

      setCodeSent(false);
      setNeedsPassword(false);
      setPhoneCode('');
      setTwoFaPassword('');
      setSuccessBanner('Connected! You can now scan multiple channels or copy your session for Vercel.');
      refreshStatus();
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
      if (feed.allPdfs.length === 0) {
        setErrorMessage(`Scanned ${channels.length} channel(s), but no PDF files were found in recent messages.`);
      } else {
        setSuccessBanner(
          `Found ${feed.allPdfs.length} PDF books across ${feed.channels.length} channel(s)! They are now visible in Explore.`
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs select-none">
      <div className="bg-[#181818] text-white w-full max-w-xl rounded-2xl shadow-2xl border border-[#282828] overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-[#1F1F1F] border-b border-[#282828] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#1DB954]/15 text-[#1DB954] flex items-center justify-center">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                <span>Multi-Channel Telegram Sync &amp; Explore Server</span>
              </h2>
              <p className="text-[11px] text-[#B3B3B3]">
                Connect multiple book channels so all PDFs appear automatically in Explore for every user
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg opacity-60 hover:opacity-100 hover:bg-[#282828] transition-all"
            aria-label="Close Telegram Sync modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Step 1: In-App Phone Sign-In */}
          {!status.configured ? (
            <div className="p-4 rounded-xl bg-[#121212] border border-[#282828] space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#1DB954]">
                <Smartphone className="w-4 h-4" />
                <span>Step 1: Sign In with Your Server Telegram Account</span>
              </div>
              <p className="text-[11px] text-[#B3B3B3] leading-relaxed">
                Sign in once with the Telegram account that has joined your book channels:
              </p>

              {!codeSent ? (
                <form onSubmit={handleSendCode} className="flex gap-2">
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={e => setPhoneNumber(e.target.value)}
                    placeholder="+1 234 567 8900 (with country code)"
                    className="flex-1 text-xs px-3.5 py-2.5 rounded-xl bg-[#181818] border border-[#333333] text-white placeholder-zinc-500 focus:outline-hidden focus:border-[#1DB954]"
                  />
                  <button
                    type="submit"
                    disabled={isAuthBusy}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-[#1DB954] text-black hover:bg-[#1ed760] flex items-center gap-1.5 transition-colors disabled:opacity-50"
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
                      className="flex-1 text-xs px-3.5 py-2.5 rounded-xl bg-[#181818] border border-[#333333] text-white placeholder-zinc-500 focus:outline-hidden focus:border-[#1DB954]"
                    />
                    <button
                      type="submit"
                      disabled={isAuthBusy}
                      className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-[#1DB954] text-black hover:bg-[#1ed760] flex items-center gap-1.5 transition-colors disabled:opacity-50"
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
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl bg-[#181818] border border-amber-500/50 text-white placeholder-zinc-500 focus:outline-hidden focus:border-[#1DB954]"
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setCodeSent(false);
                      setNeedsPassword(false);
                    }}
                    className="text-[11px] text-[#B3B3B3] hover:text-white underline"
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
                  className="text-[11px] text-[#B3B3B3] hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 transition-colors"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Disconnect</span>
                </button>
              </div>

              {/* Server Owner Config Box: Lets owner make this global for ALL users on Vercel */}
              {localSessionString && (
                <div className="p-3 rounded-lg bg-[#121212] border border-[#282828] space-y-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5 text-[#1DB954]" />
                      <span>Make Global for All New Users (Vercel Env Vars):</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleCopySessionForServer}
                      className="px-2.5 py-1 rounded bg-[#1DB954] text-black font-semibold flex items-center gap-1 hover:bg-[#1ed760] transition-colors"
                    >
                      {copiedSession ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedSession ? 'Copied Session!' : 'Copy TELEGRAM_SESSION'}</span>
                    </button>
                  </div>
                  <p className="text-[#B3B3B3] leading-relaxed">
                    To let <strong>every visitor</strong> see your channels in <strong>Explore</strong> without logging in: paste this copied value as{' '}
                    <code className="text-emerald-400">TELEGRAM_SESSION</code> and your channel list as{' '}
                    <code className="text-emerald-400">TELEGRAM_CHANNELS</code> (e.g.{' '}
                    <code className="text-white">@channel1,@channel2</code>) in your Vercel Project → Settings → Environment Variables.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Multi-Channel Input */}
          <form onSubmit={handleScanChannel} className="space-y-2">
            <label className="block text-xs font-semibold text-[#B3B3B3]">
              Telegram Book Channels (comma-separated for multiple channels)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={channelInput}
                onChange={e => setChannelInput(e.target.value)}
                placeholder="@SciFiBooks, @HistoryPDFs, @PhilosophyClub"
                className="flex-1 text-xs px-3.5 py-2.5 rounded-xl bg-[#121212] border border-[#333333] text-white placeholder-zinc-500 focus:outline-hidden focus:border-[#1DB954]"
              />
              <button
                type="submit"
                disabled={isLoadingList || isSyncingNewest}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-[#282828] hover:bg-[#333333] text-white flex items-center gap-1.5 transition-colors disabled:opacity-50"
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
          <div className="p-3.5 rounded-xl bg-[#121212] border border-[#282828] flex flex-wrap items-center justify-between gap-3">
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
              <div className="w-9 h-5 bg-[#282828] peer-checked:bg-[#1DB954] rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
              <div>
                <div className="text-xs font-semibold flex items-center gap-1.5">
                  <Radio className={`w-3.5 h-3.5 ${autoSync ? 'text-[#1DB954] animate-pulse' : 'opacity-50'}`} />
                  <span>Auto-Download Newest PDF</span>
                </div>
                <p className="text-[11px] text-[#B3B3B3]">
                  Automatically pulls the newest PDF from all listed channels
                </p>
              </div>
            </label>

            <button
              type="button"
              onClick={handleSyncNewestPdfNow}
              disabled={isSyncingNewest || isLoadingList}
              className="px-4 py-2 rounded-full text-xs font-semibold bg-[#1DB954] text-black hover:bg-[#1ed760] flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50"
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
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successBanner && (
            <div className="p-3 rounded-xl bg-[#1DB954]/15 border border-[#1DB954]/40 text-emerald-200 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#1DB954] shrink-0 mt-0.5" />
              <span>{successBanner}</span>
            </div>
          )}

          {/* Multi-Channel PDF Feed */}
          {pdfs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-[#B3B3B3] px-1">
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
                      className="p-3 rounded-xl bg-[#121212] border border-[#242424] hover:border-[#333333] flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-[#242424] flex items-center justify-center shrink-0 text-[#1DB954]">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {idx === 0 && (
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#1DB954]/20 text-[#1DB954]">
                                Newest
                              </span>
                            )}
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-[#B3B3B3]">
                              @{item.channelUsername}
                            </span>
                            <p className="text-xs font-semibold truncate">{item.fileName}</p>
                          </div>
                          <p className="text-[11px] text-[#B3B3B3] truncate">
                            {formatBytes(item.fileSize)} · {new Date(item.date).toLocaleDateString()}
                            {item.caption ? ` · ${item.caption}` : ''}
                          </p>
                        </div>
                      </div>

                      {imported ? (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white/5 text-[#1DB954] flex items-center gap-1 shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>In Library</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleImportSinglePdf(item)}
                          disabled={isDownloading}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-black hover:bg-zinc-200 flex items-center gap-1.5 shrink-0 transition-colors disabled:opacity-50"
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
