import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
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
import {
  Book,
  BookChapter,
  CoverPattern,
  PageBookmark,
  PageHighlightStroke,
  SpineTexture,
} from '../types/library';
import { getPdfBlob, storePdfBlob, deletePdfBlob } from './db';

export function sanitizeFirestoreId(raw: string): string {
  const cleaned = (raw || 'item')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120);
  return cleaned || 'item_1';
}

const STORAGE_CLOUD_USER_KEY = 'folio_cloud_user_v1';
const STORAGE_DELETED_BOOKS_KEY = 'folio_deleted_book_keys_v1';
const STORAGE_READDED_BOOKS_KEY = 'folio_readded_book_keys_v1';

function normalizeKey(raw?: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

function loadStringSet(storageKey: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(normalizeKey).filter(Boolean));
  } catch {
    return new Set();
  }
}

function saveStringSet(storageKey: string, set: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(Array.from(set)));
  } catch {
    // ignore storage errors
  }
}

export function getDeletedBookKeys(): string[] {
  return Array.from(loadStringSet(STORAGE_DELETED_BOOKS_KEY));
}

export function getReaddedBookKeys(): string[] {
  return Array.from(loadStringSet(STORAGE_READDED_BOOKS_KEY));
}

function extractBookIdentifiers(book: {
  id?: string;
  bookKey?: string;
  title?: string;
  pdfBlobKey?: string;
}): string[] {
  const rawId = book.id || book.bookKey || '';
  const rawTitle = book.title || '';
  const candidates = [
    normalizeKey(rawId),
    normalizeKey(sanitizeFirestoreId(rawId || rawTitle)),
    normalizeKey(rawTitle),
    normalizeKey(sanitizeFirestoreId(rawTitle)),
    normalizeKey(book.pdfBlobKey),
  ];
  return Array.from(new Set(candidates.filter(k => k && k !== 'item' && k !== 'item_1')));
}

export function isBookDeletedLocally(idOrKey?: string, title?: string): boolean {
  const deletedSet = loadStringSet(STORAGE_DELETED_BOOKS_KEY);
  if (deletedSet.size === 0) return false;
  const readdedSet = loadStringSet(STORAGE_READDED_BOOKS_KEY);

  const keys = extractBookIdentifiers({ id: idOrKey, title });
  for (const k of keys) {
    if (readdedSet.has(k)) return false;
  }
  for (const k of keys) {
    if (deletedSet.has(k)) return true;
  }
  return false;
}

export function markBookDeletedLocally(book: {
  id?: string;
  bookKey?: string;
  title?: string;
  pdfBlobKey?: string;
}): string[] {
  const deletedSet = loadStringSet(STORAGE_DELETED_BOOKS_KEY);
  const readdedSet = loadStringSet(STORAGE_READDED_BOOKS_KEY);
  const keys = extractBookIdentifiers(book);
  for (const k of keys) {
    deletedSet.add(k);
    readdedSet.delete(k);
    uploadedPdfBookKeys.delete(k);
  }
  saveStringSet(STORAGE_DELETED_BOOKS_KEY, deletedSet);
  saveStringSet(STORAGE_READDED_BOOKS_KEY, readdedSet);
  return Array.from(deletedSet);
}

export function markBookReaddedLocally(book: {
  id?: string;
  bookKey?: string;
  title?: string;
  pdfBlobKey?: string;
}): void {
  const deletedSet = loadStringSet(STORAGE_DELETED_BOOKS_KEY);
  const readdedSet = loadStringSet(STORAGE_READDED_BOOKS_KEY);
  const keys = extractBookIdentifiers(book);
  for (const k of keys) {
    deletedSet.delete(k);
    readdedSet.add(k);
  }
  saveStringSet(STORAGE_DELETED_BOOKS_KEY, deletedSet);
  saveStringSet(STORAGE_READDED_BOOKS_KEY, readdedSet);
}

export function absorbCloudDeletedBookKeys(cloudDeletedKeys?: string[]): void {
  if (!Array.isArray(cloudDeletedKeys) || cloudDeletedKeys.length === 0) return;
  const deletedSet = loadStringSet(STORAGE_DELETED_BOOKS_KEY);
  const readdedSet = loadStringSet(STORAGE_READDED_BOOKS_KEY);
  let changed = false;
  for (const rawKey of cloudDeletedKeys) {
    const k1 = normalizeKey(rawKey);
    const k2 = normalizeKey(sanitizeFirestoreId(rawKey));
    if (k1 && !readdedSet.has(k1) && !deletedSet.has(k1)) {
      deletedSet.add(k1);
      changed = true;
    }
    if (k2 && !readdedSet.has(k2) && !deletedSet.has(k2)) {
      deletedSet.add(k2);
      changed = true;
    }
  }
  if (changed) {
    saveStringSet(STORAGE_DELETED_BOOKS_KEY, deletedSet);
  }
}

interface FallbackCloudUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  emailVerified: boolean;
}

const authListeners = new Set<(user: User | null) => void>();
let cachedFallbackUserRaw: string | null = null;
let cachedFallbackUserObj: User | null = null;

function loadFallbackCloudUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_CLOUD_USER_KEY);
    if (!raw) {
      cachedFallbackUserRaw = null;
      cachedFallbackUserObj = null;
      return null;
    }
    if (raw === cachedFallbackUserRaw && cachedFallbackUserObj) {
      return cachedFallbackUserObj;
    }
    const parsed = JSON.parse(raw) as FallbackCloudUser;
    if (!parsed || !parsed.email || !parsed.uid) {
      cachedFallbackUserRaw = null;
      cachedFallbackUserObj = null;
      return null;
    }
    cachedFallbackUserRaw = raw;
    cachedFallbackUserObj = {
      uid: parsed.uid,
      email: parsed.email,
      displayName: parsed.displayName || parsed.email.split('@')[0],
      photoURL: parsed.photoURL || '',
      emailVerified: true,
      getIdToken: async () => '',
    } as unknown as User;
    return cachedFallbackUserObj;
  } catch {
    return null;
  }
}

function saveFallbackCloudUser(user: FallbackCloudUser | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!user) {
      cachedFallbackUserRaw = null;
      cachedFallbackUserObj = null;
      localStorage.removeItem(STORAGE_CLOUD_USER_KEY);
    } else {
      localStorage.setItem(STORAGE_CLOUD_USER_KEY, JSON.stringify(user));
      loadFallbackCloudUser();
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

const STORAGE_CUSTOM_DB_URL_KEY = 'folio_custom_db_url_v1';

export function getCustomDatabaseUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (localStorage.getItem(STORAGE_CUSTOM_DB_URL_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function setCustomDatabaseUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = url.trim();
    if (!clean) {
      localStorage.removeItem(STORAGE_CUSTOM_DB_URL_KEY);
    } else {
      localStorage.setItem(STORAGE_CUSTOM_DB_URL_KEY, clean);
    }
  } catch {
    // ignore storage errors
  }
}

export function getActiveCloudUser(): User | null {
  return auth.currentUser || loadFallbackCloudUser();
}

export async function getCloudAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const customDbUrl = getCustomDatabaseUrl();
  if (customDbUrl) {
    headers['x-folio-db-url'] = customDbUrl;
  }

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
  if (isBookDeletedLocally(book.id, book.title)) return;
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

export async function deleteBookFromFirestore(
  user: User | null,
  book: { id?: string; title?: string; bookmarks?: PageBookmark[] }
): Promise<void> {
  if (!auth.currentUser || !user?.uid || !user.emailVerified) return;
  const userId = sanitizeFirestoreId(user.uid);
  const candidateBookIds = Array.from(
    new Set([
      sanitizeFirestoreId(book.id || book.title || ''),
      sanitizeFirestoreId(book.title || ''),
    ])
  ).filter(Boolean);

  for (const safeBookId of candidateBookIds) {
    const progressPath = `users/${userId}/readingProgress/${safeBookId}`;
    const progressRef = doc(db, 'users', userId, 'readingProgress', safeBookId);
    try {
      await deleteDoc(progressRef);
    } catch {
      // ignore if doc does not exist
    }
    for (const bm of book.bookmarks || []) {
      const safeNoteId = sanitizeFirestoreId(`${safeBookId}_p${bm.page}_${bm.id}`);
      const notePath = `users/${userId}/pinnedNotes/${safeNoteId}`;
      const noteRef = doc(db, 'users', userId, 'pinnedNotes', safeNoteId);
      try {
        await deleteDoc(noteRef);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, notePath);
      }
    }
    void progressPath;
  }
}

export async function deleteBookFromCloud(
  user: User | null,
  book: Book,
  remainingBooks: Book[]
): Promise<CloudSqlSyncResponse | null> {
  markBookDeletedLocally(book);
  deleteBookFromFirestore(user, book).catch(() => {});
  const activeUser = user || getActiveCloudUser();
  if (!activeUser) return null;
  try {
    return await syncBooksWithCloudSql(remainingBooks);
  } catch {
    return null;
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
        if (isBookDeletedLocally(data.bookId, data.title)) {
          // Proactively clean up deleted book from Firestore if a stale doc exists
          deleteDoc(docSnap.ref).catch(() => {});
          return;
        }
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
    hasCloudPdf?: boolean;
    pageOffset?: number;
    chapters?: BookChapter[];
    chaptersLocked?: boolean;
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
  deletedBookKeys?: string[];
  storageMode?: 'postgres' | 'ephemeral-tmp';
  sqlError?: string;
}

export async function testCloudDatabaseUrl(
  databaseUrl?: string
): Promise<{ ok: boolean; storageMode?: string; message?: string; error?: string }> {
  try {
    const authHeaders = await getCloudAuthHeaders();
    const res = await fetch('/api/cloudsql/test-db', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        databaseUrl: (databaseUrl ?? getCustomDatabaseUrl()).trim(),
      }),
    });
    const data = await res.json();
    return {
      ok: Boolean(res.ok && data?.ok),
      storageMode: data?.storageMode,
      message: data?.message,
      error: data?.error,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error testing PostgreSQL connection.',
    };
  }
}

const uploadedPdfBookKeys = new Set<string>();
const inFlightPdfUploads = new Set<string>();
const hydratingPdfBookKeys = new Set<string>();

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(sub));
  }
  return btoa(binary);
}

export async function uploadBookPdfToCloud(
  book: Book,
  onProgress?: (percent: number) => void,
  force = false
): Promise<boolean> {
  const currentUser = getActiveCloudUser();
  if (!currentUser) return false;
  if (isBookDeletedLocally(book.id, book.title)) return false;

  const bookKey = sanitizeFirestoreId(book.id || book.title);
  if (!force && uploadedPdfBookKeys.has(bookKey)) return true;
  if (inFlightPdfUploads.has(bookKey)) return false;
  inFlightPdfUploads.add(bookKey);

  try {
    let blob = await getPdfBlob(book.pdfBlobKey || book.id);
    if (!blob && book.id && book.pdfBlobKey !== book.id) {
      blob = await getPdfBlob(book.id);
    }
    if (!blob || blob.size === 0 || blob.size > 50 * 1024 * 1024) {
      return false;
    }
    const buffer = await blob.arrayBuffer();
    const authHeaders = await getCloudAuthHeaders();

    // Split into 1.5 MB raw chunks (~2.0 MB base64 JSON) so EVERY request stays well below Vercel's 4.5 MB limit
    const CHUNK_BYTE_SIZE = Math.floor(1.5 * 1024 * 1024);
    const totalChunks = Math.max(1, Math.ceil(buffer.byteLength / CHUNK_BYTE_SIZE));

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_BYTE_SIZE;
      const end = Math.min(buffer.byteLength, start + CHUNK_BYTE_SIZE);
      const slice = buffer.slice(start, end);
      const pdfBase64 = arrayBufferToBase64(slice);

      const res = await fetch('/api/cloudsql/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          bookKey,
          title: book.title || '',
          chunkIndex,
          totalChunks,
          pdfBase64,
        }),
      });

      if (!res.ok) {
        return false;
      }

      if (onProgress) {
        onProgress(Math.round(((chunkIndex + 1) / totalChunks) * 100));
      }
    }

    uploadedPdfBookKeys.add(bookKey);
    return true;
  } catch {
    // ignore background upload errors
  } finally {
    inFlightPdfUploads.delete(bookKey);
  }
  return false;
}

export async function uploadAllLocalBookPdfsToCloud(
  books: Book[],
  onStatus?: (status: string) => void
): Promise<number> {
  const currentUser = getActiveCloudUser();
  if (!currentUser) return 0;
  let uploadedCount = 0;
  const activeBooks = books.filter(b => !isBookDeletedLocally(b.id, b.title));
  for (const b of activeBooks) {
    let blob = await getPdfBlob(b.pdfBlobKey || b.id);
    if (!blob && b.id && b.pdfBlobKey !== b.id) {
      blob = await getPdfBlob(b.id);
    }
    if (!blob || blob.size < 100) continue;
    if (onStatus) {
      onStatus(`Uploading PDF for "${b.title}" (0%)...`);
    }
    const ok = await uploadBookPdfToCloud(
      b,
      pct => {
        if (onStatus) {
          onStatus(`Uploading PDF for "${b.title}" (${pct}%)...`);
        }
      },
      true
    );
    if (ok) uploadedCount++;
  }
  return uploadedCount;
}

export async function downloadBookPdfFromCloud(
  book: Book,
  onProgress?: (percent: number) => void
): Promise<Blob | null> {
  const currentUser = getActiveCloudUser();
  if (!currentUser) return null;
  if (isBookDeletedLocally(book.id, book.title)) return null;

  const candidateKeys = Array.from(
    new Set([
      sanitizeFirestoreId(book.id || book.title),
      book.id,
      book.pdfBlobKey || '',
      sanitizeFirestoreId(book.title),
    ])
  ).filter(Boolean);

  try {
    const authHeaders = await getCloudAuthHeaders();
    const titleParam = encodeURIComponent(book.title || '');

    for (const key of candidateKeys) {
      // 1. Ask server for chunk metadata (avoids Vercel's 4.5 MB single-response body limit!)
      const metaRes = await fetch(
        `/api/cloudsql/pdf?bookKey=${encodeURIComponent(key)}&title=${titleParam}&mode=meta`,
        {
          headers: {
            ...authHeaders,
          },
        }
      );

      if (!metaRes.ok) {
        continue;
      }

      const meta = (await metaRes.json()) as {
        found?: boolean;
        matchedBookKey?: string;
        totalChunks?: number;
      };
      if (!meta?.found || !meta.totalChunks || meta.totalChunks < 1) {
        continue;
      }

      const resolvedKey = meta.matchedBookKey || key;
      const totalChunks = meta.totalChunks;
      const chunkBuffers: Array<ArrayBuffer | null> = new Array(totalChunks).fill(null);
      let completedChunks = 0;
      let failed = false;
      let nextChunkIdx = 0;

      const workerCount = Math.min(3, totalChunks);
      const workers = Array.from({ length: workerCount }, async () => {
        while (!failed) {
          const idx = nextChunkIdx++;
          if (idx >= totalChunks) break;
          const partRes = await fetch(
            `/api/cloudsql/pdf?bookKey=${encodeURIComponent(resolvedKey)}&title=${titleParam}&chunkIndex=${idx}`,
            {
              headers: {
                ...authHeaders,
              },
            }
          );
          if (!partRes.ok) {
            failed = true;
            return;
          }
          const buf = await partRes.arrayBuffer();
          if (buf.byteLength === 0) {
            failed = true;
            return;
          }
          chunkBuffers[idx] = buf;
          completedChunks++;
          if (onProgress) {
            onProgress(Math.round((completedChunks / totalChunks) * 100));
          }
        }
      });

      await Promise.all(workers);

      if (!failed && chunkBuffers.every(b => b !== null)) {
        const fullBlob = new Blob(chunkBuffers as ArrayBuffer[], { type: 'application/pdf' });
        if (fullBlob.size > 100) {
          return fullBlob;
        }
      }
    }
  } catch {
    // ignore download errors
  }
  return null;
}

export async function ensureCloudPdfHydratedLocally(book: Book): Promise<void> {
  const currentUser = getActiveCloudUser();
  if (!currentUser || isBookDeletedLocally(book.id, book.title)) return;
  const key = book.pdfBlobKey || book.id;
  if (!key || hydratingPdfBookKeys.has(key)) return;
  hydratingPdfBookKeys.add(key);
  try {
    const existing = await getPdfBlob(key);
    if (existing && existing.size > 100) return;
    const downloaded = await downloadBookPdfFromCloud(book);
    if (downloaded && downloaded.size > 100) {
      await storePdfBlob(key, downloaded);
      if (book.id !== key) {
        await storePdfBlob(book.id, downloaded);
      }
    }
  } catch {
    // ignore background hydration errors
  } finally {
    hydratingPdfBookKeys.delete(key);
  }
}

export function mergeCloudLibraryIntoLocalBooks(
  localBooks: Book[],
  cloudData: CloudSqlSyncResponse
): Book[] {
  if (cloudData?.deletedBookKeys && cloudData.deletedBookKeys.length > 0) {
    absorbCloudDeletedBookKeys(cloudData.deletedBookKeys);
  }

  // Always strip any book that was deleted locally or on another device
  const survivingLocalBooks = localBooks.filter(lb => {
    if (isBookDeletedLocally(lb.id, lb.title)) {
      if (lb.pdfBlobKey) deletePdfBlob(lb.pdfBlobKey).catch(() => {});
      deletePdfBlob(lb.id).catch(() => {});
      return false;
    }
    return true;
  });

  if (!cloudData || !Array.isArray(cloudData.books) || cloudData.books.length === 0) {
    return survivingLocalBooks;
  }

  // Group cloud notes by bookKey and lowercase title so any note is also restored as a bookmark
  const notesByBookKey = new Map<string, PageBookmark[]>();
  for (const n of cloudData.notes || []) {
    if (isBookDeletedLocally(n.bookKey, n.bookTitle)) continue;
    const key = (n.bookKey || '').toLowerCase();
    const list = notesByBookKey.get(key) || [];
    list.push({
      id: n.noteKey || `bm_${n.page}`,
      page: Number(n.page) || 1,
      note: n.noteText || '',
      createdAt: n.createdAt || new Date().toISOString(),
    });
    notesByBookKey.set(key, list);
  }

  const result: Book[] = [...survivingLocalBooks];
  const matchedLocalIndices = new Set<number>();

  for (const cb of cloudData.books) {
    if (isBookDeletedLocally(cb.bookKey, cb.title)) {
      continue;
    }

    const cbKeyLower = (cb.bookKey || '').toLowerCase();
    const cbTitleLower = (cb.title || '').trim().toLowerCase();

    // Combine bookmarks from cb.bookmarks and cloudData.notes
    const bmByPage = new Map<number, PageBookmark>();
    for (const nBm of notesByBookKey.get(cbKeyLower) || []) {
      bmByPage.set(nBm.page, nBm);
    }
    for (const cBm of cb.bookmarks || []) {
      if (cBm && typeof cBm.page === 'number') {
        bmByPage.set(cBm.page, cBm);
      }
    }

    const existingIdx = result.findIndex((lb, idx) => {
      if (matchedLocalIndices.has(idx)) return false;
      const lbSafeKey = sanitizeFirestoreId(lb.id || lb.title).toLowerCase();
      const lbIdLower = (lb.id || '').toLowerCase();
      const lbTitleLower = (lb.title || '').trim().toLowerCase();
      return (
        lbSafeKey === cbKeyLower ||
        lbIdLower === cbKeyLower ||
        (cbTitleLower.length > 0 && lbTitleLower === cbTitleLower)
      );
    });

    if (existingIdx >= 0) {
      matchedLocalIndices.add(existingIdx);
      const lb = result[existingIdx];

      for (const localBm of lb.bookmarks || []) {
        if (localBm && typeof localBm.page === 'number') {
          const existingCloudBm = bmByPage.get(localBm.page);
          if (!existingCloudBm || (localBm.note && !existingCloudBm.note)) {
            bmByPage.set(localBm.page, localBm);
          }
        }
      }
      const mergedBookmarks = Array.from(bmByPage.values()).sort((a, b) => a.page - b.page);

      const mergedHighlights: Record<number, PageHighlightStroke[]> = {
        ...(cb.highlights || {}),
        ...(lb.highlights || {}),
      };

      const mergedTotalPages = Math.max(lb.pageCount || 1, cb.totalPages || 1);
      const mergedCurrentPage = Math.max(lb.currentPage || 1, cb.currentPage || 1);

      const mergedBook: Book = {
        ...lb,
        currentPage: mergedCurrentPage,
        pageCount: mergedTotalPages,
        status:
          mergedCurrentPage >= mergedTotalPages && mergedTotalPages > 1
            ? 'completed'
            : 'reading',
        coverImage: lb.coverImage || cb.coverImage,
        telegramChannel: lb.telegramChannel || cb.telegramChannel,
        telegramMessageId: lb.telegramMessageId || cb.telegramMessageId,
        bookmarks: mergedBookmarks,
        highlights: mergedHighlights,
        pageOffset:
          typeof lb.pageOffset === 'number'
            ? lb.pageOffset
            : typeof cb.pageOffset === 'number'
            ? cb.pageOffset
            : undefined,
        chapters:
          Array.isArray(lb.chapters) && lb.chapters.length > 0 ? lb.chapters : cb.chapters,
        chaptersLocked:
          typeof lb.chaptersLocked === 'boolean' ? lb.chaptersLocked : cb.chaptersLocked,
      };
      result[existingIdx] = mergedBook;
      ensureCloudPdfHydratedLocally(mergedBook).catch(() => {});
    } else {
      // Book was synced from another device (e.g., imported on iPad and opened on PC) — add it to library!
      const mergedBookmarks = Array.from(bmByPage.values()).sort((a, b) => a.page - b.page);
      const totalPages = Math.max(1, cb.totalPages || 1);
      const currentPage = Math.max(1, cb.currentPage || 1);
      const dateStr = (cb.updatedAt || new Date().toISOString()).split('T')[0];

      const newCloudBook: Book = {
        id: cb.bookKey,
        title: cb.title || 'Untitled Book',
        author: cb.author || 'Unknown Author',
        fileName: cb.fileName || `${cb.title || 'book'}.pdf`,
        fileSize: cb.fileSize || 0,
        pageCount: totalPages,
        currentPage,
        status: currentPage >= totalPages && totalPages > 1 ? 'completed' : 'reading',
        spineColor: cb.spineColor || '#4A3525',
        spineTexture: cb.spineTexture || 'linen',
        coverPattern: cb.coverPattern || 'minimal',
        coverImage: cb.coverImage,
        dateAdded: dateStr,
        lastRead: dateStr,
        pdfBlobKey: cb.bookKey,
        telegramChannel: cb.telegramChannel,
        telegramMessageId: cb.telegramMessageId,
        bookmarks: mergedBookmarks,
        highlights: cb.highlights || {},
        pageOffset: cb.pageOffset,
        chapters: cb.chapters,
        chaptersLocked: cb.chaptersLocked,
      };
      result.push(newCloudBook);
      ensureCloudPdfHydratedLocally(newCloudBook).catch(() => {});
    }
  }

  return result;
}

export async function syncBooksWithCloudSql(books: Book[]): Promise<CloudSqlSyncResponse> {
  const currentUser = getActiveCloudUser();
  if (!currentUser) {
    throw new Error('Sign in with Google first to sync with Cloud.');
  }
  const authHeaders = await getCloudAuthHeaders();

  const activeBooks = books.filter(b => !isBookDeletedLocally(b.id, b.title));
  const deletedBookKeys = getDeletedBookKeys();
  const readdedBookKeys = getReaddedBookKeys();

  const booksPayload = activeBooks.map(b => ({
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
    fileName: b.fileName,
    fileSize: b.fileSize,
    spineColor: b.spineColor,
    spineTexture: b.spineTexture,
    coverPattern: b.coverPattern,
    coverImage: b.coverImage,
    telegramChannel: b.telegramChannel,
    telegramMessageId: b.telegramMessageId,
    bookmarks: b.bookmarks || [],
    highlights: b.highlights || {},
    pageOffset: b.pageOffset,
    chapters: b.chapters,
    chaptersLocked: b.chaptersLocked,
  }));

  const notesPayload = activeBooks.flatMap(b =>
    (b.bookmarks || []).map(bm => ({
      noteKey: sanitizeFirestoreId(`${b.id}_${bm.id}`),
      bookKey: sanitizeFirestoreId(b.id || b.title),
      bookTitle: (b.title || 'Untitled').slice(0, 200),
      page: bm.page || 1,
      noteText: (bm.note || `Pinned Page ${bm.page}`).slice(0, 2000),
    }))
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch('/api/cloudsql/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        displayName: currentUser.displayName || 'Reader',
        books: booksPayload,
        notes: notesPayload,
        deletedBookKeys,
        readdedBookKeys,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const data = (await res.json()) as CloudSqlSyncResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to sync with Cloud');
  }

  if (data.deletedBookKeys && data.deletedBookKeys.length > 0) {
    absorbCloudDeletedBookKeys(data.deletedBookKeys);
  }

  // Clear one-time readdedBookKeys once acknowledged by server
  if (readdedBookKeys.length > 0) {
    saveStringSet(STORAGE_READDED_BOOKS_KEY, new Set());
  }

  // Trigger background upload of local PDF blobs so other devices can open the PDF
  const cloudPdfStatusByKey = new Map<string, boolean>();
  for (const cb of data.books || []) {
    cloudPdfStatusByKey.set((cb.bookKey || '').toLowerCase(), Boolean(cb.hasCloudPdf));
    if (cb.title) {
      cloudPdfStatusByKey.set(cb.title.trim().toLowerCase(), Boolean(cb.hasCloudPdf));
    }
  }

  for (const b of activeBooks.slice(0, 15)) {
    const safeKey = sanitizeFirestoreId(b.id || b.title).toLowerCase();
    const titleLower = (b.title || '').trim().toLowerCase();
    const cloudHasIt =
      cloudPdfStatusByKey.get(safeKey) || cloudPdfStatusByKey.get(titleLower) || false;
    if (cloudHasIt) {
      uploadedPdfBookKeys.add(sanitizeFirestoreId(b.id || b.title));
      continue;
    }
    uploadBookPdfToCloud(b, undefined, true).catch(() => {});
  }

  return data;
}

export async function fetchCloudSqlLibrary(): Promise<CloudSqlSyncResponse> {
  const currentUser = getActiveCloudUser();
  if (!currentUser) {
    throw new Error('Sign in with Google first.');
  }
  const authHeaders = await getCloudAuthHeaders();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch('/api/cloudsql/library', {
      headers: {
        ...authHeaders,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  const data = (await res.json()) as CloudSqlSyncResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch Cloud library');
  }
  if (data.deletedBookKeys && data.deletedBookKeys.length > 0) {
    absorbCloudDeletedBookKeys(data.deletedBookKeys);
  }
  return data;
}

