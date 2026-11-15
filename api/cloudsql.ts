import fs from 'fs';
import path from 'path';
import type { PageBookmark, PageHighlightStroke, SpineTexture, CoverPattern } from '../src/types/library';

export interface StoredCloudBook {
  id: number;
  bookKey: string;
  title: string;
  author: string;
  category: string;
  currentPage: number;
  totalPages: number;
  bookmarkCount: number;
  highlightCount: number;
  fileName?: string;
  fileSize?: number;
  spineColor?: string;
  spineTexture?: SpineTexture;
  coverPattern?: CoverPattern;
  coverImage?: string;
  telegramChannel?: string;
  telegramMessageId?: number;
  bookmarks?: PageBookmark[];
  highlights?: Record<number, PageHighlightStroke[]>;
  hasCloudPdf?: boolean;
  pageOffset?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chapters?: any[];
  chaptersLocked?: boolean;
  updatedAt: string;
}

export interface StoredCloudNote {
  id: number;
  noteKey: string;
  bookKey: string;
  bookTitle: string;
  page: number;
  noteText: string;
  createdAt: string;
}

export interface StoredCloudVocab {
  id: number;
  word: string;
  partOfSpeech: string;
  persianMeaning: string;
  englishMeaning: string;
  contextExplanation: string;
  bookTitle: string;
  page: number;
  createdAt: string;
}

interface StoredUserCloudRecord {
  user: {
    id: number;
    uid: string;
    email: string;
    displayName: string;
  };
  books: StoredCloudBook[];
  notes: StoredCloudNote[];
  vocabulary: StoredCloudVocab[];
  deletedBookKeys?: string[];
}

const FALLBACK_STORE_PATHS = [
  path.resolve(process.cwd(), '.folio-cloud-store.json'),
  '/tmp/folio-cloud-store.json',
];

const PDF_CACHE_DIRS = [
  path.resolve(process.cwd(), '.folio-cloud-pdfs'),
  '/tmp/folio-cloud-pdfs',
];

const memoryCloudStore = new Map<string, StoredUserCloudRecord>();
const memoryPdfStore = new Map<string, Buffer>();
let fallbackLoaded = false;

function loadFallbackStoreOnce() {
  if (fallbackLoaded) return;
  fallbackLoaded = true;
  for (const p of FALLBACK_STORE_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, StoredUserCloudRecord>;
        for (const [k, v] of Object.entries(raw || {})) {
          if (k && v) memoryCloudStore.set(k, v);
        }
        break;
      }
    } catch {
      // ignore
    }
  }
}

function saveFallbackStore() {
  const obj: Record<string, StoredUserCloudRecord> = {};
  for (const [k, v] of memoryCloudStore.entries()) {
    obj[k] = v;
  }
  const json = JSON.stringify(obj);
  for (const p of FALLBACK_STORE_PATHS) {
    try {
      fs.writeFileSync(p, json, 'utf-8');
      break;
    } catch {
      // ignore on read-only fs
    }
  }
}

function makePdfCacheKey(userKey: string, bookKey: string): string {
  const safeUser = userKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const safeBook = bookKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  return `${safeUser}__${safeBook}`;
}

function saveCloudPdfBuffer(userKey: string, bookKey: string, buf: Buffer): void {
  const key = makePdfCacheKey(userKey, bookKey);
  memoryPdfStore.set(key, buf);
  for (const dir of PDF_CACHE_DIRS) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, `${key}.pdf`), buf);
      break;
    } catch {
      // ignore fs error
    }
  }
}

function loadCloudPdfBuffer(userKey: string, bookKey: string): Buffer | null {
  const key = makePdfCacheKey(userKey, bookKey);
  const inMem = memoryPdfStore.get(key);
  if (inMem) return inMem;

  for (const dir of PDF_CACHE_DIRS) {
    try {
      const filePath = path.join(dir, `${key}.pdf`);
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        memoryPdfStore.set(key, buf);
        return buf;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function deleteCloudPdfBuffer(userKey: string, bookKey: string): void {
  const key = makePdfCacheKey(userKey, bookKey);
  memoryPdfStore.delete(key);
  for (const dir of PDF_CACHE_DIRS) {
    try {
      const filePath = path.join(dir, `${key}.pdf`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore
    }
  }
}

function normalizeComparisonKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

function sanitizeComparisonKey(raw: string): string {
  return String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120)
    .toLowerCase();
}

function decodeJwtPayload(token: string): { sub?: string; user_id?: string; email?: string; name?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveUserFromRequest(req: any): { uid: string; email: string; displayName: string } | null {
  const authHeader = String(req.headers?.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const decoded = decodeJwtPayload(token);
    if (decoded && (decoded.user_id || decoded.sub || decoded.email)) {
      const email = (decoded.email || 'reader@folio.app').toLowerCase();
      const uid = decoded.user_id || decoded.sub || email;
      const displayName = decoded.name || email.split('@')[0] || 'Reader';
      return { uid, email, displayName };
    }
  }

  const headerEmail = String(req.headers?.['x-folio-user-email'] || '').trim().toLowerCase();
  const headerUid = String(req.headers?.['x-folio-user-uid'] || '').trim();
  const headerName = String(req.headers?.['x-folio-user-name'] || '').trim();

  if (headerEmail || headerUid) {
    const email = headerEmail || 'reader@folio.app';
    const uid = headerUid || `email_${email.replace(/[^a-z0-9]/gi, '_')}`;
    const displayName = headerName || email.split('@')[0] || 'Reader';
    return { uid, email, displayName };
  }

  return null;
}

// Vercel & Express Unified Handler for /api/cloudsql/*
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  const rawUrl = req.originalUrl || req.url || '/';
  const urlObj = new URL(rawUrl, 'http://localhost');
  const actionParam = String(req.query?.action || urlObj.searchParams.get('action') || '');
  const pathname =
    urlObj.pathname.replace(/^\/api\/cloudsql\/?/, '').replace(/^\//, '') || actionParam;

  const user = resolveUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  loadFallbackStoreOnce();
  // Always key by normalized lowercase email so iPad and PC using the same Gmail share the exact same record
  const userKey = (user.email || user.uid).trim().toLowerCase();
  const existingRecord: StoredUserCloudRecord = memoryCloudStore.get(userKey) || {
    user: {
      id: 1,
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
    },
    books: [],
    notes: [],
    vocabulary: [],
    deletedBookKeys: [],
  };
  if (!Array.isArray(existingRecord.deletedBookKeys)) {
    existingRecord.deletedBookKeys = [];
  }

  if (pathname === 'library' && req.method === 'GET') {
    const deletedSet = new Set(existingRecord.deletedBookKeys.map(normalizeComparisonKey));
    existingRecord.books = existingRecord.books.filter(
      b =>
        !deletedSet.has(normalizeComparisonKey(b.bookKey)) &&
        !deletedSet.has(sanitizeComparisonKey(b.bookKey)) &&
        !deletedSet.has(normalizeComparisonKey(b.title)) &&
        !deletedSet.has(sanitizeComparisonKey(b.title))
    );
    memoryCloudStore.set(userKey, existingRecord);
    return res.status(200).json(existingRecord);
  }

  if (pathname === 'pdf' && req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const bookKey = String(body.bookKey || '').trim();
      const pdfBase64 = String(body.pdfBase64 || '').trim();
      if (!bookKey || !pdfBase64) {
        return res.status(400).json({ error: 'bookKey and pdfBase64 are required' });
      }
      const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      const buf = Buffer.from(cleanBase64, 'base64');
      if (buf.byteLength > 0 && buf.byteLength <= 22 * 1024 * 1024) {
        saveCloudPdfBuffer(userKey, bookKey, buf);
        const targetBook = existingRecord.books.find(b => b.bookKey === bookKey);
        if (targetBook) {
          targetBook.hasCloudPdf = true;
          saveFallbackStore();
        }
      }
      return res.status(200).json({ ok: true, size: buf.byteLength });
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to store cloud PDF',
      });
    }
  }

  if (pathname === 'pdf' && req.method === 'GET') {
    const bookKey = String(req.query?.bookKey || urlObj.searchParams.get('bookKey') || '').trim();
    if (!bookKey) {
      return res.status(400).json({ error: 'bookKey query parameter is required' });
    }
    const buf = loadCloudPdfBuffer(userKey, bookKey);
    if (!buf) {
      return res.status(404).json({ error: 'PDF not found in cloud storage for this book' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(buf.byteLength));
    return res.status(200).send(buf);
  }

  if (pathname === 'sync' && req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const booksInput = Array.isArray(body.books) ? body.books : [];
    const notesInput = Array.isArray(body.notes) ? body.notes : [];
    const deletedBookKeysInput: string[] = Array.isArray(body.deletedBookKeys)
      ? body.deletedBookKeys.map(String)
      : [];
    const readdedBookKeysInput: string[] = Array.isArray(body.readdedBookKeys)
      ? body.readdedBookKeys.map(String)
      : [];
    const nowIso = new Date().toISOString();

    const deletedSet = new Set<string>(
      (existingRecord.deletedBookKeys || []).map(normalizeComparisonKey).filter(Boolean)
    );
    const readdedSet = new Set<string>();
    for (const rk of readdedBookKeysInput) {
      const n1 = normalizeComparisonKey(rk);
      const n2 = sanitizeComparisonKey(rk);
      if (n1) {
        deletedSet.delete(n1);
        readdedSet.add(n1);
      }
      if (n2) {
        deletedSet.delete(n2);
        readdedSet.add(n2);
      }
    }
    for (const dk of deletedBookKeysInput) {
      const n1 = normalizeComparisonKey(dk);
      const n2 = sanitizeComparisonKey(dk);
      if (n1 && !readdedSet.has(n1)) deletedSet.add(n1);
      if (n2 && !readdedSet.has(n2)) deletedSet.add(n2);
    }

    const isBookKeyDeleted = (bookKey: string, title?: string): boolean => {
      const k1 = normalizeComparisonKey(bookKey);
      const k2 = sanitizeComparisonKey(bookKey);
      const t1 = normalizeComparisonKey(title || '');
      const t2 = sanitizeComparisonKey(title || '');
      if (
        (k1 && readdedSet.has(k1)) ||
        (k2 && readdedSet.has(k2)) ||
        (t1 && readdedSet.has(t1)) ||
        (t2 && readdedSet.has(t2))
      ) {
        return false;
      }
      return Boolean(
        (k1 && deletedSet.has(k1)) ||
          (k2 && deletedSet.has(k2)) ||
          (t1 && deletedSet.has(t1)) ||
          (t2 && deletedSet.has(t2))
      );
    };

    const bookMap = new Map<string, StoredCloudBook>();
    for (const b of existingRecord.books) {
      if (isBookKeyDeleted(b.bookKey, b.title)) {
        deleteCloudPdfBuffer(userKey, b.bookKey);
        continue;
      }
      bookMap.set(b.bookKey, b);
    }

    let nextBookId = existingRecord.books.length + 1;
    for (const b of booksInput.slice(0, 200)) {
      const bookKey = String(b.bookKey || b.title || `book_${nextBookId}`);
      const bookTitle = String(b.title || '');
      if (isBookKeyDeleted(bookKey, bookTitle)) {
        deleteCloudPdfBuffer(userKey, bookKey);
        continue;
      }

      const prev = bookMap.get(bookKey);

      // Merge bookmarks from both previous cloud record and incoming book
      const incomingBookmarks: PageBookmark[] = Array.isArray(b.bookmarks) ? b.bookmarks : [];
      const prevBookmarks: PageBookmark[] = Array.isArray(prev?.bookmarks) ? prev.bookmarks : [];
      const mergedBookmarksMap = new Map<number, PageBookmark>();
      for (const bm of prevBookmarks) {
        if (bm && typeof bm.page === 'number') mergedBookmarksMap.set(bm.page, bm);
      }
      for (const bm of incomingBookmarks) {
        if (bm && typeof bm.page === 'number') mergedBookmarksMap.set(bm.page, bm);
      }
      const mergedBookmarks = Array.from(mergedBookmarksMap.values()).sort((a, c) => a.page - c.page);

      // Merge highlights per page
      const mergedHighlights: Record<number, PageHighlightStroke[]> = {
        ...(prev?.highlights || {}),
        ...(b.highlights && typeof b.highlights === 'object' ? b.highlights : {}),
      };

      const hasPdfInCloud = Boolean(
        prev?.hasCloudPdf || loadCloudPdfBuffer(userKey, bookKey) !== null
      );

      bookMap.set(bookKey, {
        id: prev ? prev.id : nextBookId++,
        bookKey,
        title: String(b.title || prev?.title || 'Untitled'),
        author: String(b.author || prev?.author || 'Unknown'),
        category: String(b.category || prev?.category || 'reading'),
        currentPage: Math.max(prev?.currentPage || 1, Number(b.currentPage) || 1),
        totalPages: Math.max(prev?.totalPages || 1, Number(b.totalPages) || 1),
        bookmarkCount: Math.max(mergedBookmarks.length, Number(b.bookmarkCount) || 0),
        highlightCount: Math.max(
          Object.keys(mergedHighlights).filter(k => (mergedHighlights[Number(k)] || []).length > 0)
            .length,
          Number(b.highlightCount) || 0
        ),
        fileName: String(b.fileName || prev?.fileName || `${b.title || 'book'}.pdf`),
        fileSize: Number(b.fileSize) || prev?.fileSize || 0,
        spineColor: String(b.spineColor || prev?.spineColor || '#4A3525'),
        spineTexture: (b.spineTexture || prev?.spineTexture || 'linen') as SpineTexture,
        coverPattern: (b.coverPattern || prev?.coverPattern || 'minimal') as CoverPattern,
        coverImage: b.coverImage || prev?.coverImage || undefined,
        telegramChannel: b.telegramChannel || prev?.telegramChannel || undefined,
        telegramMessageId: Number(b.telegramMessageId) || prev?.telegramMessageId || undefined,
        bookmarks: mergedBookmarks,
        highlights: mergedHighlights,
        hasCloudPdf: hasPdfInCloud,
        pageOffset:
          typeof b.pageOffset === 'number'
            ? b.pageOffset
            : typeof prev?.pageOffset === 'number'
            ? prev.pageOffset
            : undefined,
        chapters: Array.isArray(b.chapters) && b.chapters.length > 0 ? b.chapters : prev?.chapters,
        chaptersLocked:
          typeof b.chaptersLocked === 'boolean' ? b.chaptersLocked : prev?.chaptersLocked,
        updatedAt: nowIso,
      });
    }

    existingRecord.books = Array.from(bookMap.values());
    existingRecord.deletedBookKeys = Array.from(deletedSet);

    // Merge notes while stripping notes belonging to deleted books
    const noteMap = new Map<string, StoredCloudNote>();
    for (const n of existingRecord.notes) {
      if (isBookKeyDeleted(n.bookKey, n.bookTitle)) continue;
      noteMap.set(n.noteKey, n);
    }
    let nextNoteId = existingRecord.notes.length + 1;
    for (const n of notesInput.slice(0, 250)) {
      const noteBookKey = String(n.bookKey || '');
      const noteBookTitle = String(n.bookTitle || '');
      if (isBookKeyDeleted(noteBookKey, noteBookTitle)) continue;
      const noteKey = String(n.noteKey || `note_${nextNoteId}`);
      const prevN = noteMap.get(noteKey);
      noteMap.set(noteKey, {
        id: prevN ? prevN.id : nextNoteId++,
        noteKey,
        bookKey: String(n.bookKey || prevN?.bookKey || ''),
        bookTitle: String(n.bookTitle || prevN?.bookTitle || ''),
        page: Number(n.page) || prevN?.page || 1,
        noteText: String(n.noteText || prevN?.noteText || ''),
        createdAt: prevN?.createdAt || nowIso,
      });
    }
    existingRecord.notes = Array.from(noteMap.values());

    memoryCloudStore.set(userKey, existingRecord);
    saveFallbackStore();
    return res.status(200).json(existingRecord);
  }

  if (pathname === 'vocabulary' && req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const entry: StoredCloudVocab = {
      id: existingRecord.vocabulary.length + 1,
      word: String(body.word || '').slice(0, 200),
      partOfSpeech: String(body.partOfSpeech || '').slice(0, 100),
      persianMeaning: String(body.persianMeaning || '').slice(0, 2000),
      englishMeaning: String(body.englishMeaning || '').slice(0, 2000),
      contextExplanation: String(body.contextExplanation || '').slice(0, 2000),
      bookTitle: String(body.bookTitle || '').slice(0, 200),
      page: Number(body.page) || 1,
      createdAt: new Date().toISOString(),
    };
    existingRecord.vocabulary = [
      entry,
      ...existingRecord.vocabulary.filter(v => v.word.toLowerCase() !== entry.word.toLowerCase()),
    ];
    memoryCloudStore.set(userKey, existingRecord);
    saveFallbackStore();
    return res.status(200).json({ entry });
  }

  return res.status(404).json({ error: `Unknown Cloud SQL route: ${pathname}` });
}
