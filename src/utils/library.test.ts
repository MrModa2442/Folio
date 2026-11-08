import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanPdfFilename,
  createBooklist,
  toggleBooklistPrivacy,
  addCollaborator,
  removeCollaborator,
  addBookToBooklist,
  removeBookFromBooklist,
  filterBooks,
  searchPublicBooklists,
  calculateReadingStats,
} from './library';
import { Book, Booklist } from '../types/library';

test('cleanPdfFilename extracts author and title when dash separated', () => {
  const result = cleanPdfFilename('Fyodor Dostoevsky - White Nights.pdf');
  assert.equal(result.author, 'Fyodor Dostoevsky');
  assert.equal(result.title, 'White Nights');
});

test('cleanPdfFilename cleans underscores and capitalizes words', () => {
  const result = cleanPdfFilename('the_art_of_war.pdf');
  assert.equal(result.title, 'The Art Of War');
  assert.equal(result.author, 'Unknown Author');
});

test('createBooklist sets defaults and generates invite code', () => {
  const list = createBooklist({
    title: 'Rainy Afternoon Reads',
    isPublic: false,
    ownerName: 'Moda',
  });
  assert.equal(list.title, 'Rainy Afternoon Reads');
  assert.equal(list.isPublic, false);
  assert.equal(list.ownerName, 'Moda');
  assert.equal(list.collaborators.length, 0);
  assert.ok(list.inviteCode.startsWith('FOLIO-'));
});

test('toggleBooklistPrivacy flips visibility flag', () => {
  const list = createBooklist({ title: 'My Shelf', isPublic: false });
  const updated = toggleBooklistPrivacy(list, true);
  assert.equal(updated.isPublic, true);
});

test('addCollaborator adds new unique reader and rejects duplicates', () => {
  const list = createBooklist({ title: 'Philosophy Circle', isPublic: false });
  const withOne = addCollaborator(list, {
    email: 'reader@example.com',
    name: 'Elena',
    role: 'editor',
    avatarColor: '#2D3748',
  });
  assert.equal(withOne.collaborators.length, 1);
  assert.equal(withOne.collaborators[0].name, 'Elena');

  const withDup = addCollaborator(withOne, {
    email: 'reader@example.com',
    name: 'Elena Duplicate',
    role: 'viewer',
    avatarColor: '#2D3748',
  });
  assert.equal(withDup.collaborators.length, 1);
});

test('removeCollaborator removes reader by ID', () => {
  const list = createBooklist({ title: 'Test List', isPublic: false });
  const withCollab = addCollaborator(list, {
    email: 'collab@test.com',
    name: 'Marcus',
    role: 'viewer',
    avatarColor: '#4A5568',
  });
  const collabId = withCollab.collaborators[0].id;
  const removed = removeCollaborator(withCollab, collabId);
  assert.equal(removed.collaborators.length, 0);
});

test('addBookToBooklist and removeBookFromBooklist manage book IDs without duplicate', () => {
  let list = createBooklist({ title: 'SciFi Essentials' });
  list = addBookToBooklist(list, 'b1');
  list = addBookToBooklist(list, 'b2');
  list = addBookToBooklist(list, 'b1');
  assert.deepEqual(list.bookIds, ['b1', 'b2']);

  list = removeBookFromBooklist(list, 'b1');
  assert.deepEqual(list.bookIds, ['b2']);
});

test('filterBooks filters by query and reading status', () => {
  const books: Book[] = [
    {
      id: '1',
      title: 'Meditations',
      author: 'Marcus Aurelius',
      fileName: 'meditations.pdf',
      fileSize: 1024,
      pageCount: 200,
      currentPage: 50,
      status: 'reading',
      spineColor: '#3E2723',
      spineTexture: 'leather',
      coverPattern: 'classical',
      dateAdded: '2026-01-01',
    },
    {
      id: '2',
      title: 'Dune',
      author: 'Frank Herbert',
      fileName: 'dune.pdf',
      fileSize: 2048,
      pageCount: 600,
      currentPage: 600,
      status: 'completed',
      spineColor: '#1A365D',
      spineTexture: 'linen',
      coverPattern: 'geometric',
      dateAdded: '2026-01-02',
    },
  ];

  const byQuery = filterBooks(books, 'Marcus', 'all');
  assert.equal(byQuery.length, 1);
  assert.equal(byQuery[0].title, 'Meditations');

  const byStatus = filterBooks(books, '', 'completed');
  assert.equal(byStatus.length, 1);
  assert.equal(byStatus[0].title, 'Dune');
});

test('searchPublicBooklists only returns public lists and matches search text', () => {
  const lists: Booklist[] = [
    {
      id: 'l1',
      title: 'Public Stoic Reading',
      description: 'Ancient philosophy for everyday tranquility',
      isPublic: true,
      ownerName: 'Bibliophile',
      ownerEmail: 'bio@test.com',
      isOwner: false,
      coverColor: '#2D3748',
      coverArtStyle: 'scholar',
      bookIds: [],
      inviteCode: 'FOLIO-1234',
      collaborators: [],
      likesCount: 12,
      savesCount: 4,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'l2',
      title: 'Private Journal Books',
      description: 'Secret notes',
      isPublic: false,
      ownerName: 'Secret Reader',
      ownerEmail: 'secret@test.com',
      isOwner: true,
      coverColor: '#1A202C',
      coverArtStyle: 'night',
      bookIds: [],
      inviteCode: 'FOLIO-9999',
      collaborators: [],
      likesCount: 0,
      savesCount: 0,
      createdAt: '',
      updatedAt: '',
    },
  ];

  const results = searchPublicBooklists(lists, 'stoic');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'l1');

  const privateSearch = searchPublicBooklists(lists, 'Secret');
  assert.equal(privateSearch.length, 0);
});

test('calculateReadingStats computes counts and completion percentages', () => {
  const books: Book[] = [
    {
      id: '1',
      title: 'Book A',
      author: 'Author A',
      fileName: 'a.pdf',
      fileSize: 100,
      pageCount: 100,
      currentPage: 50,
      status: 'reading',
      spineColor: '#111',
      spineTexture: 'cloth',
      coverPattern: 'minimal',
      dateAdded: '',
    },
    {
      id: '2',
      title: 'Book B',
      author: 'Author B',
      fileName: 'b.pdf',
      fileSize: 100,
      pageCount: 100,
      currentPage: 100,
      status: 'completed',
      spineColor: '#111',
      spineTexture: 'cloth',
      coverPattern: 'minimal',
      dateAdded: '',
    },
  ];

  const stats = calculateReadingStats(books);
  assert.equal(stats.totalBooks, 2);
  assert.equal(stats.totalPages, 200);
  assert.equal(stats.pagesRead, 150);
  assert.equal(stats.completionRate, 75);
  assert.equal(stats.completedBooks, 1);
  assert.equal(stats.readingBooks, 1);
});
