import * as pdfjsLib from 'pdfjs-dist';
import { createWorker, Worker as TesseractWorker } from 'tesseract.js';
import { Book } from '../types/library';
import { getPdfBlob } from './db';

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

const DB_NAME = 'folio_ocr_index_db';
const DB_VERSION = 1;
const STORE_NAME = 'book_ocr_pages';
const OCR_UPDATED_EVENT = 'folio-ocr-updated';
const CHAPTERS_UPDATED_EVENT = 'folio-chapters-updated';
const CHAPTERS_STORAGE_PREFIX = 'folio_book_chapters_v1_';

export interface StoredBookOcr {
  docKey: string;
  pages: Record<number, string[]>;
  updatedAt: string;
}

export interface SmartBookChapter {
  id: string;
  title: string;
  page: number;
  startPage: number;
  endPage: number;
  level: number;
}

export interface OcrUpdateEventDetail {
  docKey: string;
  scannedCount: number;
  totalPages?: number;
  newPages: Array<{ page: number; lines: string[] }>;
}

export interface ChaptersUpdateEventDetail {
  docKey: string;
  chapters: SmartBookChapter[];
}

export function loadCachedBookChapters(docKey: string): SmartBookChapter[] {
  if (!docKey || typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${CHAPTERS_STORAGE_PREFIX}${docKey}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCachedBookChapters(
  docKey: string,
  chapters: SmartBookChapter[]
): void {
  if (!docKey || typeof window === 'undefined' || !Array.isArray(chapters) || chapters.length === 0) {
    return;
  }
  try {
    localStorage.setItem(`${CHAPTERS_STORAGE_PREFIX}${docKey}`, JSON.stringify(chapters));
    window.dispatchEvent(
      new CustomEvent<ChaptersUpdateEventDetail>(CHAPTERS_UPDATED_EVENT, {
        detail: { docKey, chapters },
      })
    );
  } catch {
    // ignore storage errors
  }
}

export function subscribeToChapterUpdates(
  callback: (detail: ChaptersUpdateEventDetail) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const custom = e as CustomEvent<ChaptersUpdateEventDetail>;
    if (custom.detail) {
      callback(custom.detail);
    }
  };
  window.addEventListener(CHAPTERS_UPDATED_EVENT, handler);
  return () => window.removeEventListener(CHAPTERS_UPDATED_EVENT, handler);
}

function openOcrDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'docKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadCachedOcrPages(docKey: string): Promise<Record<number, string[]>> {
  if (!docKey || typeof indexedDB === 'undefined') return {};
  try {
    const db = await openOcrDb();
    return await new Promise<Record<number, string[]>>(resolve => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(docKey);
      req.onsuccess = () => {
        const record = req.result as StoredBookOcr | undefined;
        resolve(record?.pages || {});
      };
      req.onerror = () => resolve({});
    });
  } catch {
    return {};
  }
}

export async function saveCachedOcrPages(
  docKey: string,
  newPages: Array<{ page: number; lines: string[] }>,
  totalPages?: number
): Promise<Record<number, string[]>> {
  if (!docKey || typeof indexedDB === 'undefined') return {};
  try {
    const existing = await loadCachedOcrPages(docKey);
    const merged: Record<number, string[]> = { ...existing };
    for (const item of newPages) {
      merged[item.page] = item.lines;
    }

    const db = await openOcrDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({
        docKey,
        pages: merged,
        updatedAt: new Date().toISOString(),
      } satisfies StoredBookOcr);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<OcrUpdateEventDetail>(OCR_UPDATED_EVENT, {
          detail: {
            docKey,
            scannedCount: Object.keys(merged).length,
            totalPages,
            newPages,
          },
        })
      );
    }

    return merged;
  } catch {
    return {};
  }
}

export function subscribeToOcrUpdates(
  callback: (detail: OcrUpdateEventDetail) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const custom = e as CustomEvent<OcrUpdateEventDetail>;
    if (custom.detail) {
      callback(custom.detail);
    }
  };
  window.addEventListener(OCR_UPDATED_EVENT, handler);
  return () => window.removeEventListener(OCR_UPDATED_EVENT, handler);
}

// ============================================================================
// Background Book Word & Page Indexer (runs automatically when books are added)
// ============================================================================

const backgroundQueue: Book[] = [];
const queuedBookIds = new Set<string>();
const completedBookIds = new Set<string>();
let isBackgroundWorkerRunning = false;
let sharedTesseractPromise: Promise<TesseractWorker> | null = null;

function getSharedTesseractWorker(): Promise<TesseractWorker> {
  if (!sharedTesseractPromise) {
    sharedTesseractPromise = createWorker(['fas', 'eng']);
  }
  return sharedTesseractPromise;
}

async function renderPdfPageToJpegDataUrl(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number
): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  try {
    const page = await pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1.15 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.68);
    canvas.width = 0;
    canvas.height = 0;
    return dataUrl;
  } catch {
    return null;
  }
}

async function extractNativePageLines(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number
): Promise<string[]> {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    const pageH = Math.max(1, vp.height);
    const content = await page.getTextContent();

    interface GlyphPt {
      str: string;
      x: number;
      y: number;
      h: number;
    }

    const glyphs: GlyphPt[] = [];
    for (const rawIt of content.items) {
      const it = rawIt as { str?: string; transform?: number[]; height?: number };
      const str = (it.str || '').trim();
      if (!str) continue;
      const tx = it.transform ? it.transform[4] : 0;
      const ty = it.transform ? it.transform[5] : 0;
      const fontH = it.height || 12;
      const p1 = vp.convertToViewportPoint(tx, ty);
      glyphs.push({
        str,
        x: p1[0],
        y: p1[1] / pageH,
        h: Math.max(0.012, fontH / pageH),
      });
    }

    if (glyphs.length === 0) return [];

    const lineGroups: GlyphPt[][] = [];
    for (const g of glyphs) {
      const existing = lineGroups.find(
        grp => Math.abs(grp[0].y - g.y) <= Math.max(0.01, grp[0].h * 0.65)
      );
      if (existing) {
        existing.push(g);
      } else {
        lineGroups.push([g]);
      }
    }

    lineGroups.sort((a, b) => a[0].y - b[0].y);
    const lines: string[] = [];
    for (const grp of lineGroups) {
      const rawLine = grp.map(g => g.str).join(' ').replace(/\s+/g, ' ').trim();
      if (rawLine) lines.push(rawLine);
    }
    return lines;
  } catch {
    return [];
  }
}

export async function recognizeAndCacheBookChapters(
  docKey: string,
  bookTitle: string,
  totalPages: number,
  pdfDoc?: pdfjsLib.PDFDocumentProxy
): Promise<SmartBookChapter[]> {
  const existingChapters = loadCachedBookChapters(docKey);
  if (existingChapters.length > 0) return existingChapters;

  const frontLimit = Math.min(15, totalPages);
  const cachedPages = await loadCachedOcrPages(docKey);
  const frontPagesPayload: Array<{
    page: number;
    lines: string[];
    imageBase64?: string;
    mimeType?: string;
  }> = [];

  for (let p = 1; p <= frontLimit; p++) {
    let lines = cachedPages[p] || [];
    if (lines.length === 0 && pdfDoc) {
      lines = await extractNativePageLines(pdfDoc, p);
      if (lines.length >= 2) {
        await saveCachedOcrPages(docKey, [{ page: p, lines }], totalPages);
      }
    }
    let imageBase64: string | undefined;
    // Include page image for pages 2..9 if they have few native text lines (scanned Table of Contents)
    if (lines.length < 3 && pdfDoc && p >= 2 && p <= 9) {
      const b64 = await renderPdfPageToJpegDataUrl(pdfDoc, p);
      if (b64) imageBase64 = b64;
    }
    if (lines.length > 0 || imageBase64) {
      frontPagesPayload.push({
        page: p,
        lines,
        imageBase64,
        mimeType: 'image/jpeg',
      });
    }
  }

  if (frontPagesPayload.length === 0) return [];

  try {
    const res = await fetch('/api/chapters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookTitle,
        totalPages,
        frontPages: frontPagesPayload,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { chapters?: SmartBookChapter[] };
      if (Array.isArray(data.chapters) && data.chapters.length > 0) {
        saveCachedBookChapters(docKey, data.chapters);
        return data.chapters;
      }
    }
  } catch {
    // ignore network error
  }

  return [];
}

async function processSingleBookInBackground(book: Book): Promise<void> {
  const docKey = book.id;
  if (!docKey || completedBookIds.has(docKey)) return;

  try {
    const blobKey = book.pdfBlobKey || book.id;
    const blob = await getPdfBlob(blobKey);
    if (!blob) return;

    const arrayBuffer = await blob.arrayBuffer();
    const dataCopy = new Uint8Array(arrayBuffer.slice(0));
    const loadingTask = pdfjsLib.getDocument({
      data: dataCopy,
      cMapUrl: '/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/standard_fonts/',
      wasmUrl: '/wasm/',
      useSystemFonts: true,
      stopAtErrors: false,
    });

    const pdfDoc = await loadingTask.promise;
    const total = pdfDoc.numPages;
    const existingCache = await loadCachedOcrPages(docKey);

    // Always prioritize the opening 15 pages first so Table of Contents & Chapters are recognized immediately!
    const frontPageCount = Math.min(15, total);
    const orderedPagesSet = new Set<number>();
    for (let p = 1; p <= frontPageCount; p++) {
      orderedPagesSet.add(p);
    }

    // Then order remaining pages starting from book.currentPage outward
    const startPage = Math.max(1, Math.min(total, book.currentPage || 1));
    for (let offset = 0; offset < total; offset++) {
      const forward = startPage + offset;
      if (forward >= 1 && forward <= total) orderedPagesSet.add(forward);
      const backward = startPage - offset;
      if (offset > 0 && backward >= 1 && backward <= total) orderedPagesSet.add(backward);
    }

    const orderedPages = Array.from(orderedPagesSet);
    const pagesToReview = orderedPages.filter(
      p => !existingCache[p] || existingCache[p].length === 0
    );

    if (pagesToReview.length === 0) {
      // Even if pages were already OCR'd, ensure chapters were extracted
      await recognizeAndCacheBookChapters(docKey, book.title, total, pdfDoc);
      completedBookIds.add(docKey);
      await loadingTask.destroy().catch(() => {});
      return;
    }

    // Step 1: Quickly check if pages have rich native digital text; collect image pages that need AI/OCR review
    const pagesNeedingVisualOcr: number[] = [];
    const nativeBatch: Array<{ page: number; lines: string[] }> = [];

    for (const pNum of pagesToReview) {
      const nativeLines = await extractNativePageLines(pdfDoc, pNum);
      const charCount = nativeLines.join('').length;
      if (nativeLines.length >= 2 && charCount >= 25) {
        nativeBatch.push({ page: pNum, lines: nativeLines });
        if (nativeBatch.length >= 15) {
          await saveCachedOcrPages(docKey, nativeBatch.splice(0, nativeBatch.length), total);
        }
      } else {
        pagesNeedingVisualOcr.push(pNum);
      }
    }

    if (nativeBatch.length > 0) {
      await saveCachedOcrPages(docKey, nativeBatch, total);
    }

    // Try recognizing chapters right away from native opening pages (or opening page images)
    let chaptersRecognized =
      (await recognizeAndCacheBookChapters(docKey, book.title, total, pdfDoc)).length > 0;

    // Step 2: Review remaining pages with Server Gemini AI (/api/ocr) or Built-In Browser OCR fallback
    let useLocalBrowserOcr = false;
    const batchSize = 3;

    for (let i = 0; i < pagesNeedingVisualOcr.length; i += batchSize) {
      // Re-check cache in case the open reader already scanned some of these pages
      const latestCache = await loadCachedOcrPages(docKey);
      const batchNums = pagesNeedingVisualOcr
        .slice(i, i + batchSize)
        .filter(p => !latestCache[p] || latestCache[p].length === 0);

      if (batchNums.length === 0) continue;

      const renderedPages: Array<{ page: number; imageBase64: string; mimeType: string }> = [];
      for (const pNum of batchNums) {
        const b64 = await renderPdfPageToJpegDataUrl(pdfDoc, pNum);
        if (b64) {
          renderedPages.push({ page: pNum, imageBase64: b64, mimeType: 'image/jpeg' });
        }
      }

      if (renderedPages.length === 0) continue;

      let pageResults: Array<{ page: number; lines: string[] }> = [];

      if (!useLocalBrowserOcr) {
        try {
          const response = await fetch('/api/ocr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pages: renderedPages }),
          });
          if (response.ok) {
            const data = (await response.json()) as {
              results?: Array<{ page: number; lines: string[] }>;
              useClientOcr?: boolean;
            };
            if (data.useClientOcr) {
              useLocalBrowserOcr = true;
            } else {
              pageResults = (data.results || []).filter(
                r => Array.isArray(r.lines) && r.lines.length > 0
              );
            }
          } else {
            useLocalBrowserOcr = true;
          }
        } catch {
          useLocalBrowserOcr = true;
        }
      }

      if (useLocalBrowserOcr) {
        const worker = await getSharedTesseractWorker();
        for (const rp of renderedPages) {
          const rec = await worker.recognize(rp.imageBase64);
          const lines = (rec?.data?.text || '')
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(Boolean);
          if (lines.length > 0) {
            pageResults.push({ page: rp.page, lines });
          }
        }
      }

      if (pageResults.length > 0) {
        await saveCachedOcrPages(docKey, pageResults, total);
      }

      // Once the first ~15 pages have been OCR'd, run AI/heuristic chapter extraction again if not yet found!
      if (!chaptersRecognized && i >= 9) {
        const found = await recognizeAndCacheBookChapters(docKey, book.title, total, pdfDoc);
        if (found.length > 0) {
          chaptersRecognized = true;
        }
      }

      // Yield briefly so UI remains 60fps responsive while background indexing runs
      await new Promise(r => setTimeout(r, 120));
    }

    if (!chaptersRecognized) {
      await recognizeAndCacheBookChapters(docKey, book.title, total, pdfDoc);
    }

    completedBookIds.add(docKey);
    await loadingTask.destroy().catch(() => {});
  } catch (err) {
    console.warn(`Background word indexing skipped for ${book.title}:`, err);
  }
}

async function runBackgroundQueueLoop(): Promise<void> {
  if (isBackgroundWorkerRunning) return;
  isBackgroundWorkerRunning = true;
  try {
    while (backgroundQueue.length > 0) {
      const nextBook = backgroundQueue.shift();
      if (!nextBook) continue;
      await processSingleBookInBackground(nextBook);
      queuedBookIds.delete(nextBook.id);
    }
  } finally {
    isBackgroundWorkerRunning = false;
  }
}

/**
 * Immediately starts reviewing and indexing a book's pages and words in the background
 * as soon as the book is added to the user's library (prioritized at the front of the queue).
 */
export function enqueueBookForBackgroundScan(book: Book, prioritize = true): void {
  if (typeof window === 'undefined' || !book?.id) return;
  if (completedBookIds.has(book.id)) return;

  if (queuedBookIds.has(book.id)) {
    if (prioritize) {
      const idx = backgroundQueue.findIndex(b => b.id === book.id);
      if (idx > 0) {
        const [item] = backgroundQueue.splice(idx, 1);
        backgroundQueue.unshift(item);
      }
    }
    return;
  }

  queuedBookIds.add(book.id);
  if (prioritize) {
    backgroundQueue.unshift(book);
  } else {
    backgroundQueue.push(book);
  }
  runBackgroundQueueLoop().catch(() => {});
}

/**
 * Enqueues all books currently in the user's library so any unindexed pages are
 * automatically reviewed in the background.
 */
export function enqueueLibraryForBackgroundScan(books: Book[]): void {
  if (typeof window === 'undefined' || !Array.isArray(books)) return;
  for (const book of books) {
    enqueueBookForBackgroundScan(book, false);
  }
}

