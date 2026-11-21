import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import type {
  PageBookmark,
  PageHighlightStroke,
  SpineTexture,
  CoverPattern,
} from '../src/types/library';

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
  annotationsUpdatedAt?: number;
  hasCloudPdf?: boolean;
  pageOffset?: number;
  pageAnchors?: Array<{ pdfPage: number; bookPage: number }>;
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

const RUNTIME_DB_URL_PATHS = [
  path.resolve(process.cwd(), '.folio-db-url.txt'),
  '/tmp/folio-db-url.txt',
];

const DOWNLOAD_CHUNK_BYTES = Math.floor(1.5 * 1024 * 1024); // 1.5 MB per HTTP response (well below Vercel's 4.5 MB limit)

const memoryCloudStore = new Map<string, StoredUserCloudRecord>();
const memoryPdfStore = new Map<string, Buffer>();
const memoryPdfChunks = new Map<string, { totalChunks: number; chunks: Map<number, Buffer> }>();
let fallbackLoaded = false;

let runtimeDatabaseUrl = '';
let activePool: Pool | null = null;
let activePoolKey = '';
const initializedPoolKeys = new Set<string>();
const poolsWithDedicatedPdfTable = new Set<string>();

function sanitizePostgresConnectionUrl(raw?: string): string {
  if (!raw) return '';
  let s = String(raw).trim();
  // Strip accidentally pasted `psql '...'` or `DATABASE_URL=...`
  s = s.replace(/^psql\s+/i, '').trim();
  s = s.replace(/^(?:export\s+)?(?:DATABASE_URL|POSTGRES_URL)\s*=\s*/i, '').trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1).trim();
  }
  if (!s.startsWith('postgres://') && !s.startsWith('postgresql://')) {
    return '';
  }
  try {
    const parsed = new URL(s);
    // Remove `channel_binding` (Neon's default &channel_binding=require breaks node-postgres SCRAM auth!)
    parsed.searchParams.delete('channel_binding');
    // Remove `sslmode` from query string so explicit Pool `ssl` config takes clean precedence
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  } catch {
    return s;
  }
}

function loadSavedRuntimeDbUrl(): string {
  if (runtimeDatabaseUrl) return runtimeDatabaseUrl;
  for (const p of RUNTIME_DB_URL_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const cleaned = sanitizePostgresConnectionUrl(fs.readFileSync(p, 'utf-8'));
        if (cleaned) {
          runtimeDatabaseUrl = cleaned;
          return cleaned;
        }
      }
    } catch {
      // ignore
    }
  }
  return '';
}

function saveRuntimeDbUrl(raw?: string): string {
  const cleaned = sanitizePostgresConnectionUrl(raw);
  if (!cleaned) return '';
  runtimeDatabaseUrl = cleaned;
  for (const p of RUNTIME_DB_URL_PATHS) {
    try {
      fs.writeFileSync(p, cleaned, 'utf-8');
      break;
    } catch {
      // ignore
    }
  }
  return cleaned;
}

function getEffectiveConnectionUrl(overrideUrl?: string): string {
  const fromOverride = sanitizePostgresConnectionUrl(overrideUrl);
  if (fromOverride) return fromOverride;

  const fromEnv = sanitizePostgresConnectionUrl(
    process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.NEON_DATABASE_URL ||
      process.env.SUPABASE_DB_URL ||
      ''
  );
  if (fromEnv) return fromEnv;

  const fromRuntime = loadSavedRuntimeDbUrl();
  if (fromRuntime) return fromRuntime;

  return '';
}

function hasHostSqlEnv(): boolean {
  return Boolean(process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME);
}

function isPostgresAvailable(overrideUrl?: string): boolean {
  return Boolean(getEffectiveConnectionUrl(overrideUrl) || hasHostSqlEnv());
}

function getPostgresPool(overrideUrl?: string): { pool: Pool; poolKey: string } | null {
  const connUrl = getEffectiveConnectionUrl(overrideUrl);
  if (!connUrl && !hasHostSqlEnv()) {
    return null;
  }

  const desiredKey = connUrl
    ? `url:${connUrl}`
    : `host:${process.env.SQL_HOST}:${process.env.SQL_DB_NAME}`;

  if (!activePool || activePoolKey !== desiredKey) {
    if (activePool) {
      activePool.end().catch(() => {});
    }
    activePoolKey = desiredKey;

    if (connUrl) {
      const isLocal =
        connUrl.includes('localhost') ||
        connUrl.includes('127.0.0.1') ||
        connUrl.includes('::1');

      activePool = new Pool({
        connectionString: connUrl,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: 5,
        connectionTimeoutMillis: 12_000,
        idleTimeoutMillis: 15_000,
      });
    } else {
      activePool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        max: 5,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 15_000,
      });
    }

    activePool.on('error', err => {
      console.error('Idle Postgres pool error:', err?.message || err);
    });
  }

  return { pool: activePool, poolKey: activePoolKey };
}

async function ensurePostgresSchema(pool: Pool, poolKey: string): Promise<void> {
  if (initializedPoolKeys.has(poolKey)) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        uid TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT 'Reader',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sql_books (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        book_key TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'General',
        current_page INTEGER NOT NULL DEFAULT 1,
        total_pages INTEGER NOT NULL DEFAULT 1,
        bookmark_count INTEGER NOT NULL DEFAULT 0,
        highlight_count INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sql_notes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        note_key TEXT NOT NULL,
        book_key TEXT NOT NULL,
        book_title TEXT NOT NULL,
        page INTEGER NOT NULL DEFAULT 1,
        note_text TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sql_vocabulary (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        word TEXT NOT NULL,
        part_of_speech TEXT NOT NULL DEFAULT '',
        persian_meaning TEXT NOT NULL,
        english_meaning TEXT NOT NULL,
        context_explanation TEXT NOT NULL DEFAULT '',
        book_title TEXT NOT NULL DEFAULT '',
        page INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sql_pdf_chunks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        book_key TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        chunk_index INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        chunk_base64 TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sql_pdf_chunks_user_book ON sql_pdf_chunks(user_id, book_key);
    `);
    initializedPoolKeys.add(poolKey);
    poolsWithDedicatedPdfTable.add(poolKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If schema CREATE is restricted (e.g. role only has DML on pre-created tables), verify core tables exist
    if (msg.toLowerCase().includes('permission denied')) {
      const check = await pool.query(
        `SELECT to_regclass('public.sql_books') AS has_books, to_regclass('public.sql_pdf_chunks') AS has_chunks`
      );
      if (check.rows[0]?.has_books) {
        initializedPoolKeys.add(poolKey);
        if (check.rows[0]?.has_chunks) {
          poolsWithDedicatedPdfTable.add(poolKey);
        }
        return;
      }
    }
    throw err;
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

async function pgGetOrCreateUser(
  pool: Pool,
  uid: string,
  email: string,
  displayName = 'Reader'
): Promise<{ id: number; uid: string; email: string; displayName: string }> {
  const normalizedEmail = (email || 'reader@folio.app').trim().toLowerCase();
  const effectiveUid = normalizedEmail
    ? `email_${normalizedEmail.replace(/[^a-z0-9]/g, '_')}`
    : uid;
  const cleanName = (displayName || 'Reader').slice(0, 120);

  const res = await pool.query(
    `INSERT INTO users (uid, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (uid) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name
     RETURNING id, uid, email, display_name`,
    [effectiveUid, normalizedEmail, cleanName]
  );
  const row = res.rows[0];
  return {
    id: Number(row.id),
    uid: String(row.uid),
    email: String(row.email),
    displayName: String(row.display_name || 'Reader'),
  };
}

function cleanHighlightsRecord(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any
): Record<number, PageHighlightStroke[]> {
  const cleaned: Record<number, PageHighlightStroke[]> = {};
  if (!raw || typeof raw !== 'object') return cleaned;
  for (const [k, strokes] of Object.entries(raw)) {
    if (Array.isArray(strokes) && strokes.length > 0) {
      cleaned[Number(k)] = strokes as PageHighlightStroke[];
    }
  }
  return cleaned;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveBookAnnotations(b: any, prevMeta: Record<string, any> = {}): {
  bookmarks: PageBookmark[];
  highlights: Record<number, PageHighlightStroke[]>;
  annotationsUpdatedAt?: number;
} {
  const incomingBookmarks: PageBookmark[] = Array.isArray(b.bookmarks)
    ? b.bookmarks.filter((bm: PageBookmark) => bm && typeof bm.page === 'number')
    : [];
  const prevBookmarks: PageBookmark[] = Array.isArray(prevMeta.bookmarks)
    ? prevMeta.bookmarks.filter((bm: PageBookmark) => bm && typeof bm.page === 'number')
    : [];
  const incomingHighlights = cleanHighlightsRecord(b.highlights);
  const prevHighlights = cleanHighlightsRecord(prevMeta.highlights);

  const incomingTs = Number(b.annotationsUpdatedAt) || 0;
  const prevTs = Number(prevMeta.annotationsUpdatedAt) || 0;

  if (incomingTs > 0 && incomingTs >= prevTs) {
    // Authoritative update/deletion from client — do NOT resurrect deleted notes or highlights!
    return {
      bookmarks: [...incomingBookmarks].sort((a, c) => a.page - c.page),
      highlights: incomingHighlights,
      annotationsUpdatedAt: incomingTs,
    };
  }

  if (prevTs > incomingTs) {
    // Cloud already holds newer edits/deletions from another device
    return {
      bookmarks: [...prevBookmarks].sort((a, c) => a.page - c.page),
      highlights: prevHighlights,
      annotationsUpdatedAt: prevTs,
    };
  }

  // Legacy fallback when neither side has annotationsUpdatedAt yet
  const bmMap = new Map<number, PageBookmark>();
  for (const bm of prevBookmarks) bmMap.set(bm.page, bm);
  for (const bm of incomingBookmarks) bmMap.set(bm.page, bm);
  return {
    bookmarks: Array.from(bmMap.values()).sort((a, c) => a.page - c.page),
    highlights: { ...prevHighlights, ...incomingHighlights },
    annotationsUpdatedAt: undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function packBookMetadata(b: any, prevMeta: Record<string, any> = {}, isDeleted = false): string {
  if (isDeleted) {
    return JSON.stringify({
      status: '__deleted__',
      deleted: true,
      deletedAt: new Date().toISOString(),
    });
  }

  const resolvedAnn = resolveBookAnnotations(b, prevMeta);

  return JSON.stringify({
    status:
      b.category && !String(b.category).startsWith('{') && b.category !== '__deleted__'
        ? b.category
        : prevMeta.category && prevMeta.category !== '__deleted__'
        ? prevMeta.category
        : 'reading',
    deleted: false,
    fileName: b.fileName || prevMeta.fileName,
    fileSize: b.fileSize || prevMeta.fileSize,
    spineColor: b.spineColor || prevMeta.spineColor,
    spineTexture: b.spineTexture || prevMeta.spineTexture,
    coverPattern: b.coverPattern || prevMeta.coverPattern,
    coverImage: b.coverImage || prevMeta.coverImage,
    telegramChannel: b.telegramChannel || prevMeta.telegramChannel,
    telegramMessageId: b.telegramMessageId || prevMeta.telegramMessageId,
    bookmarks: resolvedAnn.bookmarks,
    highlights: resolvedAnn.highlights,
    annotationsUpdatedAt: resolvedAnn.annotationsUpdatedAt,
    hasCloudPdf: Boolean(b.hasCloudPdf || prevMeta.hasCloudPdf),
    pageOffset:
      typeof b.pageOffset === 'number'
        ? b.pageOffset
        : typeof prevMeta.pageOffset === 'number'
        ? prevMeta.pageOffset
        : undefined,
    pageAnchors:
      Array.isArray(b.pageAnchors)
        ? b.pageAnchors
        : Array.isArray(prevMeta.pageAnchors)
        ? prevMeta.pageAnchors
        : undefined,
    chapters: Array.isArray(b.chapters) && b.chapters.length > 0 ? b.chapters : prevMeta.chapters,
    chaptersLocked:
      typeof b.chaptersLocked === 'boolean' ? b.chaptersLocked : prevMeta.chaptersLocked,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unpackPgBookRow(row: any): StoredCloudBook & { deleted: boolean } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let meta: Record<string, any> = {};
  let cleanCategory = String(row.category || 'reading');
  if (cleanCategory.startsWith('{')) {
    try {
      meta = JSON.parse(cleanCategory);
      cleanCategory = meta.status || 'reading';
    } catch {
      cleanCategory = 'reading';
    }
  }
  const isDeleted = Boolean(meta.deleted || cleanCategory === '__deleted__');
  return {
    id: Number(row.id),
    bookKey: String(row.book_key || ''),
    title: String(row.title || 'Untitled'),
    author: String(row.author || 'Unknown'),
    category: cleanCategory,
    currentPage: Number(row.current_page) || 1,
    totalPages: Number(row.total_pages) || 1,
    bookmarkCount: Number(row.bookmark_count) || 0,
    highlightCount: Number(row.highlight_count) || 0,
    deleted: isDeleted,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    spineColor: meta.spineColor,
    spineTexture: meta.spineTexture,
    coverPattern: meta.coverPattern,
    coverImage: meta.coverImage,
    telegramChannel: meta.telegramChannel,
    telegramMessageId: meta.telegramMessageId,
    bookmarks: Array.isArray(meta.bookmarks) ? meta.bookmarks : [],
    highlights: cleanHighlightsRecord(meta.highlights),
    annotationsUpdatedAt:
      typeof meta.annotationsUpdatedAt === 'number' ? meta.annotationsUpdatedAt : undefined,
    hasCloudPdf: Boolean(meta.hasCloudPdf),
    pageOffset: typeof meta.pageOffset === 'number' ? meta.pageOffset : undefined,
    pageAnchors: Array.isArray(meta.pageAnchors) ? meta.pageAnchors : undefined,
    chapters: Array.isArray(meta.chapters) ? meta.chapters : undefined,
    chaptersLocked: typeof meta.chaptersLocked === 'boolean' ? meta.chaptersLocked : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

async function pgGetLibrary(
  pool: Pool,
  poolKey: string,
  uid: string,
  email: string,
  displayName: string
): Promise<StoredUserCloudRecord> {
  const userRecord = await pgGetOrCreateUser(pool, uid, email, displayName);
  const useDedicatedPdfTable = poolsWithDedicatedPdfTable.has(poolKey);

  // IMPORTANT: Exclude '__pdf_chunk__' rows and NEVER select chunk base64 text during library sync!
  const [booksRes, pdfMetaRes, notesRes, vocabRes] = await Promise.all([
    pool.query(
      `SELECT id, book_key, title, author, category, current_page, total_pages, bookmark_count, highlight_count, updated_at
       FROM sql_books
       WHERE user_id = $1 AND author <> '__pdf_chunk__' AND book_key NOT LIKE '__pdfchunk__%'
       ORDER BY updated_at DESC`,
      [userRecord.id]
    ),
    useDedicatedPdfTable
      ? pool.query(
          `SELECT book_key, MAX(title) AS title, MAX(total_chunks) AS total_chunks, COUNT(*)::int AS stored_chunks
           FROM sql_pdf_chunks
           WHERE user_id = $1
           GROUP BY book_key`,
          [userRecord.id]
        )
      : pool.query(
          `SELECT REGEXP_REPLACE(book_key, '^__pdfchunk__(.+)__\\d+$', '\\1') AS book_key,
                  MAX(title) AS title, MAX(total_pages) AS total_chunks, COUNT(*)::int AS stored_chunks
           FROM sql_books
           WHERE user_id = $1 AND author = '__pdf_chunk__'
           GROUP BY REGEXP_REPLACE(book_key, '^__pdfchunk__(.+)__\\d+$', '\\1')`,
          [userRecord.id]
        ),
    pool.query(
      `SELECT id, note_key, book_key, book_title, page, note_text, created_at
       FROM sql_notes
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userRecord.id]
    ),
    pool.query(
      `SELECT id, word, part_of_speech, persian_meaning, english_meaning, context_explanation, book_title, page, created_at
       FROM sql_vocabulary
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userRecord.id]
    ),
  ]);

  const keysWithPdf = new Set<string>();
  const titlesWithPdf = new Set<string>();
  for (const pm of pdfMetaRes.rows) {
    if (Number(pm.stored_chunks) >= Number(pm.total_chunks || 1)) {
      keysWithPdf.add(normalizeComparisonKey(pm.book_key));
      keysWithPdf.add(sanitizeComparisonKey(pm.book_key));
      if (pm.title) {
        titlesWithPdf.add(normalizeComparisonKey(pm.title));
      }
    }
  }

  const unpackedAll = booksRes.rows.map(row => {
    const u = unpackPgBookRow(row);
    const hasChunks =
      keysWithPdf.has(normalizeComparisonKey(u.bookKey)) ||
      keysWithPdf.has(sanitizeComparisonKey(u.bookKey)) ||
      (u.title && titlesWithPdf.has(normalizeComparisonKey(u.title)));
    return {
      ...u,
      hasCloudPdf: Boolean(hasChunks),
    };
  });

  const activeBooks = unpackedAll
    .filter(b => !b.deleted)
    .map(({ deleted: _d, ...rest }) => rest);

  const deletedBookKeys = Array.from(
    new Set(
      unpackedAll
        .filter(b => b.deleted)
        .flatMap(b => [
          normalizeComparisonKey(b.bookKey),
          sanitizeComparisonKey(b.bookKey),
          normalizeComparisonKey(b.title),
          sanitizeComparisonKey(b.title),
        ])
        .filter(Boolean)
    )
  );
  const deletedSet = new Set(deletedBookKeys);

  const notes: StoredCloudNote[] = notesRes.rows
    .filter(
      n =>
        !deletedSet.has(normalizeComparisonKey(n.book_key)) &&
        !deletedSet.has(sanitizeComparisonKey(n.book_key)) &&
        !deletedSet.has(normalizeComparisonKey(n.book_title)) &&
        !deletedSet.has(sanitizeComparisonKey(n.book_title))
    )
    .map(n => ({
      id: Number(n.id),
      noteKey: String(n.note_key),
      bookKey: String(n.book_key),
      bookTitle: String(n.book_title),
      page: Number(n.page) || 1,
      noteText: String(n.note_text || ''),
      createdAt: n.created_at ? new Date(n.created_at).toISOString() : new Date().toISOString(),
    }));

  const vocabulary: StoredCloudVocab[] = vocabRes.rows.map(v => ({
    id: Number(v.id),
    word: String(v.word),
    partOfSpeech: String(v.part_of_speech || ''),
    persianMeaning: String(v.persian_meaning || ''),
    englishMeaning: String(v.english_meaning || ''),
    contextExplanation: String(v.context_explanation || ''),
    bookTitle: String(v.book_title || ''),
    page: Number(v.page) || 1,
    createdAt: v.created_at ? new Date(v.created_at).toISOString() : new Date().toISOString(),
  }));

  return {
    user: userRecord,
    books: activeBooks,
    notes,
    vocabulary,
    deletedBookKeys,
  };
}

async function pgSyncLibrary(
  pool: Pool,
  poolKey: string,
  uid: string,
  email: string,
  displayName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booksInput: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notesInput: any[],
  deletedBookKeysInput: string[],
  readdedBookKeysInput: string[]
): Promise<StoredUserCloudRecord> {
  const userRecord = await pgGetOrCreateUser(pool, uid, email, displayName);
  const useDedicatedPdfTable = poolsWithDedicatedPdfTable.has(poolKey);

  const existingRes = await pool.query(
    `SELECT id, book_key, title, author, category, current_page, total_pages, bookmark_count, highlight_count, updated_at
     FROM sql_books
     WHERE user_id = $1 AND author <> '__pdf_chunk__' AND book_key NOT LIKE '__pdfchunk__%'`,
    [userRecord.id]
  );
  const existingRows = existingRes.rows;

  const deletedSet = new Set<string>();
  const readdedSet = new Set<string>();

  for (const rk of readdedBookKeysInput) {
    const k1 = normalizeComparisonKey(rk);
    const k2 = sanitizeComparisonKey(rk);
    if (k1) readdedSet.add(k1);
    if (k2) readdedSet.add(k2);
  }

  for (const row of existingRows) {
    const u = unpackPgBookRow(row);
    if (u.deleted) {
      for (const k of [
        normalizeComparisonKey(u.bookKey),
        sanitizeComparisonKey(u.bookKey),
        normalizeComparisonKey(u.title),
        sanitizeComparisonKey(u.title),
      ]) {
        if (k && !readdedSet.has(k)) deletedSet.add(k);
      }
    }
  }

  for (const dk of deletedBookKeysInput) {
    const k1 = normalizeComparisonKey(dk);
    const k2 = sanitizeComparisonKey(dk);
    if (k1 && !readdedSet.has(k1)) deletedSet.add(k1);
    if (k2 && !readdedSet.has(k2)) deletedSet.add(k2);
  }

  const isDeleted = (bookKey: string, title?: string): boolean => {
    const keys = [
      normalizeComparisonKey(bookKey),
      sanitizeComparisonKey(bookKey),
      normalizeComparisonKey(title || ''),
      sanitizeComparisonKey(title || ''),
    ].filter(Boolean);
    for (const k of keys) {
      if (readdedSet.has(k)) return false;
    }
    for (const k of keys) {
      if (deletedSet.has(k)) return true;
    }
    return false;
  };

  // Mark deleted existing books as tombstones and delete their PDF chunks & notes
  for (const row of existingRows) {
    const u = unpackPgBookRow(row);
    if (isDeleted(u.bookKey, u.title)) {
      if (!u.deleted) {
        await pool.query(
          `UPDATE sql_books SET category = $1, bookmark_count = 0, highlight_count = 0, updated_at = NOW() WHERE id = $2`,
          [packBookMetadata(u, {}, true), row.id]
        );
      }
      await pool.query(`DELETE FROM sql_notes WHERE user_id = $1 AND book_key = $2`, [
        userRecord.id,
        u.bookKey,
      ]);
      if (useDedicatedPdfTable) {
        await pool.query(
          `DELETE FROM sql_pdf_chunks WHERE user_id = $1 AND (LOWER(book_key) = $2 OR LOWER(title) = $3)`,
          [userRecord.id, normalizeComparisonKey(u.bookKey), normalizeComparisonKey(u.title)]
        );
      } else {
        await pool.query(
          `DELETE FROM sql_books WHERE user_id = $1 AND author = '__pdf_chunk__' AND (LOWER(book_key) LIKE $2 OR LOWER(title) = $3)`,
          [
            userRecord.id,
            `__pdfchunk__${sanitizeComparisonKey(u.bookKey)}__%`,
            normalizeComparisonKey(u.title),
          ]
        );
      }
    }
  }

  // Insert tombstones for newly deleted keys not yet in existingRows
  for (const dk of deletedBookKeysInput.slice(0, 100)) {
    const cleanKey = sanitizeComparisonKey(dk) || normalizeComparisonKey(dk);
    if (!cleanKey || readdedSet.has(cleanKey)) continue;
    const exists = existingRows.some(
      r =>
        normalizeComparisonKey(r.book_key) === cleanKey ||
        sanitizeComparisonKey(r.book_key) === cleanKey ||
        normalizeComparisonKey(r.title) === cleanKey ||
        sanitizeComparisonKey(r.title) === cleanKey
    );
    if (!exists) {
      await pool.query(
        `INSERT INTO sql_books (user_id, book_key, title, author, category, current_page, total_pages, bookmark_count, highlight_count)
         VALUES ($1, $2, $3, 'Deleted', $4, 1, 1, 0, 0)`,
        [
          userRecord.id,
          cleanKey,
          dk.slice(0, 200),
          JSON.stringify({ status: '__deleted__', deleted: true, deletedAt: new Date().toISOString() }),
        ]
      );
    }
  }

  // Upsert active books and track books with authoritative annotation updates so deleted notes are purged from sql_notes
  const authoritativeNoteBookKeys = new Set<string>();
  for (const b of booksInput.slice(0, 150)) {
    const bookKey = String(b.bookKey || b.title || '').trim();
    const title = String(b.title || 'Untitled').slice(0, 200);
    if (!bookKey || isDeleted(bookKey, title)) continue;

    const existing = existingRows.find(
      r =>
        r.book_key === bookKey ||
        normalizeComparisonKey(r.book_key) === normalizeComparisonKey(bookKey)
    );

    if (existing) {
      const prev = unpackPgBookRow(existing);
      const prevMetaObj = prev.deleted ? {} : prev;
      const resolvedAnn = resolveBookAnnotations(b, prevMetaObj);
      const incomingTs = Number(b.annotationsUpdatedAt) || 0;
      const prevTs = Number(prev.annotationsUpdatedAt) || 0;
      if (incomingTs > 0 && incomingTs >= prevTs) {
        authoritativeNoteBookKeys.add(bookKey);
        authoritativeNoteBookKeys.add(existing.book_key);
      }

      const packed = packBookMetadata(b, prevMetaObj, false);
      const nextBookmarkCount = resolvedAnn.bookmarks.length;
      const nextHighlightCount = Object.keys(resolvedAnn.highlights).length;

      await pool.query(
        `UPDATE sql_books
         SET title = $1, author = $2, category = $3, current_page = $4, total_pages = $5,
             bookmark_count = $6, highlight_count = $7, updated_at = NOW()
         WHERE id = $8`,
        [
          title || existing.title,
          String(b.author || existing.author || 'Unknown').slice(0, 200),
          packed,
          prev.deleted ? Number(b.currentPage) || 1 : Math.max(Number(existing.current_page) || 1, Number(b.currentPage) || 1),
          prev.deleted ? Number(b.totalPages) || 1 : Math.max(Number(existing.total_pages) || 1, Number(b.totalPages) || 1),
          nextBookmarkCount,
          nextHighlightCount,
          existing.id,
        ]
      );
    } else {
      const resolvedAnn = resolveBookAnnotations(b, {});
      if ((Number(b.annotationsUpdatedAt) || 0) > 0) {
        authoritativeNoteBookKeys.add(bookKey);
      }
      const packed = packBookMetadata(b, {}, false);
      await pool.query(
        `INSERT INTO sql_books (user_id, book_key, title, author, category, current_page, total_pages, bookmark_count, highlight_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          userRecord.id,
          bookKey,
          title,
          String(b.author || 'Unknown').slice(0, 200),
          packed,
          Math.max(1, Number(b.currentPage) || 1),
          Math.max(1, Number(b.totalPages) || 1),
          resolvedAnn.bookmarks.length,
          Object.keys(resolvedAnn.highlights).length,
        ]
      );
    }
  }

  // Purge stale sql_notes rows for books with authoritative annotation updates so deleted notes NEVER resurrect
  for (const bk of authoritativeNoteBookKeys) {
    await pool.query(`DELETE FROM sql_notes WHERE user_id = $1 AND book_key = $2`, [
      userRecord.id,
      bk,
    ]);
  }

  // Merge notes
  if (notesInput.length > 0) {
    const existingNotesRes = await pool.query(
      `SELECT note_key FROM sql_notes WHERE user_id = $1`,
      [userRecord.id]
    );
    const existingNoteKeys = new Set(existingNotesRes.rows.map(r => String(r.note_key)));
    for (const n of notesInput.slice(0, 250)) {
      const noteKey = String(n.noteKey || '');
      if (!noteKey || existingNoteKeys.has(noteKey)) continue;
      if (isDeleted(String(n.bookKey || ''), String(n.bookTitle || ''))) continue;
      await pool.query(
        `INSERT INTO sql_notes (user_id, note_key, book_key, book_title, page, note_text)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userRecord.id,
          noteKey,
          String(n.bookKey || ''),
          String(n.bookTitle || '').slice(0, 200),
          Math.max(1, Number(n.page) || 1),
          String(n.noteText || '').slice(0, 2000),
        ]
      );
      existingNoteKeys.add(noteKey);
    }
  }

  return await pgGetLibrary(pool, poolKey, uid, email, displayName);
}

async function pgSavePdfChunk(
  pool: Pool,
  poolKey: string,
  uid: string,
  email: string,
  bookKey: string,
  title: string,
  chunkIndex: number,
  totalChunks: number,
  chunkBase64: string
): Promise<void> {
  const userRecord = await pgGetOrCreateUser(pool, uid, email);
  const safeKey = sanitizeComparisonKey(bookKey) || normalizeComparisonKey(bookKey) || 'book';

  if (poolsWithDedicatedPdfTable.has(poolKey)) {
    if (chunkIndex === 0) {
      await pool.query(
        `DELETE FROM sql_pdf_chunks WHERE user_id = $1 AND book_key = $2`,
        [userRecord.id, safeKey]
      );
    } else {
      await pool.query(
        `DELETE FROM sql_pdf_chunks WHERE user_id = $1 AND book_key = $2 AND chunk_index = $3`,
        [userRecord.id, safeKey, chunkIndex]
      );
    }

    await pool.query(
      `INSERT INTO sql_pdf_chunks (user_id, book_key, title, chunk_index, total_chunks, chunk_base64, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userRecord.id, safeKey, (title || safeKey).slice(0, 200), chunkIndex, totalChunks, chunkBase64]
    );
    return;
  }

  // Fallback for restricted Postgres roles without CREATE TABLE permission
  const chunkRowKey = `__pdfchunk__${safeKey}__${chunkIndex}`;
  if (chunkIndex === 0) {
    await pool.query(
      `DELETE FROM sql_books WHERE user_id = $1 AND author = '__pdf_chunk__' AND book_key LIKE $2`,
      [userRecord.id, `__pdfchunk__${safeKey}__%`]
    );
  } else {
    await pool.query(
      `DELETE FROM sql_books WHERE user_id = $1 AND author = '__pdf_chunk__' AND book_key = $2`,
      [userRecord.id, chunkRowKey]
    );
  }
  await pool.query(
    `INSERT INTO sql_books (user_id, book_key, title, author, category, current_page, total_pages, bookmark_count, highlight_count, updated_at)
     VALUES ($1, $2, $3, '__pdf_chunk__', $4, $5, $6, 0, 0, NOW())`,
    [userRecord.id, chunkRowKey, (title || safeKey).slice(0, 200), chunkBase64, chunkIndex, totalChunks]
  );
}

async function pgFindPdfMeta(
  pool: Pool,
  poolKey: string,
  uid: string,
  email: string,
  bookKey: string,
  title?: string
): Promise<{ matchedBookKey: string; totalChunks: number; storedChunks: number } | null> {
  const userRecord = await pgGetOrCreateUser(pool, uid, email);
  const safeKey = sanitizeComparisonKey(bookKey) || normalizeComparisonKey(bookKey);
  const titleLower = normalizeComparisonKey(title || '');

  if (poolsWithDedicatedPdfTable.has(poolKey)) {
    if (safeKey) {
      const res = await pool.query(
        `SELECT book_key, MAX(total_chunks)::int AS total_chunks, COUNT(*)::int AS stored_chunks
         FROM sql_pdf_chunks
         WHERE user_id = $1 AND LOWER(book_key) = $2
         GROUP BY book_key
         LIMIT 1`,
        [userRecord.id, safeKey]
      );
      if (res.rows[0] && Number(res.rows[0].stored_chunks) > 0) {
        return {
          matchedBookKey: String(res.rows[0].book_key),
          totalChunks: Number(res.rows[0].total_chunks) || Number(res.rows[0].stored_chunks),
          storedChunks: Number(res.rows[0].stored_chunks),
        };
      }
    }

    if (titleLower) {
      const res = await pool.query(
        `SELECT book_key, MAX(total_chunks)::int AS total_chunks, COUNT(*)::int AS stored_chunks
         FROM sql_pdf_chunks
         WHERE user_id = $1 AND LOWER(TRIM(title)) = $2
         GROUP BY book_key
         ORDER BY COUNT(*) DESC
         LIMIT 1`,
        [userRecord.id, titleLower]
      );
      if (res.rows[0] && Number(res.rows[0].stored_chunks) > 0) {
        return {
          matchedBookKey: String(res.rows[0].book_key),
          totalChunks: Number(res.rows[0].total_chunks) || Number(res.rows[0].stored_chunks),
          storedChunks: Number(res.rows[0].stored_chunks),
        };
      }
    }
    return null;
  }

  // Fallback for sql_books chunk rows
  if (safeKey) {
    const res = await pool.query(
      `SELECT MAX(total_pages)::int AS total_chunks, COUNT(*)::int AS stored_chunks
       FROM sql_books
       WHERE user_id = $1 AND author = '__pdf_chunk__' AND LOWER(book_key) LIKE $2`,
      [userRecord.id, `__pdfchunk__${safeKey}__%`]
    );
    if (res.rows[0] && Number(res.rows[0].stored_chunks) > 0) {
      return {
        matchedBookKey: safeKey,
        totalChunks: Number(res.rows[0].total_chunks) || Number(res.rows[0].stored_chunks),
        storedChunks: Number(res.rows[0].stored_chunks),
      };
    }
  }
  if (titleLower) {
    const res = await pool.query(
      `SELECT REGEXP_REPLACE(book_key, '^__pdfchunk__(.+)__\\d+$', '\\1') AS matched_key,
              MAX(total_pages)::int AS total_chunks, COUNT(*)::int AS stored_chunks
       FROM sql_books
       WHERE user_id = $1 AND author = '__pdf_chunk__' AND LOWER(TRIM(title)) = $2
       GROUP BY REGEXP_REPLACE(book_key, '^__pdfchunk__(.+)__\\d+$', '\\1')
       ORDER BY COUNT(*) DESC
       LIMIT 1`,
      [userRecord.id, titleLower]
    );
    if (res.rows[0] && Number(res.rows[0].stored_chunks) > 0) {
      return {
        matchedBookKey: String(res.rows[0].matched_key),
        totalChunks: Number(res.rows[0].total_chunks) || Number(res.rows[0].stored_chunks),
        storedChunks: Number(res.rows[0].stored_chunks),
      };
    }
  }
  return null;
}

async function pgLoadPdfChunk(
  pool: Pool,
  poolKey: string,
  uid: string,
  email: string,
  matchedBookKey: string,
  chunkIndex: number
): Promise<Buffer | null> {
  const userRecord = await pgGetOrCreateUser(pool, uid, email);
  const normKey = normalizeComparisonKey(matchedBookKey);
  if (poolsWithDedicatedPdfTable.has(poolKey)) {
    const res = await pool.query(
      `SELECT chunk_base64
       FROM sql_pdf_chunks
       WHERE user_id = $1 AND LOWER(book_key) = $2 AND chunk_index = $3
       LIMIT 1`,
      [userRecord.id, normKey, chunkIndex]
    );
    if (!res.rows[0]?.chunk_base64) return null;
    return Buffer.from(String(res.rows[0].chunk_base64), 'base64');
  }

  const chunkRowKey = `__pdfchunk__${normKey}__${chunkIndex}`;
  const res = await pool.query(
    `SELECT category
     FROM sql_books
     WHERE user_id = $1 AND author = '__pdf_chunk__' AND LOWER(book_key) = $2
     LIMIT 1`,
    [userRecord.id, chunkRowKey]
  );
  if (!res.rows[0]?.category) return null;
  return Buffer.from(String(res.rows[0].category), 'base64');
}

// ---------- Ephemeral /tmp fallback helpers (used only if no PostgreSQL URL is configured) ----------

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
      // ignore
    }
  }
}

function makePdfCacheKey(userKey: string, rawBookKey: string): string {
  const safeUser = userKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  const normalizedBook = String(rawBookKey || '').trim().toLowerCase();
  const asciiBook = normalizedBook.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 50);
  const hexSuffix = Buffer.from(normalizedBook, 'utf-8').toString('hex').slice(0, 32);
  return `${safeUser}__${asciiBook}_${hexSuffix}`;
}

export function saveCloudPdfBuffer(userKey: string, bookKey: string, buf: Buffer, title?: string): void {
  if (!bookKey || !buf || buf.byteLength === 0) return;
  const keysToSave = Array.from(
    new Set([bookKey.trim(), title ? title.trim() : ''].filter(Boolean))
  );
  for (const k of keysToSave) {
    const cacheKey = makePdfCacheKey(userKey, k);
    memoryPdfStore.set(cacheKey, buf);
    for (const dir of PDF_CACHE_DIRS) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(path.join(dir, `${cacheKey}.pdf`), buf);
        break;
      } catch {
        // ignore fs error
      }
    }
  }
}

export function loadCloudPdfBuffer(userKey: string, bookKey: string, title?: string): Buffer | null {
  const candidates = Array.from(
    new Set([bookKey ? bookKey.trim() : '', title ? title.trim() : ''].filter(Boolean))
  );
  for (const cand of candidates) {
    const key = makePdfCacheKey(userKey, cand);
    const inMem = memoryPdfStore.get(key);
    if (inMem && inMem.byteLength > 100) return inMem;

    for (const dir of PDF_CACHE_DIRS) {
      try {
        const filePath = path.join(dir, `${key}.pdf`);
        if (fs.existsSync(filePath)) {
          const buf = fs.readFileSync(filePath);
          if (buf.byteLength > 100) {
            memoryPdfStore.set(key, buf);
            return buf;
          }
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

export function deleteCloudPdfBuffer(userKey: string, bookKey: string): void {
  if (!bookKey) return;
  const key = makePdfCacheKey(userKey, bookKey);
  memoryPdfStore.delete(key);
  memoryPdfChunks.delete(key);
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

function decodeJwtPayload(
  token: string
): { sub?: string; user_id?: string; email?: string; name?: string } | null {
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
export function resolveUserFromRequest(req: any): { uid: string; email: string; displayName: string } | null {
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

  const headerDbUrl = String(req.headers?.['x-folio-db-url'] || '').trim();
  if (headerDbUrl) {
    saveRuntimeDbUrl(headerDbUrl);
  }

  // Dedicated PostgreSQL connection test endpoint (no auth required so user can test DB URL immediately)
  if (pathname === 'test-db' && (req.method === 'POST' || req.method === 'GET')) {
    const body =
      req.method === 'POST'
        ? typeof req.body === 'string'
          ? JSON.parse(req.body || '{}')
          : req.body || {}
        : {};
    const candidateUrl = String(body.databaseUrl || headerDbUrl || '').trim();
    if (candidateUrl) {
      saveRuntimeDbUrl(candidateUrl);
    }

    const poolInfo = getPostgresPool(candidateUrl || undefined);
    if (!poolInfo) {
      return res.status(400).json({
        ok: false,
        storageMode: 'ephemeral-tmp',
        error:
          'No valid PostgreSQL URL found. Make sure it starts with postgresql:// or postgres:// (or set DATABASE_URL in Vercel Environment Variables).',
      });
    }

    try {
      await ensurePostgresSchema(poolInfo.pool, poolInfo.poolKey);
      const ping = await poolInfo.pool.query('SELECT NOW() AS server_time');
      return res.status(200).json({
        ok: true,
        storageMode: 'postgres',
        serverTime: ping.rows[0]?.server_time,
        message: 'Connected to PostgreSQL & all tables (including PDF chunk storage) are ready!',
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({
        ok: false,
        storageMode: 'ephemeral-tmp',
        error: `PostgreSQL connection failed: ${errMsg}`,
      });
    }
  }

  const user = resolveUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  loadFallbackStoreOnce();
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

  const poolInfo = isPostgresAvailable(headerDbUrl) ? getPostgresPool(headerDbUrl) : null;

  // ---------- GET /api/cloudsql/library ----------
  if (pathname === 'library' && req.method === 'GET') {
    let sqlError: string | undefined;
    if (poolInfo) {
      try {
        await ensurePostgresSchema(poolInfo.pool, poolInfo.poolKey);
        const sqlData = await pgGetLibrary(
          poolInfo.pool,
          poolInfo.poolKey,
          user.uid,
          user.email,
          user.displayName
        );
        return res.status(200).json({ ...sqlData, storageMode: 'postgres' });
      } catch (err) {
        sqlError = err instanceof Error ? err.message : String(err);
        console.error('Postgres library error:', sqlError);
      }
    }

    const deletedSet = new Set(existingRecord.deletedBookKeys.map(normalizeComparisonKey));
    existingRecord.books = existingRecord.books
      .filter(
        b =>
          !deletedSet.has(normalizeComparisonKey(b.bookKey)) &&
          !deletedSet.has(sanitizeComparisonKey(b.bookKey)) &&
          !deletedSet.has(normalizeComparisonKey(b.title)) &&
          !deletedSet.has(sanitizeComparisonKey(b.title))
      )
      .map(b => ({
        ...b,
        hasCloudPdf: Boolean(
          b.hasCloudPdf || loadCloudPdfBuffer(userKey, b.bookKey, b.title) !== null
        ),
      }));
    memoryCloudStore.set(userKey, existingRecord);
    return res.status(200).json({ ...existingRecord, storageMode: 'ephemeral-tmp', sqlError });
  }

  // ---------- POST /api/cloudsql/pdf (Chunked Upload) ----------
  if (pathname === 'pdf' && req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const bookKey = String(body.bookKey || '').trim();
      const title = String(body.title || '').trim();
      const pdfBase64 = String(body.pdfBase64 || '').trim();
      const chunkIndex = Math.max(0, Number(body.chunkIndex) || 0);
      const totalChunks = Math.max(1, Number(body.totalChunks) || 1);

      if (!bookKey || !pdfBase64) {
        return res.status(400).json({ error: 'bookKey and pdfBase64 are required' });
      }
      const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');

      // 1. Save chunk directly to PostgreSQL when configured (works across all Vercel regions & restarts!)
      let savedToPostgres = false;
      let sqlError: string | undefined;
      if (poolInfo) {
        try {
          await ensurePostgresSchema(poolInfo.pool, poolInfo.poolKey);
          await pgSavePdfChunk(
            poolInfo.pool,
            poolInfo.poolKey,
            user.uid,
            user.email,
            bookKey,
            title,
            chunkIndex,
            totalChunks,
            cleanBase64
          );
          savedToPostgres = true;
        } catch (err) {
          sqlError = err instanceof Error ? err.message : String(err);
          console.error('Postgres PDF chunk upload error:', sqlError);
        }
      }

      if (savedToPostgres) {
        return res.status(200).json({
          ok: true,
          complete: chunkIndex + 1 >= totalChunks,
          chunkIndex,
          totalChunks,
          storageMode: 'postgres',
        });
      }

      // 2. Fallback /tmp storage when Postgres is not configured
      const chunkBuf = Buffer.from(cleanBase64, 'base64');
      if (totalChunks === 1) {
        if (chunkBuf.byteLength > 0 && chunkBuf.byteLength <= 55 * 1024 * 1024) {
          saveCloudPdfBuffer(userKey, bookKey, chunkBuf, title);
          for (const b of existingRecord.books) {
            if (
              b.bookKey === bookKey ||
              (title && normalizeComparisonKey(b.title) === normalizeComparisonKey(title))
            ) {
              b.hasCloudPdf = true;
            }
          }
          saveFallbackStore();
        }
        return res.status(200).json({
          ok: true,
          complete: true,
          size: chunkBuf.byteLength,
          storageMode: 'ephemeral-tmp',
          sqlError,
        });
      }

      const chunkStoreKey = makePdfCacheKey(userKey, bookKey);
      let entry = memoryPdfChunks.get(chunkStoreKey);
      if (!entry || chunkIndex === 0 || entry.totalChunks !== totalChunks) {
        entry = { totalChunks, chunks: new Map<number, Buffer>() };
        memoryPdfChunks.set(chunkStoreKey, entry);
      }
      entry.chunks.set(chunkIndex, chunkBuf);

      for (const dir of PDF_CACHE_DIRS) {
        try {
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${chunkStoreKey}.part${chunkIndex}`), chunkBuf);
          break;
        } catch {
          // ignore
        }
      }

      const ordered: Buffer[] = [];
      let allPartsReady = true;
      for (let i = 0; i < totalChunks; i++) {
        let part = entry.chunks.get(i);
        if (!part) {
          for (const dir of PDF_CACHE_DIRS) {
            try {
              const partPath = path.join(dir, `${chunkStoreKey}.part${i}`);
              if (fs.existsSync(partPath)) {
                part = fs.readFileSync(partPath);
                break;
              }
            } catch {
              // ignore
            }
          }
        }
        if (part) {
          ordered.push(part);
        } else {
          allPartsReady = false;
          break;
        }
      }

      if (allPartsReady && ordered.length === totalChunks) {
        const fullBuf = Buffer.concat(ordered);
        memoryPdfChunks.delete(chunkStoreKey);
        if (fullBuf.byteLength > 0 && fullBuf.byteLength <= 55 * 1024 * 1024) {
          saveCloudPdfBuffer(userKey, bookKey, fullBuf, title);
          for (const b of existingRecord.books) {
            if (
              b.bookKey === bookKey ||
              (title && normalizeComparisonKey(b.title) === normalizeComparisonKey(title))
            ) {
              b.hasCloudPdf = true;
            }
          }
          saveFallbackStore();
        }
        return res.status(200).json({
          ok: true,
          complete: true,
          size: fullBuf.byteLength,
          storageMode: 'ephemeral-tmp',
          sqlError,
        });
      }

      return res.status(200).json({
        ok: true,
        complete: false,
        chunkIndex,
        receivedChunks: entry.chunks.size,
        totalChunks,
        storageMode: 'ephemeral-tmp',
        sqlError,
      });
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to store cloud PDF',
      });
    }
  }

  // ---------- GET /api/cloudsql/pdf (Chunked Download + Metadata) ----------
  if (pathname === 'pdf' && req.method === 'GET') {
    const bookKey = String(req.query?.bookKey || urlObj.searchParams.get('bookKey') || '').trim();
    const title = String(req.query?.title || urlObj.searchParams.get('title') || '').trim();
    const mode = String(req.query?.mode || urlObj.searchParams.get('mode') || '').trim();
    const chunkIndexParam = req.query?.chunkIndex ?? urlObj.searchParams.get('chunkIndex');
    const hasChunkIndex = chunkIndexParam !== undefined && chunkIndexParam !== null && String(chunkIndexParam) !== '';
    const requestedChunkIndex = hasChunkIndex ? Math.max(0, Number(chunkIndexParam) || 0) : -1;

    if (!bookKey && !title) {
      return res.status(400).json({ error: 'bookKey or title query parameter is required' });
    }

    // 1. Check PostgreSQL chunk storage FIRST (always stays well under Vercel's 4.5 MB response limit!)
    if (poolInfo) {
      try {
        await ensurePostgresSchema(poolInfo.pool, poolInfo.poolKey);
        const meta = await pgFindPdfMeta(
          poolInfo.pool,
          poolInfo.poolKey,
          user.uid,
          user.email,
          bookKey,
          title
        );
        if (meta && meta.storedChunks > 0) {
          if (mode === 'meta') {
            return res.status(200).json({
              found: true,
              matchedBookKey: meta.matchedBookKey,
              totalChunks: meta.totalChunks,
              storedChunks: meta.storedChunks,
              storageMode: 'postgres',
            });
          }

          if (hasChunkIndex) {
            const partBuf = await pgLoadPdfChunk(
              poolInfo.pool,
              poolInfo.poolKey,
              user.uid,
              user.email,
              meta.matchedBookKey,
              requestedChunkIndex
            );
            if (!partBuf) {
              return res.status(404).json({ error: `Chunk ${requestedChunkIndex} not found` });
            }
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', String(partBuf.byteLength));
            return res.status(200).send(partBuf);
          }

          // Legacy single-request download (only safe for <= 2 chunks / < 3.5 MB)
          const parts: Buffer[] = [];
          for (let i = 0; i < meta.totalChunks; i++) {
            const p = await pgLoadPdfChunk(
              poolInfo.pool,
              poolInfo.poolKey,
              user.uid,
              user.email,
              meta.matchedBookKey,
              i
            );
            if (p) parts.push(p);
          }
          const combined = Buffer.concat(parts);
          if (combined.byteLength > 100) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', String(combined.byteLength));
            return res.status(200).send(combined);
          }
        }
      } catch (err) {
        console.error('Postgres PDF download error:', err instanceof Error ? err.message : err);
      }
    }

    // 2. Fallback to local /tmp buffer (also supports chunked meta/download)
    let buf = loadCloudPdfBuffer(userKey, bookKey, title);
    if (!buf && title) {
      const matchedBook = existingRecord.books.find(
        b => normalizeComparisonKey(b.title) === normalizeComparisonKey(title)
      );
      if (matchedBook) {
        buf = loadCloudPdfBuffer(userKey, matchedBook.bookKey, matchedBook.title);
      }
    }
    if (!buf) {
      return res.status(404).json({ found: false, error: 'PDF not found in cloud storage for this book' });
    }

    const totalChunks = Math.max(1, Math.ceil(buf.byteLength / DOWNLOAD_CHUNK_BYTES));
    if (mode === 'meta') {
      return res.status(200).json({
        found: true,
        matchedBookKey: bookKey || title,
        totalChunks,
        storedChunks: totalChunks,
        storageMode: 'ephemeral-tmp',
      });
    }

    if (hasChunkIndex) {
      const start = requestedChunkIndex * DOWNLOAD_CHUNK_BYTES;
      const end = Math.min(buf.byteLength, start + DOWNLOAD_CHUNK_BYTES);
      const slice = buf.subarray(start, end);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(slice.byteLength));
      return res.status(200).send(slice);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(buf.byteLength));
    return res.status(200).send(buf);
  }

  // ---------- POST /api/cloudsql/sync ----------
  if (pathname === 'sync' && req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (body.databaseUrl && typeof body.databaseUrl === 'string') {
      saveRuntimeDbUrl(body.databaseUrl);
    }
    const booksInput = Array.isArray(body.books) ? body.books : [];
    const notesInput = Array.isArray(body.notes) ? body.notes : [];
    const deletedBookKeysInput: string[] = Array.isArray(body.deletedBookKeys)
      ? body.deletedBookKeys.map(String)
      : [];
    const readdedBookKeysInput: string[] = Array.isArray(body.readdedBookKeys)
      ? body.readdedBookKeys.map(String)
      : [];

    for (const dk of deletedBookKeysInput) {
      deleteCloudPdfBuffer(userKey, dk);
    }

    let sqlError: string | undefined;
    const syncPoolInfo = isPostgresAvailable(body.databaseUrl || headerDbUrl)
      ? getPostgresPool(body.databaseUrl || headerDbUrl)
      : null;

    if (syncPoolInfo) {
      try {
        await ensurePostgresSchema(syncPoolInfo.pool, syncPoolInfo.poolKey);
        const displayName = String(body.displayName || user.displayName || 'Reader');
        const sqlData = await pgSyncLibrary(
          syncPoolInfo.pool,
          syncPoolInfo.poolKey,
          user.uid,
          user.email,
          displayName,
          booksInput,
          notesInput,
          deletedBookKeysInput,
          readdedBookKeysInput
        );
        return res.status(200).json({ ...sqlData, storageMode: 'postgres' });
      } catch (err) {
        sqlError = err instanceof Error ? err.message : String(err);
        console.error('Postgres sync error:', sqlError);
      }
    }

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
    const fallbackAuthoritativeBookKeys = new Set<string>();
    for (const b of booksInput.slice(0, 200)) {
      const bookKey = String(b.bookKey || b.title || `book_${nextBookId}`);
      const bookTitle = String(b.title || '');
      if (isBookKeyDeleted(bookKey, bookTitle)) {
        deleteCloudPdfBuffer(userKey, bookKey);
        continue;
      }

      const prev = bookMap.get(bookKey);
      const resolvedAnn = resolveBookAnnotations(b, prev || {});
      const incomingTs = Number(b.annotationsUpdatedAt) || 0;
      const prevTs = Number(prev?.annotationsUpdatedAt) || 0;
      if (incomingTs > 0 && incomingTs >= prevTs) {
        fallbackAuthoritativeBookKeys.add(bookKey.toLowerCase());
      }

      const hasPdfInCloud = Boolean(
        prev?.hasCloudPdf || loadCloudPdfBuffer(userKey, bookKey, bookTitle) !== null
      );

      bookMap.set(bookKey, {
        id: prev ? prev.id : nextBookId++,
        bookKey,
        title: String(b.title || prev?.title || 'Untitled'),
        author: String(b.author || prev?.author || 'Unknown'),
        category: String(b.category || prev?.category || 'reading'),
        currentPage: Math.max(prev?.currentPage || 1, Number(b.currentPage) || 1),
        totalPages: Math.max(prev?.totalPages || 1, Number(b.totalPages) || 1),
        bookmarkCount: resolvedAnn.bookmarks.length,
        highlightCount: Object.keys(resolvedAnn.highlights).length,
        fileName: String(b.fileName || prev?.fileName || `${b.title || 'book'}.pdf`),
        fileSize: Number(b.fileSize) || prev?.fileSize || 0,
        spineColor: String(b.spineColor || prev?.spineColor || '#4A3525'),
        spineTexture: (b.spineTexture || prev?.spineTexture || 'linen') as SpineTexture,
        coverPattern: (b.coverPattern || prev?.coverPattern || 'minimal') as CoverPattern,
        coverImage: b.coverImage || prev?.coverImage || undefined,
        telegramChannel: b.telegramChannel || prev?.telegramChannel || undefined,
        telegramMessageId: Number(b.telegramMessageId) || prev?.telegramMessageId || undefined,
        bookmarks: resolvedAnn.bookmarks,
        highlights: resolvedAnn.highlights,
        annotationsUpdatedAt: resolvedAnn.annotationsUpdatedAt,
        hasCloudPdf: hasPdfInCloud,
        pageOffset:
          typeof b.pageOffset === 'number'
            ? b.pageOffset
            : typeof prev?.pageOffset === 'number'
            ? prev.pageOffset
            : undefined,
        pageAnchors:
          Array.isArray(b.pageAnchors)
            ? b.pageAnchors
            : Array.isArray(prev?.pageAnchors)
            ? prev.pageAnchors
            : undefined,
        chapters: Array.isArray(b.chapters) && b.chapters.length > 0 ? b.chapters : prev?.chapters,
        chaptersLocked:
          typeof b.chaptersLocked === 'boolean' ? b.chaptersLocked : prev?.chaptersLocked,
        updatedAt: nowIso,
      });
    }

    existingRecord.books = Array.from(bookMap.values());
    existingRecord.deletedBookKeys = Array.from(deletedSet);

    const noteMap = new Map<string, StoredCloudNote>();
    for (const n of existingRecord.notes) {
      if (isBookKeyDeleted(n.bookKey, n.bookTitle)) continue;
      if (fallbackAuthoritativeBookKeys.has(String(n.bookKey || '').toLowerCase())) continue;
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
    return res.status(200).json({ ...existingRecord, storageMode: 'ephemeral-tmp', sqlError });
  }

  // ---------- POST /api/cloudsql/vocabulary ----------
  if (pathname === 'vocabulary' && req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (poolInfo) {
      try {
        await ensurePostgresSchema(poolInfo.pool, poolInfo.poolKey);
        const userRecord = await pgGetOrCreateUser(poolInfo.pool, user.uid, user.email, user.displayName);
        const inserted = await poolInfo.pool.query(
          `INSERT INTO sql_vocabulary (user_id, word, part_of_speech, persian_meaning, english_meaning, context_explanation, book_title, page)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, word, part_of_speech, persian_meaning, english_meaning, context_explanation, book_title, page, created_at`,
          [
            userRecord.id,
            String(body.word || '').slice(0, 200),
            String(body.partOfSpeech || '').slice(0, 100),
            String(body.persianMeaning || '').slice(0, 2000),
            String(body.englishMeaning || '').slice(0, 2000),
            String(body.contextExplanation || '').slice(0, 2000),
            String(body.bookTitle || '').slice(0, 200),
            Number(body.page) || 1,
          ]
        );
        const r = inserted.rows[0];
        return res.status(200).json({
          entry: {
            id: Number(r.id),
            word: String(r.word),
            partOfSpeech: String(r.part_of_speech),
            persianMeaning: String(r.persian_meaning),
            englishMeaning: String(r.english_meaning),
            contextExplanation: String(r.context_explanation),
            bookTitle: String(r.book_title),
            page: Number(r.page),
            createdAt: new Date(r.created_at).toISOString(),
          },
          storageMode: 'postgres',
        });
      } catch (err) {
        console.error('Postgres vocabulary error:', err instanceof Error ? err.message : err);
      }
    }

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
    return res.status(200).json({ entry, storageMode: 'ephemeral-tmp' });
  }

  return res.status(404).json({ error: `Unknown Cloud SQL route: ${pathname}` });
}
