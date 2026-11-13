import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { Book } from '../types/library';

export function sanitizeFirestoreId(raw: string): string {
  const cleaned = (raw || 'item')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120);
  return cleaned || 'item_1';
}

const STORAGE_CLOUD_USER_KEY = 'folio_cloud_user_v1';

interface FallbackCloudUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  emailVerified: boolean;
}

const authListeners = new Set<(user: User | null) => void>();

function loadFallbackCloudUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_CLOUD_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FallbackCloudUser;
    if (!parsed || !parsed.email || !parsed.uid) return null;
    return {
      uid: parsed.uid,
      email: parsed.email,
      displayName: parsed.displayName || parsed.email.split('@')[0],
      photoURL: parsed.photoURL || '',
      emailVerified: true,
      getIdToken: async () => '',
    } as unknown as User;
  } catch {
    return null;
  }
}

function saveFallbackCloudUser(user: FallbackCloudUser | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!user) {
      localStorage.removeItem(STORAGE_CLOUD_USER_KEY);
    } else {
      localStorage.setItem(STORAGE_CLOUD_USER_KEY, JSON.stringify(user));
    }
  } catch {
    // ignore storage errors
  }
}

function notifyAuthListeners(): void {
  const effectiveUser = auth.currentUser || loadFallbackCloudUser();
  authListeners.forEach(listener => {
    try {
      listener(effectiveUser);
    } catch {
      // ignore listener error
    }
  });
}

export function getActiveCloudUser(): User | null {
  return auth.currentUser || loadFallbackCloudUser();
}

export async function getCloudAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }
    } catch {
      // fallback to email/uid headers below
    }
    if (auth.currentUser.email) {
      headers['x-folio-user-email'] = auth.currentUser.email;
    }
    if (auth.currentUser.uid) {
      headers['x-folio-user-uid'] = auth.currentUser.uid;
    }
    if (auth.currentUser.displayName) {
      headers['x-folio-user-name'] = auth.currentUser.displayName;
    }
    return headers;
  }

  const fallback = loadFallbackCloudUser();
  if (fallback) {
    if (fallback.email) headers['x-folio-user-email'] = fallback.email;
    if (fallback.uid) headers['x-folio-user-uid'] = fallback.uid;
    if (fallback.displayName) headers['x-folio-user-name'] = fallback.displayName;
  }
  return headers;
}

export function signInWithDirectGoogleEmail(rawEmail: string, rawDisplayName?: string): User {
  const cleanEmail = rawEmail.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Please enter a valid Google email address.');
  }
  const localPart = cleanEmail.split('@')[0] || 'Reader';
  const displayName =
    (rawDisplayName || localPart.replace(/[._-]+/g, ' '))
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || 'Reader';
  const uid = 'google_' + cleanEmail.replace(/[^a-z0-9]/g, '_').slice(0, 64);

  const fallbackObj: FallbackCloudUser = {
    uid,
    email: cleanEmail,
    displayName,
    photoURL: '',
    emailVerified: true,
  };
  saveFallbackCloudUser(fallbackObj);
  notifyAuthListeners();
  return loadFallbackCloudUser()!;
}

export async function signInWithGooglePopup(fallbackEmail?: string): Promise<User> {
  try {
    const cred = await signInWithPopup(auth, googleAuthProvider);
    if (cred.user?.email) {
      saveFallbackCloudUser({
        uid: cred.user.uid,
        email: cred.user.email.toLowerCase(),
        displayName: cred.user.displayName || cred.user.email.split('@')[0],
        photoURL: cred.user.photoURL || '',
        emailVerified: true,
      });
    }
    await ensureFirestoreUserProfile(cred.user);
    notifyAuthListeners();
    return cred.user;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    const msg = err instanceof Error ? err.message : String(err);
    const isNetworkOrDomainBlock =
      code.includes('network-request-failed') ||
      code.includes('unauthorized-domain') ||
      code.includes('popup-blocked') ||
      code.includes('popup-closed-by-user') ||
      code.includes('operation-not-supported') ||
      code.includes('internal-error') ||
      msg.includes('network-request-failed') ||
      msg.includes('unauthorized-domain');

    if (isNetworkOrDomainBlock) {
      const candidateEmail = (fallbackEmail || '').trim();
      if (candidateEmail && candidateEmail.includes('@')) {
        return signInWithDirectGoogleEmail(candidateEmail);
      }
      const existing = loadFallbackCloudUser();
      if (existing) {
        notifyAuthListeners();
        return existing;
      }
      const friendlyError = new Error(
        'Direct Google popup was blocked by your VPN, Safari ITP, or domain filter. Enter your Google email below to sign in directly.'
      );
      (friendlyError as { code?: string }).code = 'DIRECT_EMAIL_NEEDED';
      throw friendlyError;
    }
    throw err;
  }
}

export async function signOutFromFolio(): Promise<void> {
  saveFallbackCloudUser(null);
  try {
    await signOut(auth);
  } catch {
    // ignore signOut network errors
  }
  notifyAuthListeners();
}

export function subscribeToAuthChanges(callback: (user: User | null) => void): Unsubscribe {
  authListeners.add(callback);
  const initialFallback = loadFallbackCloudUser();
  if (initialFallback && !auth.currentUser) {
    callback(initialFallback);
  }
  const unsubFirebase = onAuthStateChanged(auth, firebaseUser => {
    if (firebaseUser) {
      callback(firebaseUser);
    } else {
      callback(loadFallbackCloudUser());
    }
  });
  return () => {
    authListeners.delete(callback);
    unsubFirebase();
  };
}

export async function ensureFirestoreUserProfile(user: User): Promise<void> {
  if (!auth.currentUser || !user?.uid || !user.emailVerified) return;
  const userId = sanitizeFirestoreId(user.uid);
  const path = `users/${userId}`;
  const userRef = doc(db, 'users', userId);

  const displayName = (user.displayName || user.email?.split('@')[0] || 'Reader').slice(0, 100);
  const photoURL = (user.photoURL || '').slice(0, 500);

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: userId,
        displayName,
        photoURL,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = snap.data();
      await setDoc(userRef, {
        uid: userId,
        displayName,
        photoURL,
        createdAt: existingData.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncBookToFirestore(user: User, book: Book): Promise<void> {
  if (!auth.currentUser || !user?.uid || !user.emailVerified) return;
  const userId = sanitizeFirestoreId(user.uid);
  await ensureFirestoreUserProfile(user);

  const safeBookId = sanitizeFirestoreId(book.id || book.title);
  const progressPath = `users/${userId}/readingProgress/${safeBookId}`;
  const progressRef = doc(db, 'users', userId, 'readingProgress', safeBookId);

  const title = (book.title || 'Untitled Book').slice(0, 200);
  const author = (book.author || 'Unknown Author').slice(0, 200);
  const currentPage = Math.max(1, Math.min(50000, Math.round(book.currentPage || 1)));
  const totalPages = Math.max(1, Math.min(50000, Math.round(book.pageCount || 1)));
  const bookmarkCount = Math.max(0, Math.min(10000, book.bookmarks?.length || 0));
  const highlightCount = Math.max(
    0,
    Math.min(
      50000,
      Object.values(book.highlights || {}).filter(arr => Array.isArray(arr) && arr.length > 0)
        .length
    )
  );

  try {
    const snap = await getDoc(progressRef);
    if (!snap.exists()) {
      await setDoc(progressRef, {
        uid: userId,
        bookId: safeBookId,
        title,
        author,
        currentPage,
        totalPages,
        bookmarkCount,
        highlightCount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = snap.data();
      await setDoc(progressRef, {
        uid: userId,
        bookId: safeBookId,
        title,
        author,
        currentPage,
        totalPages,
        bookmarkCount,
        highlightCount,
        createdAt: existingData.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, progressPath);
  }

  // Also sync pinned bookmarks/notes to /users/{userId}/pinnedNotes/{noteId}
  for (const bm of (book.bookmarks || []).slice(0, 50)) {
    const safeNoteId = sanitizeFirestoreId(`${safeBookId}_p${bm.page}_${bm.id}`);
    const notePath = `users/${userId}/pinnedNotes/${safeNoteId}`;
    const noteRef = doc(db, 'users', userId, 'pinnedNotes', safeNoteId);
    const page = Math.max(1, Math.min(50000, Math.round(bm.page || 1)));
    const note = (bm.note || '').slice(0, 2000);

    try {
      const noteSnap = await getDoc(noteRef);
      if (!noteSnap.exists()) {
        await setDoc(noteRef, {
          uid: userId,
          noteId: safeNoteId,
          bookId: safeBookId,
          bookTitle: title,
          page,
          note,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const existingNote = noteSnap.data();
        await setDoc(noteRef, {
          uid: userId,
          noteId: safeNoteId,
          bookId: safeBookId,
          bookTitle: title,
          page,
          note,
          createdAt: existingNote.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, notePath);
    }
  }
}

export interface FirestoreReadingProgressDoc {
  uid: string;
  bookId: string;
  title: string;
  author: string;
  currentPage: number;
  totalPages: number;
  bookmarkCount: number;
  highlightCount: number;
}

export function subscribeToFirestoreReadingProgress(
  user: User,
  onUpdate: (docs: FirestoreReadingProgressDoc[]) => void
): Unsubscribe {
  if (!auth.currentUser || !user?.uid || !user.emailVerified) {
    return () => {};
  }
  const userId = sanitizeFirestoreId(user.uid);
  const path = `users/${userId}/readingProgress`;
  const q = query(collection(db, 'users', userId, 'readingProgress'), where('uid', '==', userId));

  return onSnapshot(
    q,
    snapshot => {
      const items: FirestoreReadingProgressDoc[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data() as FirestoreReadingProgressDoc;
        items.push(data);
      });
      onUpdate(items);
    },
    error => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export interface CloudSqlSyncResponse {
  user?: {
    id: number;
    uid: string;
    email: string;
    displayName: string;
  };
  books: Array<{
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
  }>;
  notes: Array<{
    id: number;
    noteKey: string;
    bookKey: string;
    bookTitle: string;
    page: number;
    noteText: string;
    createdAt: string;
  }>;
  vocabulary: Array<{
    id: number;
    word: string;
    partOfSpeech: string;
    persianMeaning: string;
    englishMeaning: string;
    contextExplanation: string;
    bookTitle: string;
    page: number;
    createdAt: string;
  }>;
}

export async function syncBooksWithCloudSql(books: Book[]): Promise<CloudSqlSyncResponse> {
  const currentUser = getActiveCloudUser();
  if (!currentUser) {
    throw new Error('Sign in with Google first to sync with Cloud.');
  }
  const authHeaders = await getCloudAuthHeaders();

  const booksPayload = books.map(b => ({
    bookKey: sanitizeFirestoreId(b.id || b.title),
    title: (b.title || 'Untitled').slice(0, 200),
    author: (b.author || 'Unknown').slice(0, 200),
    category: (b.status || 'reading').slice(0, 100),
    currentPage: Math.max(1, b.currentPage || 1),
    totalPages: Math.max(1, b.pageCount || 1),
    bookmarkCount: b.bookmarks?.length || 0,
    highlightCount: Object.values(b.highlights || {}).filter(
      arr => Array.isArray(arr) && arr.length > 0
    ).length,
  }));

  const notesPayload = books.flatMap(b =>
    (b.bookmarks || []).map(bm => ({
      noteKey: sanitizeFirestoreId(`${b.id}_${bm.id}`),
      bookKey: sanitizeFirestoreId(b.id || b.title),
      bookTitle: (b.title || 'Untitled').slice(0, 200),
      page: bm.page || 1,
      noteText: (bm.note || `Pinned Page ${bm.page}`).slice(0, 2000),
    }))
  );

  const res = await fetch('/api/cloudsql/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      displayName: currentUser.displayName || 'Reader',
      books: booksPayload,
      notes: notesPayload,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to sync with Cloud');
  }
  return data as CloudSqlSyncResponse;
}

export async function fetchCloudSqlLibrary(): Promise<CloudSqlSyncResponse> {
  const currentUser = getActiveCloudUser();
  if (!currentUser) {
    throw new Error('Sign in with Google first.');
  }
  const authHeaders = await getCloudAuthHeaders();
  const res = await fetch('/api/cloudsql/library', {
    headers: {
      ...authHeaders,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch Cloud library');
  }
  return data as CloudSqlSyncResponse;
}

