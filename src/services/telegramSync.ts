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
const inflightCoverRequests = new Map<string, Promise<string | null>>();

export interface ExploreChannelGroup {
  channel: string;
  channelTitle: string;
  pdfs: TelegramPdfItem[];
}

export interface ExploreTelegramFeedResponse {
  configured: boolean;
  serverHasSession: boolean;
  channels: ExploreChannelGroup[];
  allPdfs: TelegramPdfItem[];
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
  const localSession = getStoredTelegramSession();
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
    return {
      ...data,
      configured: Boolean(data.configured || localSession),
      hasSession: Boolean(data.hasSession || localSession),
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

export async function fetchExploreChannelFeed(
  extraChannels = '',
  forceRefresh = false
): Promise<ExploreTelegramFeedResponse> {
  try {
    const cleanList = normalizeMultipleChannels(extraChannels).join(',');
    const params = new URLSearchParams();
    if (cleanList) params.set('channels', cleanList);
    if (forceRefresh) params.set('refresh', 'true');

    const res = await fetch(`/api/telegram/explore-feed?${params.toString()}`, {
      headers: getSessionHeaders(),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      return {
        configured: false,
        serverHasSession: false,
        channels: [],
        allPdfs: [],
      };
    }
    const data: ExploreTelegramFeedResponse = await res.json();
    const seenGroups = new Set<string>();
    const dedupedGroups: ExploreChannelGroup[] = [];
    for (const group of data.channels || []) {
      const chKey = normalizeChannelInput(group.channel);
      if (!chKey || seenGroups.has(chKey)) continue;
      seenGroups.add(chKey);
      dedupedGroups.push({
        ...group,
        channel: chKey,
        pdfs: deduplicateTelegramPdfs(group.pdfs || []),
      });
    }
    return {
      ...data,
      channels: dedupedGroups,
      allPdfs: deduplicateTelegramPdfs(data.allPdfs || []),
    };
  } catch {
    return {
      configured: false,
      serverHasSession: false,
      channels: [],
      allPdfs: [],
    };
  }
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
