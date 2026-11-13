import fs from 'fs';
import path from 'path';

interface StoredCloudBook {
  id: number;
  bookKey: string;
  title: string;
  author: string;
  category: string;
  currentPage: number;
  totalPages: number;
  bookmarkCount: number;
  highlightCount: number;
  updatedAt: string;
}

interface StoredCloudNote {
  id: number;
  noteKey: string;
  bookKey: string;
  bookTitle: string;
  page: number;
  noteText: string;
  createdAt: string;
}

interface StoredCloudVocab {
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
}

const FALLBACK_STORE_PATHS = [
  path.resolve(process.cwd(), '.folio-cloud-store.json'),
  '/tmp/folio-cloud-store.json',
];

const memoryCloudStore = new Map<string, StoredUserCloudRecord>();
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
      const email = decoded.email || 'reader@folio.app';
      const uid = decoded.user_id || decoded.sub || email.toLowerCase();
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

// Vercel Serverless Handler for /api/cloudsql/*
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  const rawUrl = req.originalUrl || req.url || '/';
  const urlObj = new URL(rawUrl, 'http://localhost');
  const actionParam = String(req.query?.action || '');
  const pathname =
    urlObj.pathname.replace(/^\/api\/cloudsql\/?/, '').replace(/^\//, '') || actionParam;

  const user = resolveUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  loadFallbackStoreOnce();
  const userKey = user.email.toLowerCase() || user.uid;
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
  };

  if (pathname === 'library' && req.method === 'GET') {
    memoryCloudStore.set(userKey, existingRecord);
    return res.status(200).json(existingRecord);
  }

  if (pathname === 'sync' && req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const booksInput = Array.isArray(body.books) ? body.books : [];
    const notesInput = Array.isArray(body.notes) ? body.notes : [];
    const nowIso = new Date().toISOString();

    const bookMap = new Map<string, StoredCloudBook>();
    for (const b of existingRecord.books) {
      bookMap.set(b.bookKey, b);
    }

    let nextBookId = existingRecord.books.length + 1;
    for (const b of booksInput.slice(0, 200)) {
      const bookKey = String(b.bookKey || b.title || `book_${nextBookId}`);
      const prev = bookMap.get(bookKey);
      bookMap.set(bookKey, {
        id: prev ? prev.id : nextBookId++,
        bookKey,
        title: String(b.title || 'Untitled'),
        author: String(b.author || 'Unknown'),
        category: String(b.category || 'reading'),
        currentPage: Math.max(prev?.currentPage || 1, Number(b.currentPage) || 1),
        totalPages: Math.max(1, Number(b.totalPages) || 1),
        bookmarkCount: Number(b.bookmarkCount) || 0,
        highlightCount: Number(b.highlightCount) || 0,
        updatedAt: nowIso,
      });
    }

    existingRecord.books = Array.from(bookMap.values());
    existingRecord.notes = notesInput.slice(0, 250).map((n: Record<string, unknown>, idx: number) => ({
      id: idx + 1,
      noteKey: String(n.noteKey || `note_${idx + 1}`),
      bookKey: String(n.bookKey || ''),
      bookTitle: String(n.bookTitle || ''),
      page: Number(n.page) || 1,
      noteText: String(n.noteText || ''),
      createdAt: nowIso,
    }));

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
