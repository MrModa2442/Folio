import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Logger } from 'telegram/extensions/index.js';
import fs from 'fs';
import path from 'path';
import builtInCatalogJson from '../src/data/builtInExploreCatalog.json' with { type: 'json' };

const DEFAULT_API_ID = 2040;
const DEFAULT_API_HASH = 'b18441a1ff607e10a989891a5462e627';

// Suppress GramJS background update/ping TIMEOUT and invalidated session unhandled rejections
if (typeof process !== 'undefined' && process.on) {
  process.on('unhandledRejection', (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    if (
      msg.includes('TIMEOUT') ||
      msg.includes('Not connected') ||
      msg.includes('AUTH_KEY_DUPLICATED') ||
      msg.includes('AUTH_KEY_UNREGISTERED') ||
      msg.includes('SESSION_REVOKED')
    ) {
      // Ignore benign GramJS background socket timeout or evicted session notices
      return;
    }
  });
}

// Reusable connected client cache + in-flight connection lock so parallel requests
// never open duplicate TCP sockets with the same StringSession (which causes 406: AUTH_KEY_DUPLICATED)
const clientPool = new Map<string, TelegramClient>();
const clientIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const clientConnectingPool = new Map<string, Promise<TelegramClient>>();
const invalidatedSessions = new Set<string>();

function getSessionPoolKey(sessionStr: string, apiId: number): string {
  return `${apiId}:${sessionStr.slice(0, 48)}`;
}

// Disconnect idle MTProto sockets after 10 seconds so AI Studio and Vercel never hold simultaneous open sockets
function scheduleIdleDisconnect(sessionStr: string, apiId: number): void {
  if (!sessionStr) return;
  const key = getSessionPoolKey(sessionStr, apiId);
  const existingTimer = clientIdleTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    clientIdleTimers.delete(key);
    const client = clientPool.get(key);
    if (client) {
      clientPool.delete(key);
      client.disconnect().catch(() => {});
    }
  }, 10_000);
  clientIdleTimers.set(key, timer);
}

function isSessionInvalidError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const errCodeMsg =
    typeof err === 'object' && err !== null && 'errorMessage' in err
      ? String((err as { errorMessage?: unknown }).errorMessage || '')
      : '';
  const combined = `${msg} ${errCodeMsg}`;
  return (
    combined.includes('AUTH_KEY_DUPLICATED') ||
    combined.includes('AUTH_KEY_UNREGISTERED') ||
    combined.includes('AUTH_KEY_INVALID') ||
    combined.includes('SESSION_REVOKED') ||
    combined.includes('USER_DEACTIVATED')
  );
}

function markSessionInvalidated(sessionStr: string, apiId: number): void {
  if (!sessionStr) return;
  invalidatedSessions.add(sessionStr);
  const key = getSessionPoolKey(sessionStr, apiId);
  clientConnectingPool.delete(key);
  const existing = clientPool.get(key);
  if (existing) {
    clientPool.delete(key);
    existing.disconnect().catch(() => {});
  }
}

async function getConnectedClient(
  sessionStr: string,
  apiId: number,
  apiHash: string
): Promise<TelegramClient> {
  if (sessionStr && invalidatedSessions.has(sessionStr)) {
    throw new Error('TELEGRAM_SESSION_INVALIDATED');
  }

  const key = getSessionPoolKey(sessionStr, apiId);
  const existing = clientPool.get(key);
  if (existing && existing.connected) {
    return existing;
  }

  const inflight = clientConnectingPool.get(key);
  if (inflight) {
    return inflight;
  }

  const connectPromise = (async () => {
    const silentLogger = new Logger('none' as never);
    const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
      connectionRetries: 2,
      retryDelay: 500,
      timeout: 10,
      autoReconnect: false,
      baseLogger: silentLogger,
    });

    try {
      await client.connect();
      if (sessionStr) {
        clientPool.set(key, client);
        scheduleIdleDisconnect(sessionStr, apiId);
      }
      return client;
    } catch (connErr) {
      if (isSessionInvalidError(connErr)) {
        markSessionInvalidated(sessionStr, apiId);
        throw new Error('TELEGRAM_SESSION_INVALIDATED');
      }
      throw connErr;
    } finally {
      clientConnectingPool.delete(key);
    }
  })();

  if (sessionStr) {
    clientConnectingPool.set(key, connectPromise);
  }

  return connectPromise;
}

type ExtractedTelegramPdf = NonNullable<ReturnType<typeof extractPdfFromMessage>>;

const BUILTIN_CATALOG_PATH = path.resolve(process.cwd(), 'src/data/builtInExploreCatalog.json');
const ARCHIVE_FILE_PATHS = [
  path.resolve(process.cwd(), '.folio-explore-archive.json'),
  '/tmp/folio-explore-archive.json',
];

let runtimeBakedSession = String((builtInCatalogJson as { bakedSession?: string })?.bakedSession || '').trim();

function getBakedSession(): string {
  try {
    if (fs.existsSync(BUILTIN_CATALOG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(BUILTIN_CATALOG_PATH, 'utf-8'));
      if (raw?.bakedSession && typeof raw.bakedSession === 'string') {
        runtimeBakedSession = raw.bakedSession.trim();
      }
    }
  } catch {
    // ignore read error on serverless read-only fs
  }
  return runtimeBakedSession;
}

const persistentChannelArchive = new Map<
  string,
  {
    channelTitle: string;
    pdfsByMsgId: Map<number, ExtractedTelegramPdf>;
  }
>();
let archiveLoadedFromDisk = false;

function ingestChannelRecordMap(
  parsedChannels: Record<string, { channelTitle: string; pdfs: ExtractedTelegramPdf[] }> | undefined
) {
  if (!parsedChannels || typeof parsedChannels !== 'object') return;
  for (const [ch, entry] of Object.entries(parsedChannels)) {
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
}

function loadArchiveFromDiskOnce() {
  if (archiveLoadedFromDisk) return;
  archiveLoadedFromDisk = true;

  // 1. Load compiled-in src/data/builtInExploreCatalog.json first (works on Vercel out-of-the-box)
  try {
    const staticChannels = (
      builtInCatalogJson as unknown as {
        channels?: Record<string, { channelTitle: string; pdfs: ExtractedTelegramPdf[] }>;
      }
    )?.channels;
    ingestChannelRecordMap(staticChannels);
  } catch {
    // ignore
  }

  // 2. Load latest on-disk src/data/builtInExploreCatalog.json if updated at runtime
  try {
    if (fs.existsSync(BUILTIN_CATALOG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(BUILTIN_CATALOG_PATH, 'utf-8'));
      if (raw?.bakedSession) runtimeBakedSession = String(raw.bakedSession).trim();
      ingestChannelRecordMap(raw?.channels);
    }
  } catch {
    // ignore
  }

  // 3. Load legacy runtime archive files if present
  for (const filePath of ARCHIVE_FILE_PATHS) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<
          string,
          { channelTitle: string; pdfs: ExtractedTelegramPdf[] }
        >;
        ingestChannelRecordMap(parsed);
        break;
      }
    } catch {
      // ignore disk read errors
    }
  }
}

function saveArchiveToDisk(newBakedSession?: string) {
  if (newBakedSession && newBakedSession.trim()) {
    runtimeBakedSession = newBakedSession.trim();
  }
  const serialized: Record<string, { channelTitle: string; pdfs: ExtractedTelegramPdf[] }> = {};
  for (const [ch, entry] of persistentChannelArchive.entries()) {
    serialized[ch] = {
      channelTitle: entry.channelTitle,
      pdfs: Array.from(entry.pdfsByMsgId.values()),
    };
  }

  // Write to src/data/builtInExploreCatalog.json so git push / Vercel deploy includes the books and session inside the app
  try {
    const builtInPayload = JSON.stringify(
      {
        bakedSession: runtimeBakedSession || '',
        defaultChannels: 'ocbooks',
        channels: serialized,
      },
      null,
      2
    );
    fs.writeFileSync(BUILTIN_CATALOG_PATH, builtInPayload, 'utf-8');
  } catch {
    // ignore on read-only serverless fs
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
  if (channelTitle && !channelTitle.startsWith('@')) {
    existing.channelTitle = channelTitle;
  } else if (!existing.channelTitle) {
    existing.channelTitle = channelTitle || `@${cleanCh}`;
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

function buildArchivedExploreResponse(
  channels: string[],
  serverHasSession: boolean,
  sessionInvalidated: boolean
) {
  loadArchiveFromDiskOnce();
  const targetChannels =
    channels.length > 0 ? channels : Array.from(persistentChannelArchive.keys());

  const channelResults: Array<{
    channel: string;
    channelTitle: string;
    pdfs: ExtractedTelegramPdf[];
  }> = [];
  const allPdfs: ExtractedTelegramPdf[] = [];
  const seenGlobalPdfKeys = new Set<string>();

  for (const ch of targetChannels) {
    const cleanCh = ch.toLowerCase().trim();
    const archivedEntry = persistentChannelArchive.get(cleanCh);
    const channelTitle = archivedEntry?.channelTitle || `@${cleanCh}`;
    const archivedPdfs = mergeChannelPdfsIntoArchive(cleanCh, channelTitle, []);
    if (archivedPdfs.length > 0) {
      for (const item of archivedPdfs) {
        const titleKey = (item.cleanTitle || item.fileName).toLowerCase().trim();
        const uniqueKey = `${titleKey}_${item.fileSize || 0}`;
        if (!seenGlobalPdfKeys.has(uniqueKey) && !seenGlobalPdfKeys.has(titleKey)) {
          seenGlobalPdfKeys.add(uniqueKey);
          seenGlobalPdfKeys.add(titleKey);
          allPdfs.push(item);
        }
      }
      channelResults.push({
        channel: cleanCh,
        channelTitle,
        pdfs: archivedPdfs,
      });
    }
  }

  allPdfs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    configured: allPdfs.length > 0 || serverHasSession,
    serverHasSession,
    sessionInvalidated,
    channels: channelResults,
    allPdfs,
  };
}

// 60-second in-memory response cache for the public Explore multi-channel feed
let exploreCache: {
  timestamp: number;
  key: string;
  data: {
    configured: boolean;
    serverHasSession: boolean;
    sessionInvalidated?: boolean;
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

const DEFAULT_EXPLORE_CHANNELS = 'ocbooks';

function getConfiguredServerChannels(extraQueryChannels = ''): string[] {
  loadArchiveFromDiskOnce();
  const archivedChannels = Array.from(persistentChannelArchive.keys()).join(',');
  const combined = [
    process.env.TELEGRAM_CHANNELS || '',
    process.env.TELEGRAM_CHANNEL || '',
    extraQueryChannels,
    archivedChannels,
    DEFAULT_EXPLORE_CHANNELS,
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
  const bakedSession = getBakedSession();
  const envSession = (process.env.TELEGRAM_SESSION || '').trim();

  // If the owner's browser sends a verified session header that isn't baked into src/data/builtInExploreCatalog.json yet,
  // bake it into the source code immediately so Vercel deployments have it built in.
  if (headerSession && !invalidatedSessions.has(headerSession) && headerSession !== bakedSession) {
    loadArchiveFromDiskOnce();
    saveArchiveToDisk(headerSession);
  }

  // Pick a valid session that hasn't been invalidated by AUTH_KEY_DUPLICATED
  const candidateSessions = [headerSession, querySession, getBakedSession(), envSession].filter(Boolean);
  const validCandidateSession = candidateSessions.find(s => !invalidatedSessions.has(s)) || '';
  const wasSessionInvalidated =
    candidateSessions.length > 0 && !validCandidateSession;
  const activeSession = validCandidateSession;

  const { apiId, apiHash } = getApiCredentials();

  try {
    // 1. GET /api/telegram/status
    if (pathname === 'status' || pathname === '') {
      const serverChannels = getConfiguredServerChannels();
      const defaultChannel = serverChannels[0] || '';
      const validEnvSession = Boolean(envSession && !invalidatedSessions.has(envSession));
      return res.status(200).json({
        configured: Boolean(activeSession),
        serverConfigured: validEnvSession,
        hasApiId: true,
        hasApiHash: true,
        hasSession: Boolean(activeSession),
        sessionInvalidated: wasSessionInvalidated,
        defaultChannel,
        serverChannels,
      });
    }

    // 1b. GET /api/telegram/explore-feed
    if (pathname === 'explore-feed') {
      const extraChannels = String(req.query?.channels || '');
      const forceRefresh = req.query?.refresh === 'true';
      if (forceRefresh) {
        invalidatedSessions.clear();
      }
      const channels = getConfiguredServerChannels(extraChannels);
      const retryCandidateSession = candidateSessions.find(s => !invalidatedSessions.has(s)) || '';
      const sessionToUse = retryCandidateSession || activeSession;
      const validEnvSession = Boolean(envSession && !invalidatedSessions.has(envSession));

      if (!sessionToUse || channels.length === 0) {
        const archivedResponse = buildArchivedExploreResponse(
          channels,
          validEnvSession,
          wasSessionInvalidated
        );
        return res.status(200).json(archivedResponse);
      }

      const cacheKey = `v2:${sessionToUse.slice(0, 12)}:${channels.join(',')}`;
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
      let client: TelegramClient | null = null;
      let sessionFailedDuringScan = false;

      try {
        client = await getConnectedClient(sessionToUse, apiId, apiHash);
      } catch (connErr) {
        if (isSessionInvalidError(connErr) || (connErr instanceof Error && connErr.message === 'TELEGRAM_SESSION_INVALIDATED')) {
          markSessionInvalidated(sessionToUse, apiId);
          sessionFailedDuringScan = true;
        } else {
          // Even on transient network timeouts, serve the persistent archive cleanly
          const archivedResponse = buildArchivedExploreResponse(channels, validEnvSession, false);
          return res.status(200).json(archivedResponse);
        }
      }

      if (sessionFailedDuringScan || !client) {
        const archivedResponse = buildArchivedExploreResponse(channels, false, true);
        return res.status(200).json(archivedResponse);
      }

      const channelResults: Array<{
        channel: string;
        channelTitle: string;
        pdfs: ExtractedTelegramPdf[];
      }> = [];
      const allPdfs: ExtractedTelegramPdf[] = [];
      const seenEntityIds = new Set<string>();
      const seenGlobalPdfKeys = new Set<string>();

      for (const ch of channels) {
        const cleanCh = ch.toLowerCase().trim();
        const archivedEntry = persistentChannelArchive.get(cleanCh);
        const archivedTitle = archivedEntry?.channelTitle || `@${cleanCh}`;

        if (sessionFailedDuringScan) {
          const fallbackArchived = mergeChannelPdfsIntoArchive(cleanCh, archivedTitle, []);
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
              channel: cleanCh,
              channelTitle: archivedTitle,
              pdfs: fallbackArchived,
            });
          }
          continue;
        }

        try {
          const entity = await client.getEntity(ch);
          const entityIdStr =
            entity && 'id' in entity && entity.id ? String(entity.id) : cleanCh;
          if (seenEntityIds.has(entityIdStr)) {
            continue;
          }
          seenEntityIds.add(entityIdStr);

          const channelTitle =
            (entity && 'title' in entity && typeof entity.title === 'string' && entity.title) || archivedTitle;

          const hasExistingArchive = Boolean(archivedEntry && archivedEntry.pdfsByMsgId.size > 0);
          const maxPagesToWalk = !hasExistingArchive || forceRefresh ? 20 : 1;

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
            } catch (msgErr) {
              if (isSessionInvalidError(msgErr)) {
                throw msgErr;
              }
              docMessages = await client.getMessages(entity, {
                limit: 100,
                offsetId,
              });
            }

            if (!docMessages || docMessages.length === 0) break;

            for (let i = 0; i < docMessages.length; i++) {
              const msg = docMessages[i];
              if (msg instanceof Api.Message) {
                const extracted = extractPdfFromMessage(msg, cleanCh, channelTitle, i, docMessages);
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
            cleanCh,
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
            channel: cleanCh,
            channelTitle,
            pdfs: cumulativeChannelPdfs,
          });
        } catch (chErr) {
          if (isSessionInvalidError(chErr)) {
            markSessionInvalidated(activeSession, apiId);
            sessionFailedDuringScan = true;
          }
          // Return all previously archived PDFs for this channel without logging scary RPCErrors
          const fallbackArchived = mergeChannelPdfsIntoArchive(cleanCh, archivedTitle, []);
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
              channel: cleanCh,
              channelTitle: archivedTitle,
              pdfs: fallbackArchived,
            });
          }
        }
      }

      allPdfs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const responseData = {
        configured: !sessionFailedDuringScan || allPdfs.length > 0,
        serverHasSession: Boolean(envSession && !invalidatedSessions.has(envSession)),
        sessionInvalidated: sessionFailedDuringScan || wasSessionInvalidated,
        channels: channelResults,
        allPdfs,
      };

      if (!sessionFailedDuringScan) {
        saveArchiveToDisk(sessionToUse);
        scheduleIdleDisconnect(sessionToUse, apiId);
        exploreCache = {
          timestamp: now,
          key: cacheKey,
          data: responseData,
        };
      }

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

      // Avoid opening concurrent TelegramClient connections on Vercel serverless cover requests
      // (which triggers 406: AUTH_KEY_DUPLICATED when multiple book cards load simultaneously).
      let coverDataUrl: string | null = null;
      if (title) {
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
      clientPool.set(getSessionPoolKey(pendingSession, apiId), client);

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
      invalidatedSessions.delete(sessionString);
      clientPool.set(getSessionPoolKey(sessionString, apiId), client);
      scheduleIdleDisconnect(sessionString, apiId);
      saveArchiveToDisk(sessionString);

      return res.status(200).json({
        ok: true,
        configured: true,
        sessionString,
      });
    }

    // 4. POST /api/telegram/auth/logout
    if (pathname === 'auth/logout') {
      for (const client of clientPool.values()) {
        client.disconnect().catch(() => {});
      }
      clientPool.clear();
      clientConnectingPool.clear();
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

      loadArchiveFromDiskOnce();
      const archivedEntry = persistentChannelArchive.get(channel);
      const archivedTitle = archivedEntry?.channelTitle || `@${channel}`;

      if (!activeSession) {
        const archivedPdfs = mergeChannelPdfsIntoArchive(channel, archivedTitle, []);
        if (archivedPdfs.length > 0) {
          return res.status(200).json({
            channel,
            channelTitle: archivedTitle,
            pdfs: archivedPdfs,
            sessionInvalidated: wasSessionInvalidated,
          });
        }
        return res.status(401).json({
          sessionInvalidated: wasSessionInvalidated,
          error: wasSessionInvalidated
            ? 'Your Telegram session was reset because it was active in two places simultaneously. Please sign in with your phone number above to connect a fresh session.'
            : 'Please sign in with your phone number above first to connect to Telegram.',
        });
      }

      try {
        const client = await getConnectedClient(activeSession, apiId, apiHash);
        const entity = await client.getEntity(channel);
        const channelTitle =
          (entity && 'title' in entity && typeof entity.title === 'string' && entity.title) || archivedTitle;

        let messages: Api.TypeMessage[] = [];
        try {
          messages = await client.getMessages(entity, {
            limit: Math.max(limit, 200),
            filter: new Api.InputMessagesFilterDocument(),
          });
        } catch (innerErr) {
          if (isSessionInvalidError(innerErr)) {
            throw innerErr;
          }
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
      } catch (chPdfErr) {
        const isInvalid = isSessionInvalidError(chPdfErr);
        if (isInvalid) {
          markSessionInvalidated(activeSession, apiId);
        }
        const archivedPdfs = mergeChannelPdfsIntoArchive(channel, archivedTitle, []);
        if (archivedPdfs.length > 0) {
          return res.status(200).json({
            channel,
            channelTitle: archivedTitle,
            pdfs: archivedPdfs,
            sessionInvalidated: isInvalid,
          });
        }
        throw chPdfErr;
      }
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
          sessionInvalidated: wasSessionInvalidated,
          error: wasSessionInvalidated
            ? 'Your Telegram session was reset because it was used in two places at once. Please open Telegram Sync and sign in again to download PDFs.'
            : 'Not signed in to Telegram. Please open Telegram Sync and sign in first.',
        });
      }

      try {
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
      } catch (dlErr) {
        if (isSessionInvalidError(dlErr)) {
          markSessionInvalidated(activeSession, apiId);
          return res.status(401).json({
            sessionInvalidated: true,
            error: 'Your Telegram session expired because it was active in two places simultaneously. Please open Telegram Sync and sign in again.',
          });
        }
        throw dlErr;
      }
    }

    return res.status(404).json({ error: `Unknown Telegram API route: ${pathname}` });
  } catch (err: unknown) {
    if (isSessionInvalidError(err) || (err instanceof Error && err.message === 'TELEGRAM_SESSION_INVALIDATED')) {
      if (activeSession) {
        markSessionInvalidated(activeSession, apiId);
      }
      return res.status(200).json({
        ok: false,
        configured: false,
        sessionInvalidated: true,
        channels: [],
        allPdfs: [],
        pdfs: [],
        error:
          'Your Telegram session was reset because the same session key was used from two locations simultaneously. Please sign in again with your phone number to generate a fresh session.',
      });
    }

    const rawMessage = err instanceof Error ? err.message : 'Telegram server error.';
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
