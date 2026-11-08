import React, { useState, useEffect } from 'react';
import { Book, Booklist, AppTheme, TelegramPdfItem, CoverPattern } from '../types/library';
import {
  searchPublicBooklists,
  cleanPdfFilename,
  sanitizeBookTitle,
  sanitizeBookAuthor,
} from '../utils/library';
import {
  fetchExploreChannelFeed,
  downloadAndImportTelegramPdf,
  ExploreChannelGroup,
  normalizeChannelInput,
} from '../services/telegramSync';
import { PlaylistCoverArt, BookCover } from './BookCoverArt';
import {
  Search,
  Heart,
  Play,
  Send,
  RefreshCw,
  Download,
  CheckCircle2,
  Loader2,
  Sparkles,
  BookOpen,
} from 'lucide-react';

interface ExploreShelvesViewProps {
  publicBooklists: Booklist[];
  existingBooks: Book[];
  configuredChannels: string;
  onSelectBooklist: (id: string) => void;
  onToggleSaveList: (id: string) => void;
  onBookImported: (book: Book, openImmediately?: boolean) => void;
  onOpenTelegramSetup: () => void;
  theme: AppTheme;
}

const COVER_COLORS = [
  '#1E293B',
  '#27272A',
  '#3D2817',
  '#14532D',
  '#581C1A',
  '#1E1B4B',
];

const COVER_PATTERNS: CoverPattern[] = ['botanical', 'geometric', 'embossed', 'classical'];

export const ExploreShelvesView: React.FC<ExploreShelvesViewProps> = ({
  publicBooklists,
  existingBooks,
  configuredChannels,
  onSelectBooklist,
  onToggleSaveList,
  onBookImported,
  onOpenTelegramSetup,
  theme,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [channelGroups, setChannelGroups] = useState<ExploreChannelGroup[]>([]);
  const [allChannelPdfs, setAllChannelPdfs] = useState<TelegramPdfItem[]>([]);
  const [selectedChannelFilter, setSelectedChannelFilter] = useState<string>('all');
  const [isLoadingFeed, setIsLoadingFeed] = useState(true);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [feedConfigured, setFeedConfigured] = useState(false);

  const isDark = theme === 'spotify-dark';

  const loadExploreFeed = async (forceRefresh = false) => {
    setIsLoadingFeed(true);
    try {
      const feed = await fetchExploreChannelFeed(configuredChannels, forceRefresh);
      setFeedConfigured(feed.configured);
      setChannelGroups(feed.channels || []);
      setAllChannelPdfs(feed.allPdfs || []);
    } finally {
      setIsLoadingFeed(false);
    }
  };

  useEffect(() => {
    loadExploreFeed(false);
    const interval = setInterval(() => {
      loadExploreFeed(false);
    }, 60000);
    return () => clearInterval(interval);
  }, [configuredChannels]);

  const filteredLists = searchPublicBooklists(publicBooklists, searchQuery);

  const visibleTelegramPdfs = allChannelPdfs.filter(item => {
    if (selectedChannelFilter !== 'all' && item.channelUsername !== selectedChannelFilter) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const cleanName = sanitizeBookTitle(item.cleanTitle || item.fileName, item.channelTitle).toLowerCase();
    return (
      cleanName.includes(q) ||
      item.caption.toLowerCase().includes(q) ||
      (item.author || '').toLowerCase().includes(q)
    );
  });

  const findExistingBook = (item: TelegramPdfItem): Book | undefined => {
    const cleanCh = normalizeChannelInput(item.channelUsername);
    return existingBooks.find(
      b =>
        (b.telegramChannel === cleanCh && b.telegramMessageId === item.messageId) ||
        b.id === `tg_${cleanCh}_${item.messageId}`
    );
  };

  const handleGetOrReadChannelPdf = async (item: TelegramPdfItem, openReader: boolean) => {
    const existing = findExistingBook(item);
    if (existing) {
      onBookImported(existing, openReader);
      return;
    }

    const key = `${item.channelUsername}_${item.messageId}`;
    setDownloadingKey(key);
    try {
      const importedBook = await downloadAndImportTelegramPdf(item);
      onBookImported(importedBook, openReader);
    } catch (err) {
      console.error('Failed to download PDF from Explore feed:', err);
    } finally {
      setDownloadingKey(null);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return 'PDF';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  };

  return (
    <div className="flex-1 p-6 lg:p-8 max-w-6xl w-full mx-auto overflow-y-auto select-none space-y-10">
      {/* Clean Top Search Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-balance">
            Explore Books
          </h2>
          <p className={`text-xs sm:text-sm mt-1 font-medium ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
            Instant PDF books automatically synced — tap any book to read or save offline
          </p>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 opacity-50 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search books..."
              className={`w-full text-xs pl-8 pr-3 py-2 rounded-full border focus:outline-hidden ${
                isDark
                  ? 'bg-[#242424] border-[#333333] text-white placeholder-zinc-500'
                  : 'bg-white border-zinc-200 text-zinc-900'
              }`}
            />
          </div>

          <button
            onClick={() => loadExploreFeed(true)}
            disabled={isLoadingFeed}
            className={`p-2 rounded-full border transition-colors ${
              isDark
                ? 'bg-[#181818] border-[#282828] hover:bg-[#282828] text-white'
                : 'bg-white border-zinc-200 hover:bg-zinc-100 text-zinc-900'
            }`}
            title="Refresh Books Feed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFeed ? 'animate-spin text-[#1DB954]' : ''}`} />
          </button>
        </div>
      </div>

      {/* SECTION 1: Automatic Multi-Channel Telegram PDF Feed */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-[#1DB954]/15 text-[#1DB954] flex items-center justify-center">
              <BookOpen className="w-3.5 h-3.5" />
            </span>
            <h3 className="text-lg font-serif font-bold tracking-tight">
              Available Books
            </h3>
            {allChannelPdfs.length > 0 && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#1DB954]/15 text-[#1DB954]">
                {allChannelPdfs.length} books
              </span>
            )}
          </div>

          {/* Channel Filter Pills (only shown if multiple channels exist) */}
          {channelGroups.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedChannelFilter('all')}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  selectedChannelFilter === 'all'
                    ? 'bg-[#1DB954] text-black'
                    : isDark
                    ? 'bg-[#181818] text-[#B3B3B3] hover:text-white'
                    : 'bg-zinc-100 text-zinc-700'
                }`}
              >
                All ({allChannelPdfs.length})
              </button>
              {channelGroups.map((group, idx) => (
                <button
                  key={group.channel}
                  onClick={() => setSelectedChannelFilter(group.channel)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                    selectedChannelFilter === group.channel
                      ? 'bg-[#1DB954] text-black'
                      : isDark
                      ? 'bg-[#181818] text-[#B3B3B3] hover:text-white'
                      : 'bg-zinc-100 text-zinc-700'
                  }`}
                >
                  Collection {idx + 1} ({group.pdfs.length})
                </button>
              ))}
            </div>
          )}
        </div>

        {isLoadingFeed ? (
          <div
            className={`p-10 rounded-2xl border flex flex-col items-center justify-center gap-2 text-center ${
              isDark ? 'bg-[#181818] border-[#282828]' : 'bg-zinc-50 border-zinc-200'
            }`}
          >
            <Loader2 className="w-6 h-6 animate-spin text-[#1DB954]" />
            <p className="text-xs font-semibold">Loading books...</p>
          </div>
        ) : visibleTelegramPdfs.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {visibleTelegramPdfs.map(item => {
              const parsed = cleanPdfFilename(
                item.cleanTitle || item.fileName,
                item.caption,
                item.channelTitle
              );
              const cleanTitle = sanitizeBookTitle(
                item.cleanTitle || parsed.title,
                item.channelTitle
              );
              const cleanAuthor = sanitizeBookAuthor(
                item.author || parsed.author,
                item.channelTitle
              );

              const existing = findExistingBook(item);
              const key = `${item.channelUsername}_${item.messageId}`;
              const isBusy = downloadingKey === key;
              const hashVal = Math.abs(
                cleanTitle.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
              );
              const coverColor = COVER_COLORS[hashVal % COVER_COLORS.length];
              const coverPattern = COVER_PATTERNS[hashVal % COVER_PATTERNS.length];

              return (
                <div
                  key={key}
                  onClick={() => handleGetOrReadChannelPdf(item, true)}
                  className={`group p-3 rounded-xl cursor-pointer transition-all flex flex-col justify-between border ${
                    isDark
                      ? 'bg-[#181818] border-[#242424] hover:bg-[#242424] hover:border-[#333333]'
                      : 'bg-white border-zinc-200/80 hover:bg-zinc-50'
                  }`}
                >
                  <div className="relative mb-3">
                    <BookCover
                      title={cleanTitle}
                      author={cleanAuthor}
                      color={existing?.spineColor || coverColor}
                      pattern={existing?.coverPattern || coverPattern}
                      className="w-full aspect-[3/4] rounded-lg shadow-md group-hover:scale-[1.02] transition-transform"
                    />

                    {/* Play / Read Now Hover Button */}
                    <div className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
                      <span className="w-10 h-10 rounded-full bg-[#1DB954] text-black flex items-center justify-center shadow-lg">
                        {isBusy ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        )}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-xs truncate mb-0.5" title={cleanTitle}>
                      {cleanTitle}
                    </h4>
                    <p className={`text-[11px] truncate mb-2 ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
                      {cleanAuthor ? `${cleanAuthor} · ${formatBytes(item.fileSize)}` : formatBytes(item.fileSize)}
                    </p>

                    <div className="flex items-center justify-between pt-1 border-t border-white/5">
                      {existing ? (
                        <span className="text-[11px] font-semibold text-[#1DB954] flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Saved Offline</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            handleGetOrReadChannelPdf(item, false);
                          }}
                          disabled={isBusy}
                          className="text-[11px] font-semibold text-white/80 hover:text-[#1DB954] flex items-center gap-1 transition-colors"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin text-[#1DB954]" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                          <span>{isBusy ? 'Saving...' : 'Save to Library'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className={`p-8 rounded-2xl border text-center space-y-3 ${
              isDark ? 'bg-[#181818] border-[#282828]' : 'bg-zinc-50 border-zinc-200'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-[#1DB954]/15 text-[#1DB954] flex items-center justify-center mx-auto">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="max-w-md mx-auto space-y-1">
              <h4 className="text-sm font-bold">
                {feedConfigured
                  ? 'Add Telegram Book Channels to Populate Explore'
                  : 'Connect Your Server Telegram Channels'}
              </h4>
              <p className={`text-xs ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
                As the app owner, connect your Telegram account once and list your book channels (e.g.{' '}
                <code className="text-[#1DB954]">@channel1, @channel2</code>) in{' '}
                <strong>Telegram Sync</strong> or in Vercel&apos;s <code className="text-white">TELEGRAM_CHANNELS</code>{' '}
                environment variable so every visitor sees all channel PDFs here automatically.
              </p>
            </div>
            <button
              onClick={onOpenTelegramSetup}
              className="px-4 py-2 rounded-full text-xs font-semibold bg-[#1DB954] text-black hover:bg-[#1ed760] inline-flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Configure Server Channels</span>
            </button>
          </div>
        )}
      </section>

      {/* SECTION 2: Public Reader Playlists */}
      {filteredLists.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#1DB954]" />
            <h3 className="text-lg font-serif font-bold tracking-tight">
              Public Reader Playlists
            </h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredLists.map(list => (
              <div
                key={list.id}
                onClick={() => onSelectBooklist(list.id)}
                className={`group p-3 rounded-md cursor-pointer transition-all flex flex-col justify-between ${
                  isDark
                    ? 'bg-[#181818] hover:bg-[#282828]'
                    : 'bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/60'
                }`}
              >
                <div className="relative mb-3">
                  <PlaylistCoverArt
                    styleName={list.coverArtStyle}
                    color={list.coverColor}
                    title={list.title}
                    className="w-full aspect-square rounded shadow-md group-hover:scale-[1.02] transition-transform"
                  />

                  <div className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
                    <span
                      className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg ${
                        isDark ? 'bg-[#1DB954] text-black' : 'bg-zinc-900 text-white'
                      }`}
                    >
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    </span>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-xs truncate mb-0.5">
                    {list.title}
                  </h3>
                  <p className={`text-[11px] truncate mb-2 ${isDark ? 'text-[#B3B3B3]' : 'text-zinc-500'}`}>
                    By {list.ownerName} · {list.bookIds.length} books
                  </p>

                  <div className="flex items-center justify-between text-[11px] pt-1">
                    <span className="opacity-60">{list.savesCount} saves</span>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onToggleSaveList(list.id);
                      }}
                      className={`p-1 rounded ${
                        list.isSavedByUser ? 'text-rose-500' : 'opacity-40 hover:opacity-100'
                      }`}
                    >
                      <Heart className={`w-3.5 h-3.5 ${list.isSavedByUser ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
