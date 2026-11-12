import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Logger } from 'telegram/extensions/index.js';
import fs from 'fs';
import path from 'path';

const DEFAULT_API_ID = 2040;
const DEFAULT_API_HASH = 'b18441a1ff607e10a989891a5462e627';

// Suppress GramJS background update/ping TIMEOUT unhandled rejections
if (typeof process !== 'undefined' && process.on) {
  process.on('unhandledRejection', (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    if (msg.includes('TIMEOUT') || msg.includes('Not connected')) {
      // Ignore benign GramJS background socket idle timeout
      return;
    }
    console.warn('[UnhandledRejection]', reason);
  });
}

// Reusable connected client cache so we don't connect/disconnect on every request
const clientPool = new Map<string, TelegramClient>();

async function getConnectedClient(
  sessionStr: string,
  apiId: number,
  apiHash: string
): Promise<TelegramClient> {
  const key = `${apiId}:${sessionStr.slice(0, 32)}`;
  const existing = clientPool.get(key);
  if (existing && existing.connected) {
    return existing;
  }

  const silentLogger = new Logger('none' as never);
  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 2,
    retryDelay: 500,
    timeout: 10,
    autoReconnect: false,
    baseLogger: silentLogger,
  });

  await client.connect();
  if (sessionStr) {
    clientPool.set(key, client);
  }
  return client;
}

type ExtractedTelegramPdf = NonNullable<ReturnType<typeof extractPdfFromMessage>>;

// Permanent cumulative archive of all discovered PDFs per channel so older PDFs never disappear
const ARCHIVE_FILE_PATHS = [
  path.resolve(process.cwd(), '.folio-explore-archive.json'),
  '/tmp/folio-explore-archive.json',
];

const persistentChannelArchive = new Map<
  string,
  {
    channelTitle: string;
    pdfsByMsgId: Map<number, ExtractedTelegramPdf>;
  }
>();
let archiveLoadedFromDisk = false;

function loadArchiveFromDiskOnce() {
  if (archiveLoadedFromDisk) return;
  archiveLoadedFromDisk = true;
  for (const filePath of ARCHIVE_FILE_PATHS) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<
          string,
          { channelTitle: string; pdfs: ExtractedTelegramPdf[] }
        >;
        for (const [ch, entry] of Object.entries(parsed || {})) {
          const cleanCh = ch.toLowerCase().trim();
          if (!cleanCh || !entry || !Array.isArray(entry.pdfs)) continue;
          const existing = persistentChannelArchive.get(cleanCh) || {
            channelTitle: entry.channelTitle || `@${cleanCh}`,
            pdfsByMsgId: new Map<number, ExtractedTelegramPdf>(),
          };
          for (const pdf of entry.pdfs) {
            if (pdf && typeof pdf.messageId === 'number') {
              existing.pdfsByMsgId.set(pdf.messageId, {
                ...pdf,
                channelUsername: cleanCh,
              });
            }
          }
          persistentChannelArchive.set(cleanCh, existing);
        }
        break;
      }
    } catch {
      // ignore disk read errors
    }
  }
}

function saveArchiveToDisk() {
  const serialized: Record<string, { channelTitle: string; pdfs: ExtractedTelegramPdf[] }> = {};
  for (const [ch, entry] of persistentChannelArchive.entries()) {
    serialized[ch] = {
      channelTitle: entry.channelTitle,
      pdfs: Array.from(entry.pdfsByMsgId.values()),
    };
  }
  const json = JSON.stringify(serialized);
  for (const filePath of ARCHIVE_FILE_PATHS) {
    try {
      fs.writeFileSync(filePath, json, 'utf-8');
      break;
    } catch {
      // try next path (e.g. /tmp on read-only serverless fs)
    }
  }
}

function mergeChannelPdfsIntoArchive(
  channel: string,
  channelTitle: string,
  incomingPdfs: ExtractedTelegramPdf[]
): ExtractedTelegramPdf[] {
  loadArchiveFromDiskOnce();
  const cleanCh = channel.toLowerCase().trim();
  const existing = persistentChannelArchive.get(cleanCh) || {
    channelTitle: channelTitle || `@${cleanCh}`,
    pdfsByMsgId: new Map<number, ExtractedTelegramPdf>(),
  };
  if (channelTitle) {
    existing.channelTitle = channelTitle;
  }

  let changed = false;
  for (const pdf of incomingPdfs) {
    if (!pdf || typeof pdf.messageId !== 'number') continue;
    const prev = existing.pdfsByMsgId.get(pdf.messageId);
    if (!prev) {
      changed = true;
    }
    existing.pdfsByMsgId.set(pdf.messageId, {
      ...pdf,
      channelUsername: cleanCh,
    });
  }

  persistentChannelArchive.set(cleanCh, existing);
  if (changed) {
    saveArchiveToDisk();
  }

  // Deduplicate by title across the channel while keeping newest first
  const allForChannel = Array.from(existing.pdfsByMsgId.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.messageId - a.messageId
  );

  const seenTitles = new Set<string>();
  const deduped: ExtractedTelegramPdf[] = [];
  for (const item of allForChannel) {
    const titleKey = (item.cleanTitle || item.fileName).toLowerCase().trim();
    const uniqueKey = `${titleKey}_${item.fileSize || 0}`;
    if (seenTitles.has(uniqueKey) || (titleKey && seenTitles.has(titleKey))) {
      continue;
    }
    seenTitles.add(uniqueKey);
    if (titleKey) seenTitles.add(titleKey);
    deduped.push(item);
  }

  return deduped;
}

// 60-second in-memory response cache for the public Explore multi-channel feed
let exploreCache: {
  timestamp: number;
  key: string;
  data: {
    configured: boolean;
    serverHasSession: boolean;
    channels: Array<{
      channel: string;
      channelTitle: string;
      pdfs: ExtractedTelegramPdf[];
    }>;
    allPdfs: ExtractedTelegramPdf[];
  };
} | null = null;

function getApiCredentials(): { apiId: number; apiHash: string } {
  const envId = Number.parseInt((process.env.TELEGRAM_API_ID || '').trim(), 10);
  const envHash = (process.env.TELEGRAM_API_HASH || '').trim();
  if (envId && !Number.isNaN(envId) && envHash) {
    return { apiId: envId, apiHash: envHash };
  }
  return { apiId: DEFAULT_API_ID, apiHash: DEFAULT_API_HASH };
}

export function normalizeTelegramChannel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/(?:https?:\/\/)?(?:t|telegram)\.me\/(?:s\/)?([a-zA-Z0-9_]+)/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1].toLowerCase();
  }
  return trimmed.replace(/^@/, '').trim().toLowerCase();
}

export function parseChannelList(raw: string): string[] {
  if (!raw) return [];
  const items = raw
    .split(/[\n,;]+/)
    .map(s => normalizeTelegramChannel(s))
    .filter(Boolean);
  return Array.from(new Set(items));
}

function getConfiguredServerChannels(extraQueryChannels = ''): string[] {
  const combined = [
    process.env.TELEGRAM_CHANNELS || '',
    process.env.TELEGRAM_CHANNEL || '',
    extraQueryChannels,
  ].join(',');
  return parseChannelList(combined);
}

// In-memory cache for downloaded book cover data URLs
const serverCoverCache = new Map<string, string>();

function stripHandlesAndChannelNames(raw: string, channelTitle = ''): string {
  if (!raw) return '';
  let text = raw
    .replace(/\.pdf$/i, '')
    .replace(/[\(\[\{«]\s*(?:@[a-zA-Z0-9_]+|(?:https?:\/\/)?(?:t|telegram)\.me\/[^\s\)\]\}»]+)\s*[\)\]\}»]/gi, ' ')
    .replace(/@[a-zA-Z0-9_]+/g, ' ')
    .replace(/(?:https?:\/\/)?(?:t|telegram)\.me\/[a-zA-Z0-9_\/]+/gi, ' ');

  const bannedPhrases = [
    'کتاب‌هایی که باید بخونیم',
    'کتاب هایی که باید بخونیم',
    'کتاب‌هایی که باید بخوانیم',
    'کتاب هایی که باید بخوانیم',
    'کتابهایی که باید بخوانیم',
    'کتابهایی که باید بخونیم',
  ];
  for (const phrase of bannedPhrases) {
    text = text.split(phrase).join(' ');
  }
  if (channelTitle && channelTitle.trim()) {
    text = text.split(channelTitle.trim()).join(' ');
  }

  return text
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}|«\s*»/g, ' ')
    .replace(/_+/g, ' ')
    .replace(/^[\s\-–—·.|]+|[\s\-–—·.|]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAuthorFromText(caption: string): string {
  if (!caption) return '';
  const patterns = [
    /(?:نویسنده|نویسندگان|اثر|تألیف|تالیف|نگارش)\s*[:：\-]\s*([^\n\r#@|()]+)/i,
    /(?:author|written by|by)\s*[:：]\s*([^\n\r#@|()]+)/i,
  ];
  for (const regex of patterns) {
    const match = caption.match(regex);
    if (match && match[1]) {
      const cleaned = stripHandlesAndChannelNames(match[1]);
      if (cleaned.length >= 2 && cleaned.length <= 60) {
        return cleaned;
      }
    }
  }
  return '';
}

function messageHasPhoto(msg: Api.Message | undefined): boolean {
  if (!msg || !msg.media) return false;
  if (msg.media instanceof Api.MessageMediaPhoto) return true;
  if (
    msg.media instanceof Api.MessageMediaWebPage &&
    msg.media.webpage instanceof Api.WebPage &&
    msg.media.webpage.photo
  ) {
    return true;
  }
  return false;
}

function findCompanionPhotoMessage(
  pdfMsg: Api.Message,
  indexInList: number,
  allMessages: Api.TypeMessage[]
): Api.Message | undefined {
  // 1. Check direct replyToMsgId
  const replyHeader = pdfMsg.replyTo;
  if (replyHeader && 'replyToMsgId' in replyHeader && replyHeader.replyToMsgId) {
    const targetId = replyHeader.replyToMsgId;
    const found = allMessages.find(
      (m): m is Api.Message => m instanceof Api.Message && m.id === targetId
    );
    if (found && messageHasPhoto(found)) {
      return found;
    }
  }

  // 2. Check same media group (groupedId)
  if (pdfMsg.groupedId) {
    const groupStr = pdfMsg.groupedId.toString();
    const found = allMessages.find(
      (m): m is Api.Message =>
        m instanceof Api.Message &&
        Boolean(m.groupedId) &&
        m.groupedId!.toString() === groupStr &&
        messageHasPhoto(m)
    );
    if (found) return found;
  }

  // 3. Check messages posted immediately before this PDF (indexInList + 1 .. indexInList + 3)
  // Note: GramJS getMessages returns newest first, so indexInList + 1 is the message posted just BEFORE the PDF
  for (let offset = 1; offset <= 3; offset++) {
    const olderMsg = allMessages[indexInList + offset];
    if (!(olderMsg instanceof Api.Message)) continue;
    // Stop if we hit another PDF document before finding a photo
    if (olderMsg.media instanceof Api.MessageMediaDocument && olderMsg.media.document instanceof Api.Document) {
      const mime = (olderMsg.media.document.mimeType || '').toLowerCase();
      if (mime === 'application/pdf') break;
    }
    if (messageHasPhoto(olderMsg)) {
      return olderMsg;
    }
  }

  // 4. Check message posted immediately after this PDF (indexInList - 1)
  if (indexInList > 0) {
    const newerMsg = allMessages[indexInList - 1];
    if (newerMsg instanceof Api.Message && messageHasPhoto(newerMsg)) {
      return newerMsg;
    }
  }

  return undefined;
}

function extractPdfFromMessage(
  msg: Api.Message,
  channelUsername: string,
  channelTitle: string,
  indexInList = 0,
  allMessages: Api.TypeMessage[] = []
) {
  if (!msg || !msg.media) return null;
  if (!(msg.media instanceof Api.MessageMediaDocument)) return null;

  const doc = msg.media.document;
  if (!(doc instanceof Api.Document)) return null;

  const mimeType = (doc.mimeType || '').toLowerCase();
  let fileName = `telegram_book_${msg.id}.pdf`;

  for (const attr of doc.attributes || []) {
    if (attr instanceof Api.DocumentAttributeFilename && attr.fileName) {
      fileName = attr.fileName;
      break;
    }
  }

  const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
  if (!isPdf) return null;

  const fileSize = Number(doc.size?.toString() || '0');
  const dateObj = msg.date ? new Date(msg.date * 1000) : new Date();

  const companionPhoto = findCompanionPhotoMessage(msg, indexInList, allMessages);
  const combinedCaption = [msg.message || '', companionPhoto?.message || '']
    .map(s => s.trim())
    .filter(Boolean)
    .join('\n');

  const cleanBaseName = stripHandlesAndChannelNames(fileName, channelTitle) || `Book ${msg.id}`;
  const cleanFileName = `${cleanBaseName}.pdf`;
  const author = parseAuthorFromText(combinedCaption);
  const hasThumb = Boolean((doc.thumbs && doc.thumbs.length > 0) || companionPhoto);

  return {
    messageId: msg.id,
    fileName: cleanFileName,
    cleanTitle: cleanBaseName,
    author,
    fileSize,
    date: dateObj.toISOString(),
    caption: stripHandlesAndChannelNames(combinedCaption, channelTitle),
    channelTitle: '',
    channelUsername,
    coverPhotoMsgId: companionPhoto?.id,
    hasThumb,
  };
}

async function fetchExternalBookCoverDataUrl(title: string): Promise<string | null> {
  if (!title || title.length < 2) return null;
  try {
    const query = encodeURIComponent(title);
    const gRes = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=3`,
      { signal: AbortSignal.timeout(4500) }
    );
    if (gRes.ok) {
      const gData = await gRes.json();
      const items = Array.isArray(gData?.items) ? gData.items : [];
      for (const item of items) {
        const links = item?.volumeInfo?.imageLinks;
        const rawThumb = links?.thumbnail || links?.smallThumbnail;
        if (typeof rawThumb === 'string' && rawThumb) {
          const httpsUrl = rawThumb.replace(/^http:\/\//i, 'https://');
          const imgRes = await fetch(httpsUrl, { signal: AbortSignal.timeout(4500) });
          if (imgRes.ok) {
            const arr = await imgRes.arrayBuffer();
            if (arr.byteLength > 200) {
              const mime = imgRes.headers.get('content-type') || 'image/jpeg';
              return `data:${mime};base64,${Buffer.from(arr).toString('base64')}`;
            }
          }
        }
      }
    }
  } catch {
    // ignore external cover lookup errors
  }
  return null;
}

// Vercel Serverless & Express Unified Handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  const rawUrl = req.originalUrl || req.url || '/';
  const urlObj = new URL(rawUrl, 'http://localhost');
  const actionParam = String(req.query?.action || '');
  const pathname = urlObj.pathname.replace(/^\/api\/telegram\/?/, '').replace(/^\//, '') || actionParam;

  const headerSession = String(req.headers?.['x-telegram-session'] || '').trim();
  const querySession = String(req.query?.session || '').trim();
  const envSession = (process.env.TELEGRAM_SESSION || '').trim();
  const activeSession = envSession || headerSession || querySession;

  const { apiId, apiHash } = getApiCredentials();

  try {
    // 1. GET /api/telegram/status
    if (pathname === 'status' || pathname === '') {
      const serverChannels = getConfiguredServerChannels();
      const defaultChannel = serverChannels[0] || '';
      return res.status(200).json({
        configured: Boolean(activeSession),
        serverConfigured: Boolean(envSession),
        hasApiId: true,
        hasApiHash: true,
        hasSession: Boolean(activeSession),
        defaultChannel,
        serverChannels,
      });
    }

    // 1b. GET /api/telegram/explore-feed
    if (pathname === 'explore-feed') {
      const extraChannels = String(req.query?.channels || '');
      const forceRefresh = req.query?.refresh === 'true';
      const channels = getConfiguredServerChannels(extraChannels);

      if (!activeSession || channels.length === 0) {
        return res.status(200).json({
          configured: Boolean(activeSession),
          serverHasSession: Boolean(envSession),
          channels: [],
          allPdfs: [],
        });
      }

      const cacheKey = `v2:${activeSession.slice(0, 12)}:${channels.join(',')}`;
      const now = Date.now();
      if (
        !forceRefresh &&
        exploreCache &&
        exploreCache.key === cacheKey &&
        now - exploreCache.timestamp < 90_000
      ) {
        return res.status(200).json(exploreCache.data);
      }

      loadArchiveFromDiskOnce();
      const client = await getConnectedClient(activeSession, apiId, apiHash);

      const channelResults: Array<{
        channel: string;
        channelTitle: string;
        pdfs: ExtractedTelegramPdf[];
      }> = [];
      const allPdfs: ExtractedTelegramPdf[] = [];
      const seenEntityIds = new Set<string>();
      const seenGlobalPdfKeys = new Set<string>();

      for (const ch of channels) {
        try {
          const entity = await client.getEntity(ch);
          const entityIdStr =
            entity && 'id' in entity && entity.id ? String(entity.id) : ch.toLowerCase();
          if (seenEntityIds.has(entityIdStr)) {
            continue;
          }
          seenEntityIds.add(entityIdStr);

          const channelTitle =
            (entity && 'title' in entity && typeof entity.title === 'string' && entity.title) || `@${ch}`;

          // Fetch document messages using InputMessagesFilterDocument.
          // On initial archive build (or forceRefresh), paginate backward through the channel's entire document history
          // so there is NO 250-book limit; on normal quick checks, fetch the latest 100 documents and merge into the permanent archive.
          const existingChannelArchive = persistentChannelArchive.get(ch.toLowerCase().trim());
          const hasExistingArchive = Boolean(existingChannelArchive && existingChannelArchive.pdfsByMsgId.size > 0);
          const maxPagesToWalk = !hasExistingArchive || forceRefresh ? 20 : 1; // up to 20 * 100 = 2,000+ existing books on full scan, plus unlimited cumulative archive forever

          const freshlyExtracted: ExtractedTelegramPdf[] = [];
          let offsetId = 0;

          for (let pageIdx = 0; pageIdx < maxPagesToWalk; pageIdx++) {
            let docMessages: Api.TypeMessage[] = [];
            try {
              docMessages = await client.getMessages(entity, {
                limit: 100,
                offsetId,
                filter: new Api.InputMessagesFilterDocument(),
              });
            } catch {
              docMessages = await client.getMessages(entity, {
                limit: 100,
                offsetId,
              });
            }

            if (!docMessages || docMessages.length === 0) break;

            for (let i = 0; i < docMessages.length; i++) {
              const msg = docMessages[i];
              if (msg instanceof Api.Message) {
                const extracted = extractPdfFromMessage(msg, ch, channelTitle, i, docMessages);
                if (extracted) {
                  freshlyExtracted.push(extracted);
                }
              }
            }

            const lastMsg = docMessages[docMessages.length - 1];
            const lastId = lastMsg && 'id' in lastMsg && typeof lastMsg.id === 'number' ? lastMsg.id : 0;
            if (!lastId || lastId === offsetId || docMessages.length < 100) {
              break;
            }
            offsetId = lastId;
          }

          // Merge into permanent cumulative archive so older PDFs stay forever
          const cumulativeChannelPdfs = mergeChannelPdfsIntoArchive(
            ch,
            channelTitle,
            freshlyExtracted
          );

          for (const item of cumulativeChannelPdfs) {
            const titleKey = (item.cleanTitle || item.fileName).toLowerCase().trim();
            const uniqueKey = `${titleKey}_${item.fileSize || 0}`;
            if (!seenGlobalPdfKeys.has(uniqueKey) && !seenGlobalPdfKeys.has(titleKey)) {
              seenGlobalPdfKeys.add(uniqueKey);
              seenGlobalPdfKeys.add(titleKey);
              allPdfs.push(item);
            }
          }

          channelResults.push({
            channel: ch,
            channelTitle,
            pdfs: cumulativeChannelPdfs,
          });
        } catch (chErr) {
          console.warn(`[/api/telegram/explore-feed] Could not read channel @${ch}:`, chErr);
          // Even if Telegram temporarily fails, return all previously archived PDFs for this channel
          const fallbackArchived = mergeChannelPdfsIntoArchive(ch, `@${ch}`, []);
          if (fallbackArchived.length > 0) {
            for (const item of fallbackArchived) {
              const titleKey = (item.cleanTitle || item.fileName).toLowerCase().trim();
              const uniqueKey = `${titleKey}_${item.fileSize || 0}`;
              if (!seenGlobalPdfKeys.has(uniqueKey) && !seenGlobalPdfKeys.has(titleKey)) {
                seenGlobalPdfKeys.add(uniqueKey);
                seenGlobalPdfKeys.add(titleKey);
                allPdfs.push(item);
              }
            }
            channelResults.push({
              channel: ch,
              channelTitle: `@${ch}`,
              pdfs: fallbackArchived,
            });
          }
        }
      }

      allPdfs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const responseData = {
        configured: true,
        serverHasSession: Boolean(envSession),
        channels: channelResults,
        allPdfs,
      };

      exploreCache = {
        timestamp: now,
        key: cacheKey,
        data: responseData,
      };

      return res.status(200).json(responseData);
    }

    // 1c. GET /api/telegram/cover
    if (pathname === 'cover') {
      const rawChannel = String(req.query?.channel || process.env.TELEGRAM_CHANNEL || '');
      const channel = normalizeTelegramChannel(rawChannel);
      const messageId = Number.parseInt(String(req.query?.messageId || '0'), 10);
      const photoMsgId = Number.parseInt(String(req.query?.photoMsgId || '0'), 10);
      const title = String(req.query?.title || '').trim();

      const cacheKey = `${channel}:${messageId}:${photoMsgId}`;
      const cached = serverCoverCache.get(cacheKey);
      if (cached) {
        return res.status(200).json({ ok: true, coverUrl: cached });
      }

      let coverDataUrl: string | null = null;

      if (activeSession && channel && (messageId > 0 || photoMsgId > 0)) {
        try {
          const client = await getConnectedClient(activeSession, apiId, apiHash);
          const entity = await client.getEntity(channel);

          // Step A: Try companion photo message or adjacent messages around messageId
          const idsToFetch: number[] = [];
          if (photoMsgId > 0) idsToFetch.push(photoMsgId);
          if (messageId > 0) {
            idsToFetch.push(messageId);
            if (!photoMsgId) {
              // Also check immediately preceding/succeeding message IDs for a cover photo post
              if (messageId > 1) idsToFetch.push(messageId - 1);
              if (messageId > 2) idsToFetch.push(messageId - 2);
              idsToFetch.push(messageId + 1);
            }
          }

          const uniqueIds = Array.from(new Set(idsToFetch));
          const msgs = await client.getMessages(entity, { ids: uniqueIds });
          const validMsgs = (msgs || []).filter((m): m is Api.Message => m instanceof Api.Message);

          // 1) Check explicit photoMsgId first, then adjacent photo messages
          const targetPhotoMsg =
            validMsgs.find(m => photoMsgId > 0 && m.id === photoMsgId && messageHasPhoto(m)) ||
            validMsgs.find(m => m.id !== messageId && messageHasPhoto(m));

          if (targetPhotoMsg) {
            const buf = await client.downloadMedia(targetPhotoMsg, {});
            if (buf && Buffer.isBuffer(buf) && buf.byteLength > 100) {
              coverDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
            }
          }

          // 2) If no companion photo, check the PDF document's own embedded thumbnail
          if (!coverDataUrl && messageId > 0) {
            const pdfMsg = validMsgs.find(m => m.id === messageId);
            if (
              pdfMsg &&
              pdfMsg.media instanceof Api.MessageMediaDocument &&
              pdfMsg.media.document instanceof Api.Document
            ) {
              const doc = pdfMsg.media.document;
              if (doc.thumbs && doc.thumbs.length > 0) {
                const thumbObj = doc.thumbs[doc.thumbs.length - 1];
                const thumbBuf = await client.downloadMedia(pdfMsg, {
                  thumb: thumbObj as never,
                });
                if (thumbBuf && Buffer.isBuffer(thumbBuf) && thumbBuf.byteLength > 80) {
                  coverDataUrl = `data:image/jpeg;base64,${thumbBuf.toString('base64')}`;
                }
              }
            }
          }
        } catch (tgCoverErr) {
          console.warn('[/api/telegram/cover] Telegram media thumb notice:', tgCoverErr);
        }
      }

      // Step B: Fallback to Google Books cover lookup by cleaned book title
      if (!coverDataUrl && title) {
        coverDataUrl = await fetchExternalBookCoverDataUrl(title);
      }

      if (coverDataUrl) {
        if (serverCoverCache.size > 150) {
          const firstKey = serverCoverCache.keys().next().value;
          if (firstKey) serverCoverCache.delete(firstKey);
        }
        serverCoverCache.set(cacheKey, coverDataUrl);
      }

      return res.status(200).json({
        ok: Boolean(coverDataUrl),
        coverUrl: coverDataUrl || null,
      });
    }

    // 2. POST /api/telegram/auth/send-code
    if (pathname === 'auth/send-code' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const phoneNumber = String(body.phoneNumber || '').trim();
      if (!phoneNumber) {
        return res.status(400).json({
          error: 'Please enter your phone number in international format (e.g. +1234567890).',
        });
      }

      const silentLogger = new Logger('none' as never);
      const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 2,
        retryDelay: 500,
        timeout: 10,
        autoReconnect: false,
        baseLogger: silentLogger,
      });
      await client.connect();

      const result = await client.sendCode({ apiId, apiHash }, phoneNumber);
      const pendingSession = (client.session.save() as unknown as string) || '';
      clientPool.set(`${apiId}:${pendingSession.slice(0, 32)}`, client);

      return res.status(200).json({
        ok: true,
        phoneNumber,
        phoneCodeHash: result.phoneCodeHash,
        pendingSession,
      });
    }

    // 3. POST /api/telegram/auth/verify-code
    if (pathname === 'auth/verify-code' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const phoneNumber = String(body.phoneNumber || '').trim();
      const phoneCode = String(body.phoneCode || '').trim();
      const phoneCodeHash = String(body.phoneCodeHash || '').trim();
      const pendingSession = String(body.pendingSession || '').trim();
      const password = String(body.password || '').trim();

      if (!phoneNumber || !phoneCodeHash || !pendingSession) {
        return res.status(400).json({
          error: 'Session expired. Please click "Send Login Code" again.',
        });
      }

      if (!phoneCode) {
        return res.status(400).json({
          error: 'Please enter the 5-digit verification code sent to your Telegram app.',
        });
      }

      const client = await getConnectedClient(pendingSession, apiId, apiHash);

      try {
        await client.invoke(
          new Api.auth.SignIn({
            phoneNumber,
            phoneCodeHash,
            phoneCode,
          })
        );
      } catch (signInErr: unknown) {
        const errMsg = signInErr instanceof Error ? signInErr.message : String(signInErr);
        if (errMsg.includes('SESSION_PASSWORD_NEEDED')) {
          if (!password) {
            return res.status(401).json({
              needsPassword: true,
              error: 'Your Telegram account has 2-Step Verification (2FA) enabled. Enter your 2FA password below.',
            });
          }
          await client.signInWithPassword(
            { apiId, apiHash },
            {
              password: async () => password,
              onError: e => {
                throw e;
              },
            }
          );
        } else {
          throw signInErr;
        }
      }

      const sessionString = (client.session.save() as unknown as string) || '';
      clientPool.set(`${apiId}:${sessionString.slice(0, 32)}`, client);

      return res.status(200).json({
        ok: true,
        configured: true,
        sessionString,
      });
    }

    // 4. POST /api/telegram/auth/logout
    if (pathname === 'auth/logout') {
      clientPool.clear();
      return res.status(200).json({ ok: true });
    }

    // 5. GET /api/telegram/channel-pdfs
    if (pathname === 'channel-pdfs') {
      const rawChannel = String(req.query?.channel || process.env.TELEGRAM_CHANNEL || '');
      const channel = normalizeTelegramChannel(rawChannel);
      const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 35));

      if (!channel) {
        return res.status(400).json({
          error: 'Please provide a Telegram channel username (e.g. @channelname).',
        });
      }

      if (!activeSession) {
        return res.status(401).json({
          error: 'Please sign in with your phone number above first to connect to Telegram.',
        });
      }

      const client = await getConnectedClient(activeSession, apiId, apiHash);
      const entity = await client.getEntity(channel);
      const channelTitle =
        (entity && 'title' in entity && typeof entity.title === 'string' && entity.title) || `@${channel}`;

      let messages: Api.TypeMessage[] = [];
      try {
        messages = await client.getMessages(entity, {
          limit: Math.max(limit, 200),
          filter: new Api.InputMessagesFilterDocument(),
        });
      } catch {
        messages = await client.getMessages(entity, { limit: Math.max(limit, 120) });
      }

      const pdfItems: ExtractedTelegramPdf[] = [];

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg instanceof Api.Message) {
          const extracted = extractPdfFromMessage(msg, channel, channelTitle, i, messages);
          if (extracted) {
            pdfItems.push(extracted);
          }
        }
      }

      const cumulativePdfs = mergeChannelPdfsIntoArchive(channel, channelTitle, pdfItems);

      return res.status(200).json({
        channel,
        channelTitle,
        pdfs: cumulativePdfs,
      });
    }

    // 6. GET /api/telegram/download-pdf
    if (pathname === 'download-pdf') {
      const rawChannel = String(req.query?.channel || process.env.TELEGRAM_CHANNEL || '');
      const channel = normalizeTelegramChannel(rawChannel);
      const messageId = Number.parseInt(String(req.query?.messageId || ''), 10);

      if (!channel || !messageId || Number.isNaN(messageId)) {
        return res.status(400).json({
          error: 'Both channel and messageId query parameters are required.',
        });
      }

      if (!activeSession) {
        return res.status(401).json({
          error: 'Not signed in to Telegram. Please sign in first.',
        });
      }

      const client = await getConnectedClient(activeSession, apiId, apiHash);
      const entity = await client.getEntity(channel);
      const messages = await client.getMessages(entity, { ids: [messageId] });
      const msg = messages?.[0];

      if (!msg || !(msg instanceof Api.Message)) {
        return res.status(404).json({ error: `Message #${messageId} not found in @${channel}.` });
      }

      const meta = extractPdfFromMessage(msg, channel, channel);
      if (!meta) {
        return res.status(400).json({ error: `Message #${messageId} does not contain a valid PDF document.` });
      }

      const buffer = await client.downloadMedia(msg, {});

      if (!buffer || !(buffer instanceof Buffer)) {
        return res.status(500).json({ error: 'Failed to download PDF binary stream from Telegram.' });
      }

      const safeFilename = encodeURIComponent(meta.fileName);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(buffer.byteLength));
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('X-Telegram-Filename', safeFilename);
      res.setHeader('X-Telegram-Message-Id', String(meta.messageId));
      return res.status(200).send(buffer);
    }

    return res.status(404).json({ error: `Unknown Telegram API route: ${pathname}` });
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : 'Telegram server error.';
    console.warn('[/api/telegram] Notice:', rawMessage);
    const friendlyMessage =
      rawMessage === 'TIMEOUT' || rawMessage.includes('TIMEOUT')
        ? 'Connection to Telegram MTProto timed out in this cloud environment. If you deployed to Vercel, open your Vercel URL to sign in directly.'
        : rawMessage;
    return res.status(200).json({
      ok: false,
      configured: false,
      channels: [],
      allPdfs: [],
      pdfs: [],
      error: friendlyMessage,
    });
  }
}
