import { SavedVocabularyItem } from '../types/library';
import { auth } from '../lib/firebase';

const STORAGE_VOCABULARY_KEY = 'folio_vocabulary_v1';
const VOCABULARY_EVENT_NAME = 'folio-vocabulary-updated';

export function loadSavedVocabulary(): SavedVocabularyItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_VOCABULARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveVocabularyList(items: SavedVocabularyItem[]): void {
  try {
    localStorage.setItem(STORAGE_VOCABULARY_KEY, JSON.stringify(items));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(VOCABULARY_EVENT_NAME));
    }
  } catch {
    // ignore storage quota errors
  }
}

export function upsertVocabularyItem(
  entry: Omit<SavedVocabularyItem, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
  syncToCloud = true
): SavedVocabularyItem[] {
  const existing = loadSavedVocabulary();
  const cleanWord = entry.word.trim();
  if (!cleanWord) return existing;

  const wordKey = cleanWord.toLowerCase();
  const bookKey = (entry.bookTitle || '').trim().toLowerCase();

  const matchIdx = existing.findIndex(
    item =>
      item.word.trim().toLowerCase() === wordKey &&
      (item.bookTitle || '').trim().toLowerCase() === bookKey
  );

  const newItem: SavedVocabularyItem = {
    id:
      entry.id ||
      (matchIdx >= 0
        ? existing[matchIdx].id
        : `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
    word: cleanWord,
    pronunciation: entry.pronunciation || (matchIdx >= 0 ? existing[matchIdx].pronunciation : ''),
    partOfSpeech: entry.partOfSpeech || (matchIdx >= 0 ? existing[matchIdx].partOfSpeech : ''),
    persianMeaning: entry.persianMeaning || (matchIdx >= 0 ? existing[matchIdx].persianMeaning : ''),
    englishMeaning: entry.englishMeaning || (matchIdx >= 0 ? existing[matchIdx].englishMeaning : ''),
    contextExplanation:
      entry.contextExplanation || (matchIdx >= 0 ? existing[matchIdx].contextExplanation : ''),
    bookId: entry.bookId || (matchIdx >= 0 ? existing[matchIdx].bookId : undefined),
    bookTitle: entry.bookTitle || (matchIdx >= 0 ? existing[matchIdx].bookTitle : 'General Reading'),
    page: entry.page || (matchIdx >= 0 ? existing[matchIdx].page : 1),
    createdAt:
      entry.createdAt ||
      (matchIdx >= 0 ? existing[matchIdx].createdAt : new Date().toISOString()),
  };

  let nextList: SavedVocabularyItem[];
  if (matchIdx >= 0) {
    nextList = [
      newItem,
      ...existing.filter((_, idx) => idx !== matchIdx),
    ];
  } else {
    nextList = [newItem, ...existing];
  }

  saveVocabularyList(nextList);

  if (syncToCloud && auth.currentUser) {
    auth.currentUser
      .getIdToken()
      .then(token =>
        fetch('/api/cloudsql/vocabulary', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            word: newItem.word,
            partOfSpeech: newItem.partOfSpeech,
            persianMeaning: newItem.persianMeaning,
            englishMeaning: newItem.englishMeaning,
            contextExplanation: newItem.contextExplanation,
            bookTitle: newItem.bookTitle,
            page: newItem.page,
          }),
        })
      )
      .catch(() => {});
  }

  return nextList;
}

export function deleteVocabularyItem(id: string): SavedVocabularyItem[] {
  const existing = loadSavedVocabulary();
  const nextList = existing.filter(item => item.id !== id);
  saveVocabularyList(nextList);
  return nextList;
}

export function mergeCloudVocabularyIntoLocal(
  cloudItems: Array<{
    id?: number | string;
    word: string;
    partOfSpeech: string;
    persianMeaning: string;
    englishMeaning: string;
    contextExplanation: string;
    bookTitle: string;
    page: number;
    createdAt?: string;
  }>
): SavedVocabularyItem[] {
  const local = loadSavedVocabulary();
  if (!Array.isArray(cloudItems) || cloudItems.length === 0) return local;

  const map = new Map<string, SavedVocabularyItem>();
  for (const item of local) {
    const key = `${item.word.trim().toLowerCase()}__${(item.bookTitle || '').trim().toLowerCase()}`;
    map.set(key, item);
  }

  for (const c of cloudItems) {
    if (!c.word) continue;
    const key = `${c.word.trim().toLowerCase()}__${(c.bookTitle || '').trim().toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, {
        id: `cloud_vocab_${c.id || Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        word: c.word,
        partOfSpeech: c.partOfSpeech || '',
        persianMeaning: c.persianMeaning || '',
        englishMeaning: c.englishMeaning || '',
        contextExplanation: c.contextExplanation || '',
        bookTitle: c.bookTitle || 'General Reading',
        page: c.page || 1,
        createdAt: c.createdAt || new Date().toISOString(),
      });
    }
  }

  const merged = Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  saveVocabularyList(merged);
  return merged;
}

export function subscribeToVocabularyUpdates(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(VOCABULARY_EVENT_NAME, callback);
  return () => window.removeEventListener(VOCABULARY_EVENT_NAME, callback);
}
