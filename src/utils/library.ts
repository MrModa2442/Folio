import { Book, Booklist, Collaborator, ReadingStatus } from '../types/library';

const BANNED_CHANNEL_PHRASES = [
  'کتاب‌هایی که باید بخونیم',
  'کتاب هایی که باید بخونیم',
  'کتاب‌هایی که باید بخوانیم',
  'کتاب هایی که باید بخوانیم',
  'کتابهایی که باید بخوانیم',
  'کتابهایی که باید بخونیم',
  'unknown author',
  'unknown writer',
];

/**
 * Removes Telegram handles (e.g. (@ocbooks), @ocbooks, t.me/...), channel names,
 * and empty brackets/parentheses from book titles and authors.
 */
export function sanitizeBookTitle(raw: string, channelTitle?: string): string {
  if (!raw) return '';
  let text = raw
    // Remove file extension if present
    .replace(/\.pdf$/i, '')
    // Remove parenthesized or bracketed @handles or t.me links e.g. (@ocbooks), [@ocbooks]
    .replace(/[\(\[\{«]\s*(?:@[a-zA-Z0-9_]+|(?:https?:\/\/)?(?:t|telegram)\.me\/[^\s\)\]\}»]+)\s*[\)\]\}»]/gi, ' ')
    // Remove bare @handles e.g. @ocbooks
    .replace(/@[a-zA-Z0-9_]+/g, ' ')
    // Remove bare t.me links
    .replace(/(?:https?:\/\/)?(?:t|telegram)\.me\/[a-zA-Z0-9_\/]+/gi, ' ');

  for (const phrase of BANNED_CHANNEL_PHRASES) {
    text = text.split(phrase).join(' ');
  }
  if (channelTitle && channelTitle.trim()) {
    text = text.split(channelTitle.trim()).join(' ');
  }

  text = text
    // Remove empty parentheses or brackets left behind
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}|«\s*»/g, ' ')
    // Replace underscores with spaces
    .replace(/_+/g, ' ')
    // Trim leading/trailing dashes or dots
    .replace(/^[\s\-–—·.|]+|[\s\-–—·.|]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text || 'Untitled Book';
}

export function sanitizeBookAuthor(raw: string, channelTitle?: string): string {
  if (!raw) return '';
  let text = raw
    .replace(/[\(\[\{«]\s*@[a-zA-Z0-9_]+\s*[\)\]\}»]/gi, ' ')
    .replace(/@[a-zA-Z0-9_]+/g, ' ')
    .replace(/(?:https?:\/\/)?(?:t|telegram)\.me\/[a-zA-Z0-9_\/]+/gi, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const lower = text.toLowerCase();
  for (const phrase of BANNED_CHANNEL_PHRASES) {
    if (lower === phrase.toLowerCase() || text.includes(phrase)) {
      text = text.split(phrase).join('').trim();
    }
  }
  if (channelTitle && text.toLowerCase() === channelTitle.trim().toLowerCase()) {
    return '';
  }
  if (
    !text ||
    text.toLowerCase() === 'unknown author' ||
    text.toLowerCase() === 'unknown writer' ||
    text.startsWith('@')
  ) {
    return '';
  }
  return text.replace(/^[\s\-–—·.|]+|[\s\-–—·.|]+$/g, '').trim();
}

export function extractAuthorFromCaption(caption: string): string {
  if (!caption) return '';
  const patterns = [
    /(?:نویسنده|نویسندگان|اثر|تألیف|تالیف|نگارش)\s*[:：\-]\s*([^\n\r#@|()]+)/i,
    /(?:author|written by|by)\s*[:：]\s*([^\n\r#@|()]+)/i,
  ];
  for (const regex of patterns) {
    const match = caption.match(regex);
    if (match && match[1]) {
      const candidate = sanitizeBookAuthor(match[1]);
      if (candidate && candidate.length >= 2 && candidate.length <= 60) {
        return candidate;
      }
    }
  }
  return '';
}

/**
 * Parses a PDF filename into a clean suggested title and author.
 */
export function cleanPdfFilename(fileName: string, caption = '', channelTitle = ''): { title: string; author: string } {
  const withoutExt = sanitizeBookTitle(fileName.replace(/\.[^/.]+$/, '').trim(), channelTitle);
  const captionAuthor = extractAuthorFromCaption(caption);

  if (withoutExt.includes(' - ')) {
    const parts = withoutExt.split(' - ').map(p => sanitizeBookTitle(p, channelTitle)).filter(Boolean);
    if (parts.length >= 2) {
      return {
        author: sanitizeBookAuthor(parts[0], channelTitle) || captionAuthor,
        title: parts.slice(1).join(' - ').trim(),
      };
    }
  }

  if (withoutExt.includes('_by_')) {
    const [t, a] = withoutExt.split('_by_');
    return {
      title: formatTitleCasing(sanitizeBookTitle(t, channelTitle)),
      author: sanitizeBookAuthor(formatTitleCasing(a), channelTitle) || captionAuthor,
    };
  }

  return {
    title: formatTitleCasing(withoutExt),
    author: captionAuthor,
  };
}

function formatTitleCasing(str: string): string {
  if (!str) return 'Untitled Book';
  // Only apply Latin title-casing to words that start with ASCII letters
  return str
    .split(' ')
    .map(w => {
      if (/^[a-zA-Z]/.test(w)) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }
      return w;
    })
    .join(' ');
}

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'FOLIO-';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function createBooklist(params: {
  title: string;
  description?: string;
  isPublic?: boolean;
  ownerName?: string;
  ownerEmail?: string;
  coverColor?: string;
  coverArtStyle?: 'autumn' | 'coffee' | 'scholar' | 'night' | 'botanical';
}): Booklist {
  const now = new Date().toISOString();
  return {
    id: 'list_' + Math.random().toString(36).substring(2, 9),
    title: params.title.trim() || 'Untitled Playlist',
    description: params.description?.trim() || '',
    isPublic: Boolean(params.isPublic),
    ownerName: params.ownerName || 'You',
    ownerEmail: params.ownerEmail || 'user@folio.local',
    isOwner: true,
    coverColor: params.coverColor || '#27272A',
    coverArtStyle: params.coverArtStyle || 'autumn',
    bookIds: [],
    inviteCode: generateInviteCode(),
    collaborators: [],
    likesCount: 0,
    savesCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function toggleBooklistPrivacy(list: Booklist, isPublic: boolean): Booklist {
  return {
    ...list,
    isPublic,
    updatedAt: new Date().toISOString(),
  };
}

export function addCollaborator(
  list: Booklist,
  collaborator: Omit<Collaborator, 'id' | 'addedAt'>
): Booklist {
  const emailLower = collaborator.email.trim().toLowerCase();
  if (list.collaborators.some(c => c.email.toLowerCase() === emailLower)) {
    return list;
  }

  const newCollab: Collaborator = {
    ...collaborator,
    id: 'collab_' + Math.random().toString(36).substring(2, 9),
    addedAt: new Date().toISOString(),
  };

  return {
    ...list,
    collaborators: [...list.collaborators, newCollab],
    updatedAt: new Date().toISOString(),
  };
}

export function removeCollaborator(list: Booklist, collaboratorId: string): Booklist {
  return {
    ...list,
    collaborators: list.collaborators.filter(c => c.id !== collaboratorId),
    updatedAt: new Date().toISOString(),
  };
}

export function addBookToBooklist(list: Booklist, bookId: string): Booklist {
  if (list.bookIds.includes(bookId)) return list;
  return {
    ...list,
    bookIds: [...list.bookIds, bookId],
    updatedAt: new Date().toISOString(),
  };
}

export function removeBookFromBooklist(list: Booklist, bookId: string): Booklist {
  return {
    ...list,
    bookIds: list.bookIds.filter(id => id !== bookId),
    updatedAt: new Date().toISOString(),
  };
}

export function filterBooks(
  books: Book[],
  query: string,
  activeStatus: ReadingStatus | 'all'
): Book[] {
  const q = query.trim().toLowerCase();

  return books.filter(book => {
    if (activeStatus !== 'all' && book.status !== activeStatus) {
      return false;
    }

    if (!q) return true;

    const inTitle = book.title.toLowerCase().includes(q);
    const inAuthor = book.author.toLowerCase().includes(q);
    const inNotes = book.notes ? book.notes.toLowerCase().includes(q) : false;

    return inTitle || inAuthor || inNotes;
  });
}

export function sortBooks(
  books: Book[],
  sortBy: 'recently-added' | 'title-asc' | 'progress-desc'
): Book[] {
  const copy = [...books];

  if (sortBy === 'title-asc') {
    return copy.sort((a, b) =>
      sanitizeBookTitle(a.title).localeCompare(sanitizeBookTitle(b.title), undefined, {
        sensitivity: 'base',
      })
    );
  }

  if (sortBy === 'progress-desc') {
    return copy.sort((a, b) => {
      const progA = a.pageCount > 0 ? a.currentPage / a.pageCount : 0;
      const progB = b.pageCount > 0 ? b.currentPage / b.pageCount : 0;
      if (progB !== progA) return progB - progA;
      return sanitizeBookTitle(a.title).localeCompare(sanitizeBookTitle(b.title));
    });
  }

  // 'recently-added': sort by dateAdded descending, keeping original insertion order for same-day items
  return copy
    .map((book, idx) => ({ book, idx }))
    .sort((a, b) => {
      const timeA = a.book.dateAdded ? new Date(a.book.dateAdded).getTime() : 0;
      const timeB = b.book.dateAdded ? new Date(b.book.dateAdded).getTime() : 0;
      if (timeB !== timeA) return timeB - timeA;
      return a.idx - b.idx;
    })
    .map(entry => entry.book);
}

export function searchPublicBooklists(lists: Booklist[], query: string): Booklist[] {
  const q = query.trim().toLowerCase();
  
  return lists.filter(list => {
    if (!list.isPublic) return false;
    if (!q) return true;

    const inTitle = list.title.toLowerCase().includes(q);
    const inDesc = list.description.toLowerCase().includes(q);
    const inOwner = list.ownerName.toLowerCase().includes(q);

    return inTitle || inDesc || inOwner;
  });
}

export function calculateReadingStats(books: Book[]): {
  totalBooks: number;
  totalPages: number;
  pagesRead: number;
  completedBooks: number;
  readingBooks: number;
  toReadBooks: number;
  completionRate: number;
  estimatedHoursLeft: number;
} {
  const totalBooks = books.length;
  let totalPages = 0;
  let pagesRead = 0;
  let completedBooks = 0;
  let readingBooks = 0;
  let toReadBooks = 0;

  for (const b of books) {
    totalPages += b.pageCount || 0;
    pagesRead += b.currentPage || 0;
    if (b.status === 'completed') completedBooks++;
    else if (b.status === 'reading') readingBooks++;
    else toReadBooks++;
  }

  const completionRate = totalPages > 0 ? Math.round((pagesRead / totalPages) * 100) : 0;
  const remainingPages = Math.max(0, totalPages - pagesRead);
  const estimatedHoursLeft = Math.round((remainingPages * 1.5) / 60 * 10) / 10;

  return {
    totalBooks,
    totalPages,
    pagesRead,
    completedBooks,
    readingBooks,
    toReadBooks,
    completionRate,
    estimatedHoursLeft,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
