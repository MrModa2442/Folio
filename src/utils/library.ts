import { Book, Booklist, Collaborator, ReadingStatus } from '../types/library';

/**
 * Parses a PDF filename into a clean suggested title and author.
 */
export function cleanPdfFilename(fileName: string): { title: string; author: string } {
  const withoutExt = fileName.replace(/\.[^/.]+$/, '').trim();
  
  if (withoutExt.includes(' - ')) {
    const parts = withoutExt.split(' - ');
    if (parts.length >= 2) {
      return {
        author: parts[0].trim(),
        title: parts.slice(1).join(' - ').trim(),
      };
    }
  }

  if (withoutExt.includes('_by_')) {
    const [t, a] = withoutExt.split('_by_');
    return {
      title: formatTitleCasing(t.replace(/_/g, ' ')),
      author: formatTitleCasing(a.replace(/_/g, ' ')),
    };
  }

  const clean = withoutExt
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: formatTitleCasing(clean),
    author: 'Unknown Author',
  };
}

function formatTitleCasing(str: string): string {
  if (!str) return 'Untitled Document';
  return str
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
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
