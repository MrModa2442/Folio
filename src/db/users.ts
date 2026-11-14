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
}

export interface SyncNoteInput {
  noteKey: string;
  bookKey: string;
  bookTitle: string;
  page: number;
  noteText: string;
}

function packBookMetadata(b: SyncBookInput, prevMeta: Partial<SyncBookInput> = {}): string {
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
    status: b.category && !b.category.startsWith('{') ? b.category : prevMeta.category || 'reading',
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
  return {
    ...row,
    category: cleanCategory,
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
  };
}

export async function syncUserLibraryToSql(
  uid: string,
  email: string,
  displayName: string,
  booksInput: SyncBookInput[],
  notesInput: SyncNoteInput[]
) {
  try {
    const userRecord = await getOrCreateUser(uid, email, displayName);

    // Replace or update books for this user (non-destructive merge)
    for (const b of booksInput.slice(0, 150)) {
      const existing = await db
        .select()
        .from(sqlBooks)
        .where(and(eq(sqlBooks.userId, userRecord.id), eq(sqlBooks.bookKey, b.bookKey)));

      if (existing.length > 0) {
        const prevUnpacked = unpackBookRow(existing[0]);
        const packedCategory = packBookMetadata(b, prevUnpacked);
        await db
          .update(sqlBooks)
          .set({
            title: b.title || existing[0].title,
            author: b.author || existing[0].author,
            category: packedCategory,
            currentPage: Math.max(existing[0].currentPage || 1, b.currentPage || 1),
            totalPages: Math.max(existing[0].totalPages || 1, b.totalPages || 1),
            bookmarkCount: Math.max(existing[0].bookmarkCount || 0, b.bookmarkCount || 0),
            highlightCount: Math.max(existing[0].highlightCount || 0, b.highlightCount || 0),
            updatedAt: new Date(),
          })
          .where(eq(sqlBooks.id, existing[0].id));
      } else {
        const packedCategory = packBookMetadata(b);
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

    // Merge study notes for this user (never wipe existing notes when syncing from a 0-book second device)
    if (notesInput.length > 0) {
      const existingNotes = await db
        .select()
        .from(sqlNotes)
        .where(eq(sqlNotes.userId, userRecord.id));
      const existingNoteKeys = new Set(existingNotes.map(n => n.noteKey));
      const newNotes = notesInput
        .slice(0, 250)
        .filter(n => !existingNoteKeys.has(n.noteKey));

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

    const [booksRows, notesRows, vocabRows] = await Promise.all([
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

    return {
      user: userRecord,
      books: booksRows.map(unpackBookRow),
      notes: notesRows,
      vocabulary: vocabRows,
    };
  } catch (error) {
    console.error('Database query failed in getUserLibraryFromSql:', error);
    throw new Error('Failed to load user library from database.', { cause: error });
  }
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
