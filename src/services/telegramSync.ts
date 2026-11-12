import { Book, CoverPattern, TelegramConfigStatus, TelegramPdfItem } from '../types/library';
import { extractPdfMetadata } from '../utils/pdfParser';
import { cleanPdfFilename, sanitizeBookTitle, sanitizeBookAuthor } from '../utils/library';
import { storePdfBlob, getBookCover, storeBookCover } from './db';

const PALETTE = [
  '#1E293B', // Slate
  '#27272A', // Charcoal
  '#3D2817', // Umber
  '#14532D', // Spruce
  '#581C1A', // Wine
  '#1E1B4B', // Indigo
];

const STORAGE_TG_SESSION_KEY = 'folio_tg_session_v1';
const STORAGE_EXPLORE_ARCHIVE_KEY = 'folio_explore_pdf_archive_v1';
const inflightCoverRequests = new Map<string, Promise<string | null>>();

export interface ExploreChannelGroup {
  channel: string;
  channelTitle: string;
  pdfs: TelegramPdfItem[];
}

export interface ExploreTelegramFeedResponse {
  configured: boolean;
  serverHasSession: boolean;
  sessionInvalidated?: boolean;
  channels: ExploreChannelGroup[];
  allPdfs: TelegramPdfItem[];
}

function loadLocalExploreArchive(): ExploreChannelGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_EXPLORE_ARCHIVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalExploreArchive(groups: ExploreChannelGroup[]): void {
  try {
    localStorage.setItem(STORAGE_EXPLORE_ARCHIVE_KEY, JSON.stringify(groups));
  } catch {
    // ignore storage quota errors
  }
}

function mergeExploreFeedWithLocalArchive(
  incomingGroups: ExploreChannelGroup[]
): { channels: ExploreChannelGroup[]; allPdfs: TelegramPdfItem[] } {
  const archivedGroups = loadLocalExploreArchive();
  const groupMap = new Map<string, { channel: string; channelTitle: string; items: TelegramPdfItem[] }>();

  // 1. Seed with existing local archive first
  for (const grp of archivedGroups) {
    const chKey = normalizeChannelInput(grp.channel);
    if (!chKey) continue;
    groupMap.set(chKey, {
      channel: chKey,
      channelTitle: grp.channelTitle || `@${chKey}`,
      items: [...(grp.pdfs || [])],
    });
  }

  // 2. Merge incoming groups on top (newest items first, keeping all older items)
  for (const grp of incomingGroups) {
    const chKey = normalizeChannelInput(grp.channel);
    if (!chKey) continue;
    const existing = groupMap.get(chKey);
    if (existing) {
      if (grp.channelTitle) existing.channelTitle = grp.channelTitle;
      existing.items = [...(grp.pdfs || []), ...existing.items];
    } else {
      groupMap.set(chKey, {
        channel: chKey,
        channelTitle: grp.channelTitle || `@${chKey}`,
        items: [...(grp.pdfs || [])],
      });
    }
  }

  const mergedGroups: ExploreChannelGroup[] = [];
  const combinedAll: TelegramPdfItem[] = [];

  for (const entry of groupMap.values()) {
    const dedupedPdfs = deduplicateTelegramPdfs(entry.items).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.messageId - a.messageId
    );
    mergedGroups.push({
      channel: entry.channel,
      channelTitle: entry.channelTitle,
      pdfs: dedupedPdfs,
    });
    combinedAll.push(...dedupedPdfs);
  }

  const finalAllPdfs = deduplicateTelegramPdfs(combinedAll).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.messageId - a.messageId
  );

  if (mergedGroups.length > 0) {
    saveLocalExploreArchive(mergedGroups);
  }

  return {
    channels: mergedGroups,
    allPdfs: finalAllPdfs,
  };
}

export function getStoredTelegramSession(): string {
  try {
    return localStorage.getItem(STORAGE_TG_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredTelegramSession(session: string): void {
  try {
    if (session) {
      localStorage.setItem(STORAGE_TG_SESSION_KEY, session);
    } else {
      localStorage.removeItem(STORAGE_TG_SESSION_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function getSessionHeaders(): Record<string, string> {
  const session = getStoredTelegramSession();
  return session ? { 'x-telegram-session': session } : {};
}

export function normalizeChannelInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/(?:https?:\/\/)?(?:t|telegram)\.me\/(?:s\/)?([a-zA-Z0-9_]+)/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1].toLowerCase();
  }
  return trimmed.replace(/^@/, '').trim().toLowerCase();
}

export function normalizeMultipleChannels(raw: string): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[\n,;]+/)
        .map(s => normalizeChannelInput(s))
        .filter(Boolean)
    )
  );
}

export function deduplicateTelegramPdfs(items: TelegramPdfItem[]): TelegramPdfItem[] {
  const seenMsgKeys = new Set<string>();
  const seenTitleKeys = new Set<string>();
  const result: TelegramPdfItem[] = [];

  for (const item of items) {
    const ch = normalizeChannelInput(item.channelUsername);
    const msgKey = `${ch}_${item.messageId}`;
    const cleanTitle = sanitizeBookTitle(item.cleanTitle || item.fileName, item.channelTitle)
      .toLowerCase()
      .trim();
    const titleKey = cleanTitle ? `${cleanTitle}_${item.fileSize || 0}` : msgKey;

    if (seenMsgKeys.has(msgKey) || (cleanTitle && seenTitleKeys.has(cleanTitle)) || seenTitleKeys.has(titleKey)) {
      continue;
    }

    seenMsgKeys.add(msgKey);
    if (cleanTitle) seenTitleKeys.add(cleanTitle);
    seenTitleKeys.add(titleKey);
    result.push({
      ...item,
      channelUsername: ch,
    });
  }

  return result;
}

export async function fetchTelegramStatus(): Promise<TelegramConfigStatus> {
  let localSession = getStoredTelegramSession();
  try {
    const res = await fetch('/api/telegram/status', {
      headers: getSessionHeaders(),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      return {
        configured: Boolean(localSession),
        hasApiId: true,
        hasApiHash: true,
        hasSession: Boolean(localSession),
        defaultChannel: '',
      };
    }
    const data = await res.json();
    if (data.sessionInvalidated && localSession) {
      setStoredTelegramSession('');
      localSession = '';
    }
    return {
      ...data,
      configured: Boolean(data.configured || localSession),
      hasSession: Boolean(data.hasSession || localSession),
      sessionInvalidated: Boolean(data.sessionInvalidated),
    };
  } catch {
    return {
      configured: Boolean(localSession),
      hasApiId: true,
      hasApiHash: true,
      hasSession: Boolean(localSession),
      defaultChannel: '',
    };
  }
}

let inflightExploreFeedRequest: Promise<ExploreTelegramFeedResponse> | null = null;

export async function fetchExploreChannelFeed(
  extraChannels = '',
  forceRefresh = false
): Promise<ExploreTelegramFeedResponse> {
  if (inflightExploreFeedRequest && !forceRefresh) {
    return inflightExploreFeedRequest;
  }

  const requestPromise = (async (): Promise<ExploreTelegramFeedResponse> => {
    try {
      const cleanList = normalizeMultipleChannels(extraChannels || 'ocbooks').join(',');
      const params = new URLSearchParams();
      if (cleanList) params.set('channels', cleanList);
      if (forceRefresh) params.set('refresh', 'true');

      const res = await fetch(`/api/telegram/explore-feed?${params.toString()}`, {
        headers: getSessionHeaders(),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        const fallback = mergeExploreFeedWithLocalArchive([]);
        return {
          configured: fallback.allPdfs.length > 0,
          serverHasSession: false,
          channels: fallback.channels,
          allPdfs: fallback.allPdfs,
        };
      }
      const data: ExploreTelegramFeedResponse = await res.json();
      const merged = mergeExploreFeedWithLocalArchive(data.channels || []);
      return {
        ...data,
        configured: Boolean(data.configured || merged.allPdfs.length > 0),
        channels: merged.channels,
        allPdfs: merged.allPdfs,
      };
    } catch {
      const fallback = mergeExploreFeedWithLocalArchive([]);
      return {
        configured: fallback.allPdfs.length > 0,
        serverHasSession: false,
        channels: fallback.channels,
        allPdfs: fallback.allPdfs,
      };
    } finally {
      inflightExploreFeedRequest = null;
    }
  })();

  inflightExploreFeedRequest = requestPromise;
  return requestPromise;
}

export async function fetchTelegramBookCover(
  item: {
    channelUsername: string;
    messageId: number;
    coverPhotoMsgId?: number;
  },
  cleanTitle: string
): Promise<string | null> {
  const cleanChannel = normalizeChannelInput(item.channelUsername);
  const cacheKey = `tg_${cleanChannel}_${item.messageId}`;

  const cached = await getBookCover(cacheKey);
  if (cached) return cached;

  const existingPromise = inflightCoverRequests.get(cacheKey);
  if (existingPromise) return existingPromise;

  const promise = (async () => {
    try {
      const params = new URLSearchParams({
        channel: cleanChannel,
        messageId: String(item.messageId),
        title: cleanTitle,
      });
      if (item.coverPhotoMsgId) {
        params.set('photoMsgId', String(item.coverPhotoMsgId));
      }

      const res = await fetch(`/api/telegram/cover?${params.toString()}`, {
        headers: getSessionHeaders(),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.coverUrl && typeof data.coverUrl === 'string') {
        await storeBookCover(cacheKey, data.coverUrl);
        return data.coverUrl;
      }
      return null;
    } catch {
      return null;
    } finally {
      inflightCoverRequests.delete(cacheKey);
    }
  })();

  inflightCoverRequests.set(cacheKey, promise);
  return promise;
}

export async function fetchChannelPdfs(
  channel: string,
  limit = 20
): Promise<{ channel: string; channelTitle: string; pdfs: TelegramPdfItem[] }> {
  const cleanChannel = normalizeChannelInput(channel);
  const res = await fetch(
    `/api/telegram/channel-pdfs?channel=${encodeURIComponent(cleanChannel)}&limit=${limit}`,
    {
      headers: getSessionHeaders(),
    }
  );
  const data = await res.json();
  if (data?.sessionInvalidated) {
    setStoredTelegramSession('');
  }
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch PDFs from Telegram channel.');
  }
  return data;
}

export async function downloadAndImportTelegramPdf(
  item: TelegramPdfItem
): Promise<Book> {
  const cleanChannel = normalizeChannelInput(item.channelUsername);
  const url = `/api/telegram/download-pdf?channel=${encodeURIComponent(
    cleanChannel
  )}&messageId=${encodeURIComponent(String(item.messageId))}`;

  const res = await fetch(url, {
    headers: getSessionHeaders(),
  });
  if (!res.ok) {
    let errMsg = `Failed to download PDF (#${item.messageId}).`;
    try {
      const errJson = await res.json();
      if (errJson?.sessionInvalidated) {
        setStoredTelegramSession('');
      }
      if (errJson.error) errMsg = errJson.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(errMsg);
  }

  const arrayBuffer = await res.arrayBuffer();
  const parsedName = cleanPdfFilename(item.cleanTitle || item.fileName, item.caption, item.channelTitle);
  const fileName = `${parsedName.title}.pdf`;

  const file = new File([arrayBuffer], fileName, { type: 'application/pdf' });
  const metadata = await extractPdfMetadata(file);

  const bookId = `tg_${cleanChannel}_${item.messageId}`;
  await storePdfBlob(bookId, file);

  const finalTitle = sanitizeBookTitle(
    item.cleanTitle || parsedName.title || metadata.title,
    item.channelTitle
  );
  const finalAuthor = sanitizeBookAuthor(
    item.author || parsedName.author || metadata.author,
    item.channelTitle
  );

  const colorIndex =
    Math.abs(
      finalTitle.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    ) % PALETTE.length;
  const spineColor = PALETTE[colorIndex];
  const patterns: CoverPattern[] = ['botanical', 'geometric', 'embossed', 'classical'];
  const coverPattern = patterns[colorIndex % patterns.length];

  return {
    id: bookId,
    title: finalTitle,
    author: finalAuthor,
    fileName,
    fileSize: file.size || item.fileSize,
    pageCount: metadata.pageCount,
    currentPage: 1,
    status: 'to-read',
    spineColor,
    spineTexture: 'leather',
    coverPattern,
    notes: sanitizeBookTitle(item.caption || '', item.channelTitle),
    dateAdded: new Date().toISOString().split('T')[0],
    lastRead: null,
    pdfBlobKey: bookId,
    telegramChannel: cleanChannel,
    telegramMessageId: item.messageId,
  };
}
