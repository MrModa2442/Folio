import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').default('Reader').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sqlBooks = pgTable('sql_books', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  bookKey: text('book_key').notNull(),
  title: text('title').notNull(),
  author: text('author').notNull(),
  category: text('category').default('General').notNull(),
  currentPage: integer('current_page').default(1).notNull(),
  totalPages: integer('total_pages').default(1).notNull(),
  bookmarkCount: integer('bookmark_count').default(0).notNull(),
  highlightCount: integer('highlight_count').default(0).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sqlNotes = pgTable('sql_notes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  noteKey: text('note_key').notNull(),
  bookKey: text('book_key').notNull(),
  bookTitle: text('book_title').notNull(),
  page: integer('page').default(1).notNull(),
  noteText: text('note_text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sqlVocabulary = pgTable('sql_vocabulary', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  word: text('word').notNull(),
  partOfSpeech: text('part_of_speech').default('').notNull(),
  persianMeaning: text('persian_meaning').notNull(),
  englishMeaning: text('english_meaning').notNull(),
  contextExplanation: text('context_explanation').default('').notNull(),
  bookTitle: text('book_title').default('').notNull(),
  page: integer('page').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  books: many(sqlBooks),
  notes: many(sqlNotes),
  vocabulary: many(sqlVocabulary),
}));

export const sqlBooksRelations = relations(sqlBooks, ({ one }) => ({
  owner: one(users, {
    fields: [sqlBooks.userId],
    references: [users.id],
  }),
}));

export const sqlNotesRelations = relations(sqlNotes, ({ one }) => ({
  owner: one(users, {
    fields: [sqlNotes.userId],
    references: [users.id],
  }),
}));

export const sqlVocabularyRelations = relations(sqlVocabulary, ({ one }) => ({
  owner: one(users, {
    fields: [sqlVocabulary.userId],
    references: [users.id],
  }),
}));
