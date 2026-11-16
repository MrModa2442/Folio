import { db } from './index.ts';
import { users, sqlBooks, sqlNotes, sqlVocabulary } from './schema.ts';
import { and, desc, eq } from 'drizzle-orm';

export async function getOrCreateUser(uid: string, email: string, displayName = 'Reader') {
  const normalizedEmail = (email || 'reader@folio.app').trim().toLowerCase();
  const effectiveUid = normalizedEmail ? `email_${normalizedEmail.replace(/[^a-z0-9]/g, '_')}` : uid;
  try {
    const result = await db
      .insert(users)
      .values({
        uid: effectiveUid,
        email: normalizedEmail,
        displayName: displayName || 'Reader',
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: normalizedEmail,
          displayName: displayName || 'Reader',
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Failed to synchronize user account in database.', { cause: error });
  }
}

export interface SyncBookInput {
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
  spineTexture?: string;
  coverPattern?: string;
  coverImage?: string;
  telegramChannel?: string;
  telegramMessageId?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bookmarks?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  highlights?: Record<number, any[]>;
  hasCloudPdf?: boolean;
  pageOffset?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chapters?: any[];
  chaptersLocked?: boolean;
  deleted?: boolean;
  deletedAt?: string;
}

export interface SyncNoteInput {
  noteKey: string;
  bookKey: string;
  bookTitle: string;
  page: number;
  noteText: string;
}

function normalizeBookKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

function sanitizeBookKey(raw: string): string {
  return String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120)
    .toLowerCase();
}

function packBookMetadata(
  b: SyncBookInput,
  prevMeta: Partial<SyncBookInput> = {},
  isDeleted = false
): string {
  if (isDeleted) {
    return JSON.stringify({
      status: '__deleted__',
      deleted: true,
      deletedAt: new Date().toISOString(),
    });
  }

  const incomingBookmarks = Array.isArray(b.bookmarks) ? b.bookmarks : [];
  const prevBookmarks = Array.isArray(prevMeta.bookmarks) ? prevMeta.bookmarks : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bmMap = new Map<number, any>();
  for (const bm of prevBookmarks) {
    if (bm && typeof bm.page === 'number') bmMap.set(bm.page, bm);
  }
  for (const bm of incomingBookmarks) {
    if (bm && typeof bm.page === 'number') bmMap.set(bm.page, bm);
  }
  const mergedBookmarks = Array.from(bmMap.values()).sort((a, c) => a.page - c.page);

  const mergedHighlights = {
    ...(prevMeta.highlights || {}),
    ...(b.highlights && typeof b.highlights === 'object' ? b.highlights : {}),
  };

  return JSON.stringify({
    status:
      b.category && !b.category.startsWith('{') && b.category !== '__deleted__'
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
    bookmarks: mergedBookmarks,
    highlights: mergedHighlights,
    hasCloudPdf: Boolean(b.hasCloudPdf || prevMeta.hasCloudPdf),
    pageOffset:
      typeof b.pageOffset === 'number'
        ? b.pageOffset
        : typeof prevMeta.pageOffset === 'number'
        ? prevMeta.pageOffset
        : undefined,
    chapters:
      Array.isArray(b.chapters) && b.chapters.length > 0 ? b.chapters : prevMeta.chapters,
    chaptersLocked:
      typeof b.chaptersLocked === 'boolean' ? b.chaptersLocked : prevMeta.chaptersLocked,
  });
}

function unpackBookRow(row: typeof sqlBooks.$inferSelect) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let meta: Record<string, any> = {};
  let cleanCategory = row.category || 'reading';
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
    ...row,
    category: cleanCategory,
    deleted: isDeleted,
    deletedAt: meta.deletedAt,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    spineColor: meta.spineColor,
    spineTexture: meta.spineTexture,
    coverPattern: meta.coverPattern,
    coverImage: meta.coverImage,
    telegramChannel: meta.telegramChannel,
    telegramMessageId: meta.telegramMessageId,
    bookmarks: Array.isArray(meta.bookmarks) ? meta.bookmarks : [],
    highlights: meta.highlights && typeof meta.highlights === 'object' ? meta.highlights : {},
    hasCloudPdf: Boolean(meta.hasCloudPdf),
    pageOffset: typeof meta.pageOffset === 'number' ? meta.pageOffset : undefined,
    chapters: Array.isArray(meta.chapters) ? meta.chapters : undefined,
    chaptersLocked: typeof meta.chaptersLocked === 'boolean' ? meta.chaptersLocked : undefined,
  };
}

export async function syncUserLibraryToSql(
  uid: string,
  email: string,
  displayName: string,
  booksInput: SyncBookInput[],
  notesInput: SyncNoteInput[],
  deletedBookKeysInput: string[] = [],
  readdedBookKeysInput: string[] = []
) {
  try {
    const userRecord = await getOrCreateUser(uid, email, displayName);

    const allRows = await db
      .select()
      .from(sqlBooks)
      .where(eq(sqlBooks.userId, userRecord.id));

    const existingRows = allRows.filter(
      r => r.author !== '__pdf_chunk__' && !r.bookKey.startsWith('__pdfchunk__')
    );
    const pdfChunkRows = allRows.filter(
      r => r.author === '__pdf_chunk__' || r.bookKey.startsWith('__pdfchunk__')
    );

    const deletedSet = new Set<string>();
    const readdedSet = new Set<string>();

    for (const rk of readdedBookKeysInput) {
      const k1 = normalizeBookKey(rk);
      const k2 = sanitizeBookKey(rk);
      if (k1) readdedSet.add(k1);
      if (k2) readdedSet.add(k2);
    }

    for (const row of existingRows) {
      const unpacked = unpackBookRow(row);
      if (unpacked.deleted) {
        const k1 = normalizeBookKey(row.bookKey);
        const k2 = sanitizeBookKey(row.bookKey);
        const t1 = normalizeBookKey(row.title);
        const t2 = sanitizeBookKey(row.title);
        if (k1 && !readdedSet.has(k1)) deletedSet.add(k1);
        if (k2 && !readdedSet.has(k2)) deletedSet.add(k2);
        if (t1 && !readdedSet.has(t1)) deletedSet.add(t1);
        if (t2 && !readdedSet.has(t2)) deletedSet.add(t2);
      }
    }

    for (const dk of deletedBookKeysInput) {
      const k1 = normalizeBookKey(dk);
      const k2 = sanitizeBookKey(dk);
      if (k1 && !readdedSet.has(k1)) deletedSet.add(k1);
      if (k2 && !readdedSet.has(k2)) deletedSet.add(k2);
    }

    const isBookDeleted = (bookKey: string, title?: string): boolean => {
      const k1 = normalizeBookKey(bookKey);
      const k2 = sanitizeBookKey(bookKey);
      const t1 = normalizeBookKey(title || '');
      const t2 = sanitizeBookKey(title || '');
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

    // Delete any PDF chunks belonging to deleted books
    for (const chunkRow of pdfChunkRows) {
      const match = chunkRow.bookKey.match(/^__pdfchunk__(.+)__\d+$/);
      const chunkBookKey = match ? match[1] : chunkRow.bookKey;
      if (isBookDeleted(chunkBookKey, chunkRow.title)) {
        await db.delete(sqlBooks).where(eq(sqlBooks.id, chunkRow.id));
      }
    }

    // Mark any deleted existing books as tombstones in sqlBooks and delete their notes
    for (const row of existingRows) {
      const unpacked = unpackBookRow(row);
      if (isBookDeleted(row.bookKey, row.title)) {
        if (!unpacked.deleted) {
          await db
            .update(sqlBooks)
            .set({
              category: packBookMetadata(
                {
                  bookKey: row.bookKey,
                  title: row.title,
                  author: row.author,
                  category: '__deleted__',
                  currentPage: row.currentPage,
                  totalPages: row.totalPages,
                  bookmarkCount: 0,
                  highlightCount: 0,
                },
                {},
                true
              ),
              bookmarkCount: 0,
              highlightCount: 0,
              updatedAt: new Date(),
            })
            .where(eq(sqlBooks.id, row.id));
        }
        await db
          .delete(sqlNotes)
          .where(and(eq(sqlNotes.userId, userRecord.id), eq(sqlNotes.bookKey, row.bookKey)));
      }
    }

    // Also insert tombstones for newly deleted bookKeys that weren't in existingRows yet
    for (const dk of deletedBookKeysInput.slice(0, 100)) {
      const cleanKey = sanitizeBookKey(dk) || normalizeBookKey(dk);
      if (!cleanKey || readdedSet.has(cleanKey)) continue;
      const alreadyInRows = existingRows.some(
        r =>
          normalizeBookKey(r.bookKey) === cleanKey ||
          sanitizeBookKey(r.bookKey) === cleanKey ||
          normalizeBookKey(r.title) === cleanKey ||
          sanitizeBookKey(r.title) === cleanKey
      );
      if (!alreadyInRows) {
        await db.insert(sqlBooks).values({
          userId: userRecord.id,
          bookKey: cleanKey,
          title: dk.slice(0, 200),
          author: 'Deleted',
          category: JSON.stringify({
            status: '__deleted__',
            deleted: true,
            deletedAt: new Date().toISOString(),
          }),
          currentPage: 1,
          totalPages: 1,
          bookmarkCount: 0,
          highlightCount: 0,
        });
      }
    }

    // Replace or update active books for this user (non-destructive merge for non-deleted books)
    for (const b of booksInput.slice(0, 150)) {
      if (isBookDeleted(b.bookKey, b.title)) {
        continue;
      }

      const existing = existingRows.filter(r => r.bookKey === b.bookKey);

      if (existing.length > 0) {
        const prevUnpacked = unpackBookRow(existing[0]);
        const packedCategory = packBookMetadata(
          b,
          prevUnpacked.deleted ? {} : prevUnpacked,
          false
        );
        await db
          .update(sqlBooks)
          .set({
            title: b.title || existing[0].title,
            author: b.author || existing[0].author,
            category: packedCategory,
            currentPage: prevUnpacked.deleted
              ? b.currentPage || 1
              : Math.max(existing[0].currentPage || 1, b.currentPage || 1),
            totalPages: prevUnpacked.deleted
              ? b.totalPages || 1
              : Math.max(existing[0].totalPages || 1, b.totalPages || 1),
            bookmarkCount: prevUnpacked.deleted
              ? b.bookmarkCount || 0
              : Math.max(existing[0].bookmarkCount || 0, b.bookmarkCount || 0),
            highlightCount: prevUnpacked.deleted
              ? b.highlightCount || 0
              : Math.max(existing[0].highlightCount || 0, b.highlightCount || 0),
            updatedAt: new Date(),
          })
          .where(eq(sqlBooks.id, existing[0].id));
      } else {
        const packedCategory = packBookMetadata(b, {}, false);
        await db.insert(sqlBooks).values({
          userId: userRecord.id,
          bookKey: b.bookKey,
          title: b.title,
          author: b.author,
          category: packedCategory,
          currentPage: b.currentPage || 1,
          totalPages: b.totalPages || 1,
          bookmarkCount: b.bookmarkCount || 0,
          highlightCount: b.highlightCount || 0,
        });
      }
    }

    // Merge study notes for this user (skipping notes for deleted books)
    if (notesInput.length > 0) {
      const existingNotes = await db
        .select()
        .from(sqlNotes)
        .where(eq(sqlNotes.userId, userRecord.id));
      const existingNoteKeys = new Set(existingNotes.map(n => n.noteKey));
      const newNotes = notesInput
        .slice(0, 250)
        .filter(
          n => !existingNoteKeys.has(n.noteKey) && !isBookDeleted(n.bookKey, n.bookTitle)
        );

      if (newNotes.length > 0) {
        await db.insert(sqlNotes).values(
          newNotes.map(n => ({
            userId: userRecord.id,
            noteKey: n.noteKey,
            bookKey: n.bookKey,
            bookTitle: n.bookTitle,
            page: n.page,
            noteText: n.noteText,
          }))
        );
      }
    }

    return await getUserLibraryFromSql(uid, email, displayName);
  } catch (error) {
    console.error('Database query failed in syncUserLibraryToSql:', error);
    throw new Error('Database sync failed. Please try again later.', { cause: error });
  }
}

export async function getUserLibraryFromSql(uid: string, email: string, displayName = 'Reader') {
  try {
    const userRecord = await getOrCreateUser(uid, email, displayName);

    const [allBooksRows, notesRows, vocabRows] = await Promise.all([
      db
        .select()
        .from(sqlBooks)
        .where(eq(sqlBooks.userId, userRecord.id))
        .orderBy(desc(sqlBooks.updatedAt)),
      db
        .select()
        .from(sqlNotes)
        .where(eq(sqlNotes.userId, userRecord.id))
        .orderBy(desc(sqlNotes.createdAt)),
      db
        .select()
        .from(sqlVocabulary)
        .where(eq(sqlVocabulary.userId, userRecord.id))
        .orderBy(desc(sqlVocabulary.createdAt)),
    ]);

    const pdfChunkRows = allBooksRows.filter(
      r => r.author === '__pdf_chunk__' || r.bookKey.startsWith('__pdfchunk__')
    );
    const booksRows = allBooksRows.filter(
      r => r.author !== '__pdf_chunk__' && !r.bookKey.startsWith('__pdfchunk__')
    );

    const keysWithPdfChunks = new Set<string>();
    const titlesWithPdfChunks = new Set<string>();
    for (const cr of pdfChunkRows) {
      const m = cr.bookKey.match(/^__pdfchunk__(.+)__\d+$/);
      if (m && m[1]) {
        keysWithPdfChunks.add(normalizeBookKey(m[1]));
        keysWithPdfChunks.add(sanitizeBookKey(m[1]));
      }
      if (cr.title) {
        titlesWithPdfChunks.add(normalizeBookKey(cr.title));
      }
    }

    const unpackedAll = booksRows.map(row => {
      const unpacked = unpackBookRow(row);
      const hasChunks =
        keysWithPdfChunks.has(normalizeBookKey(row.bookKey)) ||
        keysWithPdfChunks.has(sanitizeBookKey(row.bookKey)) ||
        (row.title && titlesWithPdfChunks.has(normalizeBookKey(row.title)));
      return {
        ...unpacked,
        hasCloudPdf: Boolean(unpacked.hasCloudPdf || hasChunks),
      };
    });

    const activeBooks = unpackedAll.filter(b => !b.deleted);
    const deletedBookKeys = Array.from(
      new Set(
        unpackedAll
          .filter(b => b.deleted)
          .flatMap(b => [
            normalizeBookKey(b.bookKey),
            sanitizeBookKey(b.bookKey),
            normalizeBookKey(b.title),
            sanitizeBookKey(b.title),
          ])
          .filter(Boolean)
      )
    );
    const deletedSet = new Set(deletedBookKeys);
    const activeNotes = notesRows.filter(
      n =>
        !deletedSet.has(normalizeBookKey(n.bookKey)) &&
        !deletedSet.has(sanitizeBookKey(n.bookKey)) &&
        !deletedSet.has(normalizeBookKey(n.bookTitle)) &&
        !deletedSet.has(sanitizeBookKey(n.bookTitle))
    );

    return {
      user: userRecord,
      books: activeBooks,
      notes: activeNotes,
      vocabulary: vocabRows,
      deletedBookKeys,
    };
  } catch (error) {
    console.error('Database query failed in getUserLibraryFromSql:', error);
    throw new Error('Failed to load user library from database.', { cause: error });
  }
}

export async function saveBookPdfChunkToSql(
  uid: string,
  email: string,
  bookKey: string,
  title: string,
  chunkIndex: number,
  totalChunks: number,
  chunkBase64: string
): Promise<void> {
  const userRecord = await getOrCreateUser(uid, email);
  const safeKey = sanitizeBookKey(bookKey) || normalizeBookKey(bookKey) || 'book';
  const chunkRowKey = `__pdfchunk__${safeKey}__${chunkIndex}`;

  if (chunkIndex === 0) {
    // Clean up any older chunks for this bookKey before writing new chunks
    const existingAll = await db
      .select({ id: sqlBooks.id, bookKey: sqlBooks.bookKey })
      .from(sqlBooks)
      .where(and(eq(sqlBooks.userId, userRecord.id), eq(sqlBooks.author, '__pdf_chunk__')));
    for (const r of existingAll) {
      if (r.bookKey.startsWith(`__pdfchunk__${safeKey}__`)) {
        await db.delete(sqlBooks).where(eq(sqlBooks.id, r.id));
      }
    }
  }

  await db.insert(sqlBooks).values({
    userId: userRecord.id,
    bookKey: chunkRowKey,
    title: (title || safeKey).slice(0, 200),
    author: '__pdf_chunk__',
    category: chunkBase64,
    currentPage: chunkIndex,
    totalPages: totalChunks,
    bookmarkCount: 0,
    highlightCount: 0,
  });
}

export async function loadBookPdfBufferFromSql(
  uid: string,
  email: string,
  bookKey: string,
  title?: string
): Promise<Buffer | null> {
  const userRecord = await getOrCreateUser(uid, email);
  const chunkRows = await db
    .select()
    .from(sqlBooks)
    .where(and(eq(sqlBooks.userId, userRecord.id), eq(sqlBooks.author, '__pdf_chunk__')));

  if (chunkRows.length === 0) return null;

  const targetSafeKey = sanitizeBookKey(bookKey) || normalizeBookKey(bookKey);
  const targetTitleLower = normalizeBookKey(title || '');

  let matched = chunkRows.filter(r => {
    const m = r.bookKey.match(/^__pdfchunk__(.+)__\d+$/);
    if (!m) return false;
    return normalizeBookKey(m[1]) === targetSafeKey || sanitizeBookKey(m[1]) === targetSafeKey;
  });

  if (matched.length === 0 && targetTitleLower) {
    matched = chunkRows.filter(r => normalizeBookKey(r.title) === targetTitleLower);
  }

  if (matched.length === 0) return null;

  // Group by chunk prefix in case multiple books shared a title, pick the most recent set
  const byPrefix = new Map<string, typeof matched>();
  for (const r of matched) {
    const m = r.bookKey.match(/^(__pdfchunk__.+__)(\d+)$/);
    const prefix = m ? m[1] : '__default__';
    const list = byPrefix.get(prefix) || [];
    list.push(r);
    byPrefix.set(prefix, list);
  }

  const chosenGroup = Array.from(byPrefix.values()).sort((a, b) => b.length - a.length)[0];
  if (!chosenGroup || chosenGroup.length === 0) return null;

  chosenGroup.sort((a, b) => a.currentPage - b.currentPage);
  const buffers = chosenGroup.map(r => Buffer.from(r.category || '', 'base64'));
  const combined = Buffer.concat(buffers);
  return combined.byteLength > 100 ? combined : null;
}

export async function saveVocabularyToSql(
  uid: string,
  email: string,
  entry: {
    word: string;
    partOfSpeech: string;
    persianMeaning: string;
    englishMeaning: string;
    contextExplanation: string;
    bookTitle: string;
    page: number;
  }
) {
  try {
    const userRecord = await getOrCreateUser(uid, email);
    const inserted = await db
      .insert(sqlVocabulary)
      .values({
        userId: userRecord.id,
        word: entry.word.slice(0, 200),
        partOfSpeech: (entry.partOfSpeech || '').slice(0, 100),
        persianMeaning: entry.persianMeaning.slice(0, 2000),
        englishMeaning: entry.englishMeaning.slice(0, 2000),
        contextExplanation: (entry.contextExplanation || '').slice(0, 2000),
        bookTitle: (entry.bookTitle || '').slice(0, 200),
        page: entry.page || 1,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed in saveVocabularyToSql:', error);
    throw new Error('Failed to save vocabulary entry to database.', { cause: error });
  }
}
