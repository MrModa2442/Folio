import { db } from './index.ts';
import { users, sqlBooks, sqlNotes, sqlVocabulary } from './schema.ts';
import { and, desc, eq } from 'drizzle-orm';

export async function getOrCreateUser(uid: string, email: string, displayName = 'Reader') {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email: email || 'reader@folio.app',
        displayName: displayName || 'Reader',
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: email || 'reader@folio.app',
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
}

export interface SyncNoteInput {
  noteKey: string;
  bookKey: string;
  bookTitle: string;
  page: number;
  noteText: string;
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

    // Replace or update books for this user
    for (const b of booksInput.slice(0, 100)) {
      const existing = await db
        .select()
        .from(sqlBooks)
        .where(and(eq(sqlBooks.userId, userRecord.id), eq(sqlBooks.bookKey, b.bookKey)));

      if (existing.length > 0) {
        await db
          .update(sqlBooks)
          .set({
            title: b.title,
            author: b.author,
            category: b.category,
            currentPage: b.currentPage,
            totalPages: b.totalPages,
            bookmarkCount: b.bookmarkCount,
            highlightCount: b.highlightCount,
            updatedAt: new Date(),
          })
          .where(eq(sqlBooks.id, existing[0].id));
      } else {
        await db.insert(sqlBooks).values({
          userId: userRecord.id,
          bookKey: b.bookKey,
          title: b.title,
          author: b.author,
          category: b.category,
          currentPage: b.currentPage,
          totalPages: b.totalPages,
          bookmarkCount: b.bookmarkCount,
          highlightCount: b.highlightCount,
        });
      }
    }

    // Sync study notes for this user
    await db.delete(sqlNotes).where(eq(sqlNotes.userId, userRecord.id));
    if (notesInput.length > 0) {
      await db.insert(sqlNotes).values(
        notesInput.slice(0, 250).map(n => ({
          userId: userRecord.id,
          noteKey: n.noteKey,
          bookKey: n.bookKey,
          bookTitle: n.bookTitle,
          page: n.page,
          noteText: n.noteText,
        }))
      );
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
      books: booksRows,
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
