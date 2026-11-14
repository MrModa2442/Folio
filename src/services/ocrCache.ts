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
const PAGE_OFFSET_UPDATED_EVENT = 'folio-page-offset-updated';
const CHAPTERS_STORAGE_PREFIX = 'folio_book_chapters_v4_';
const PAGE_OFFSET_STORAGE_PREFIX = 'folio_page_offset_v3_';

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
  isBookPageNumber?: boolean;
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

export interface PageOffsetUpdateEventDetail {
  docKey: string;
  pageOffset: number;
}

export function normalizeDigitsToAsciiClient(str: string): string {
  return str
    .replace(/([۱-۹١-٩0-9])[.٫•·∙⋅](?=\s|$)/g, '$10')
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
}

export function loadCachedBookPageOffset(docKey: string): number | null {
  if (!docKey || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${PAGE_OFFSET_STORAGE_PREFIX}${docKey}`);
    if (raw === null || raw === '') return null;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCachedBookPageOffset(docKey: string, pageOffset: number): void {
  if (!docKey || typeof window === 'undefined' || !Number.isFinite(pageOffset)) return;
  try {
    const rounded = Math.round(pageOffset);
    localStorage.setItem(`${PAGE_OFFSET_STORAGE_PREFIX}${docKey}`, String(rounded));
    window.dispatchEvent(
      new CustomEvent<PageOffsetUpdateEventDetail>(PAGE_OFFSET_UPDATED_EVENT, {
        detail: { docKey, pageOffset: rounded },
      })
    );
  } catch {
    // ignore storage errors
  }
}

export function clearCachedBookPageOffset(docKey: string): void {
  if (!docKey || typeof window === 'undefined') return;
  try {
    localStorage.removeItem(`${PAGE_OFFSET_STORAGE_PREFIX}${docKey}`);
    window.dispatchEvent(
      new CustomEvent<PageOffsetUpdateEventDetail>(PAGE_OFFSET_UPDATED_EVENT, {
        detail: { docKey, pageOffset: 0 },
      })
    );
  } catch {
    // ignore
  }
}

export function subscribeToPageOffsetUpdates(
  callback: (detail: PageOffsetUpdateEventDetail) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const custom = e as CustomEvent<PageOffsetUpdateEventDetail>;
    if (custom.detail) {
      callback(custom.detail);
    }
  };
  window.addEventListener(PAGE_OFFSET_UPDATED_EVENT, handler);
  return () => window.removeEventListener(PAGE_OFFSET_UPDATED_EVENT, handler);
}

export function hasAnalyzedBookChapters(docKey: string): boolean {
  if (!docKey || typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(`${CHAPTERS_STORAGE_PREFIX}${docKey}`) !== null;
  } catch {
    return false;
  }
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
  if (!docKey || typeof window === 'undefined' || !Array.isArray(chapters)) {
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

/**
 * Extracts candidate printed page numbers from a page's header/footer lines.
 */
function extractCandidateNumbersFromEdgeLinesClient(
  pdfPage: number,
  lines: string[],
  totalPages: number
): Array<{ printedPage: number; weight: number }> {
  if (!Array.isArray(lines) || lines.length === 0) return [];

  const edgeIndices = new Set<number>();
  edgeIndices.add(0);
  if (lines.length > 1) edgeIndices.add(1);
  if (lines.length > 2) edgeIndices.add(2);
  edgeIndices.add(lines.length - 1);
  if (lines.length > 2) edgeIndices.add(lines.length - 2);

  const results: Array<{ printedPage: number; weight: number }> = [];
  const maxReasonableOffset = Math.min(45, Math.max(15, Math.floor(totalPages * 0.25)));

  for (const idx of edgeIndices) {
    const rawLine = lines[idx] || '';
    const line = normalizeDigitsToAsciiClient(rawLine).trim();
    if (!line || line.length > 110) continue;

    const isVeryEdge = idx === 0 || idx === lines.length - 1;
    const baseBonus = isVeryEdge ? 2 : 1;

    // Pattern 1: Standalone page number line (e.g. "10", "- 10 -", "[ 10 ]", "صفحه 10", "ص 10")
    const standaloneMatch = line.match(
      /^(?:[-–—~•*[\]()\s]|صفحه|ص\.?|page|p\.?)*(\d{1,4})(?:[-–—~•*[\]()\s])*$/i
    );
    if (standaloneMatch) {
      const n = parseInt(standaloneMatch[1], 10);
      const offset = pdfPage - n;
      if (n >= 1 && n <= totalPages && offset >= -2 && offset <= maxReasonableOffset) {
        results.push({ printedPage: n, weight: 4 + baseBonus });
        continue;
      }
    }

    // Pattern 2: Running header/footer with number at the start or end (e.g. "10 شهد شورستان" or "شهد شورستان 10")
    const leadingNumMatch = line.match(/^(\d{1,4})(?:\s+|[\s/|\\\-–—:•·]+)(.+)$/);
    const trailingNumMatch = line.match(/^(.+?)(?:\s+|[\s/|\\\-–—:•·]+)(\d{1,4})$/);

    if (leadingNumMatch) {
      const n = parseInt(leadingNumMatch[1], 10);
      const rest = leadingNumMatch[2].trim();
      const offset = pdfPage - n;
      if (
        n >= 1 &&
        n <= totalPages &&
        offset >= -2 &&
        offset <= maxReasonableOffset &&
        rest.length <= 65 &&
        !/[.…_ـ]{3,}/.test(line)
      ) {
        results.push({ printedPage: n, weight: 2 + baseBonus });
      }
    }

    if (trailingNumMatch) {
      const rest = trailingNumMatch[1].trim();
      const n = parseInt(trailingNumMatch[2], 10);
      const offset = pdfPage - n;
      if (
        n >= 1 &&
        n <= totalPages &&
        offset >= -2 &&
        offset <= maxReasonableOffset &&
        rest.length <= 65 &&
        !/[.…_ـ]{3,}/.test(line)
      ) {
        results.push({ printedPage: n, weight: 2 + baseBonus });
      }
    }
  }

  return results;
}

export function computePageOffsetFromLinesMap(
  pagesMap: Record<number, string[]>,
  totalPages: number
): { offset: number; distinctPages: number; weight: number } | null {
  const offsetStats = new Map<number, { pages: Set<number>; totalWeight: number }>();

  for (const [pageStr, lines] of Object.entries(pagesMap)) {
    const p = parseInt(pageStr, 10);
    if (!Number.isFinite(p) || p < 3 || !Array.isArray(lines) || lines.length === 0) continue;
    const candidates = extractCandidateNumbersFromEdgeLinesClient(p, lines, totalPages);
    for (const c of candidates) {
      const offset = p - c.printedPage;
      const existing = offsetStats.get(offset) || { pages: new Set<number>(), totalWeight: 0 };
      existing.pages.add(p);
      existing.totalWeight += c.weight;
      offsetStats.set(offset, existing);
    }
  }

  if (offsetStats.size === 0) return null;

  let bestOffset: number | null = null;
  let bestPageCount = 0;
  let bestWeight = 0;

  for (const [offset, stat] of offsetStats.entries()) {
    const pageCount = stat.pages.size;
    if (
      pageCount > bestPageCount ||
      (pageCount === bestPageCount && stat.totalWeight > bestWeight)
    ) {
      bestOffset = offset;
      bestPageCount = pageCount;
      bestWeight = stat.totalWeight;
    }
  }

  if (bestOffset !== null) {
    return { offset: bestOffset, distinctPages: bestPageCount, weight: bestWeight };
  }
  return null;
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

    // If pageOffset hasn't been cached yet, check if newly OCR'd pages yield a multi-page consensus offset
    if (totalPages && loadCachedBookPageOffset(docKey) === null) {
      const consensus = computePageOffsetFromLinesMap(merged, totalPages);
      if (consensus && consensus.distinctPages >= 2) {
        saveCachedBookPageOffset(docKey, consensus.offset);
      }
    }

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
// Background Book Word & Page Indexer + 4-Corner Page Number Analyzer
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

export interface CornerCropCandidate {
  corner: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
  dataUrl: string;
  hasTrailingZeroDot: boolean;
  geometricNumber: number | null;
  blobCount: number;
  isTeenPattern: boolean;
  relWidth: number;
}

/**
 * Analyzes the 4 corners (Top-Right, Top-Left, Bottom-Right, Bottom-Left) of a PDF page
 * and crops any compact corner page-number cluster (< 5.5% of page width) at 3.5x magnification.
 * Filters out wide book-title running headers (like "شهد شورستان" = ~9.1% of page width)
 * and computes exact sub-blob geometry for Persian/Arabic/Latin digits.
 */
export async function extractCornerNumberCropsFromPage(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number
): Promise<CornerCropCandidate[]> {
  if (typeof document === 'undefined') return [];
  try {
    const page = await pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1.6 });
    const w = Math.max(1, Math.floor(vp.width));
    const h = Math.max(1, Math.floor(vp.height));

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = w;
    srcCanvas.height = h;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) return [];
    srcCtx.fillStyle = '#FFFFFF';
    srcCtx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: srcCtx, viewport: vp, canvas: srcCanvas }).promise;

    const imgData = srcCtx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const xMargin = Math.floor(w * 0.03);
    const rowInkCounts = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      let count = 0;
      const rowOffset = y * w * 4;
      for (let x = xMargin; x < w - xMargin; x++) {
        const idx = rowOffset + x * 4;
        const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
        if (lum < 210) count++;
      }
      rowInkCounts[y] = count;
    }

    // Use minRowInk = 1 so thin vertical tips of '۱' / '1' at the top of a header are never clipped
    const minRowInk = 1;

    // Find top header ink band in top 32% of page
    let firstInkY = -1;
    for (let y = Math.floor(h * 0.02); y < Math.floor(h * 0.32); y++) {
      if (rowInkCounts[y] >= minRowInk) {
        firstInkY = y;
        break;
      }
    }

    let headerLineEndY = firstInkY !== -1 ? Math.min(h - 1, firstInkY + Math.floor(h * 0.05)) : -1;
    if (firstInkY !== -1) {
      let blankRun = 0;
      for (let y = firstInkY + 5; y < Math.min(h - 1, firstInkY + Math.floor(h * 0.1)); y++) {
        if (rowInkCounts[y] < minRowInk) {
          blankRun++;
          if (blankRun >= 5) {
            headerLineEndY = y - blankRun + 1;
            break;
          }
        } else {
          blankRun = 0;
        }
      }
    }

    // Find bottom footer ink band in bottom 32% of page
    let lastInkY = -1;
    for (let y = Math.floor(h * 0.98); y > Math.floor(h * 0.68); y--) {
      if (rowInkCounts[y] >= minRowInk) {
        lastInkY = y;
        break;
      }
    }

    let footerLineStartY = lastInkY !== -1 ? Math.max(0, lastInkY - Math.floor(h * 0.05)) : -1;
    if (lastInkY !== -1) {
      let blankRun = 0;
      for (let y = lastInkY - 5; y > Math.max(0, lastInkY - Math.floor(h * 0.1)); y--) {
        if (rowInkCounts[y] < minRowInk) {
          blankRun++;
          if (blankRun >= 5) {
            footerLineStartY = y + blankRun - 1;
            break;
          }
        } else {
          blankRun = 0;
        }
      }
    }

    const candidates: CornerCropCandidate[] = [];

    const extractCornersFromBand = (y0Raw: number, y1Raw: number, isTop: boolean) => {
      if (y0Raw < 0 || y1Raw <= y0Raw) return;
      const y0 = Math.max(0, y0Raw - 5);
      const y1 = Math.min(h, y1Raw + 5);
      const bandH = y1 - y0;
      if (bandH < 6) return;

      const colHasInk = new Uint8Array(w);
      let activeCols = 0;
      for (let x = xMargin; x < w - xMargin; x++) {
        let darkPixels = 0;
        for (let y = y0; y < y1; y++) {
          const idx = (y * w + x) * 4;
          const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
          if (lum < 208) darkPixels++;
        }
        if (darkPixels >= 1) {
          colHasInk[x] = 1;
          activeCols++;
        }
      }

      // Skip full-width body text lines (a paragraph line covers > 38% of the page width)
      const inkCoverage = activeCols / Math.max(1, w - 2 * xMargin);
      if (inkCoverage > 0.38) return;

      const minGap = Math.max(8, Math.floor(w * 0.014));
      const segments: Array<{ x0: number; x1: number }> = [];
      let inSeg = false;
      let segStart = 0;
      let gap = 0;
      for (let x = xMargin; x < w - xMargin; x++) {
        if (colHasInk[x]) {
          if (!inSeg) {
            inSeg = true;
            segStart = x;
          }
          gap = 0;
        } else if (inSeg) {
          gap++;
          if (gap >= minGap) {
            segments.push({ x0: segStart, x1: x - gap });
            inSeg = false;
          }
        }
      }
      if (inSeg) {
        segments.push({ x0: segStart, x1: w - xMargin });
      }

      for (const seg of segments) {
        const segW = seg.x1 - seg.x0;
        const relWidth = segW / w;
        // Printed corner page numbers (1 to 3 digits) are compact: between 0.2% and 5.5% of page width.
        // Wide segments like book titles ("شهد شورستان" = ~9.1% of page width) are strictly excluded!
        if (segW < 2 || relWidth > 0.055) continue;

        const cx = (seg.x0 + seg.x1) / (2 * w);
        let corner: CornerCropCandidate['corner'] | null = null;
        if (cx >= 0.6) {
          corner = isTop ? 'top-right' : 'bottom-right';
        } else if (cx <= 0.4) {
          corner = isTop ? 'top-left' : 'bottom-left';
        } else if (segments.length === 1 && relWidth <= 0.05) {
          corner = isTop ? 'top-center' : 'bottom-center';
        }
        if (!corner) continue;

        // Segment horizontal connected digit sub-blobs inside [seg.x0..seg.x1, y0..y1]
        const rawSubBlobs: Array<{
          bx0: number;
          bx1: number;
          by0: number;
          by1: number;
          darkCount: number;
        }> = [];
        let inSub = false;
        let sbStart = seg.x0;
        for (let x = seg.x0; x <= seg.x1; x++) {
          let hasDark = false;
          for (let y = y0; y < y1; y++) {
            const idx = (y * w + x) * 4;
            const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
            if (lum < 208) {
              hasDark = true;
              break;
            }
          }
          if (hasDark && !inSub) {
            inSub = true;
            sbStart = x;
          } else if (!hasDark && inSub) {
            rawSubBlobs.push({ bx0: sbStart, bx1: x - 1, by0: y1, by1: y0, darkCount: 0 });
            inSub = false;
          }
        }
        if (inSub) {
          rawSubBlobs.push({ bx0: sbStart, bx1: seg.x1, by0: y1, by1: y0, darkCount: 0 });
        }

        for (const sb of rawSubBlobs) {
          for (let y = y0; y < y1; y++) {
            for (let x = sb.bx0; x <= sb.bx1; x++) {
              const idx = (y * w + x) * 4;
              const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
              if (lum < 208) {
                sb.darkCount++;
                if (y < sb.by0) sb.by0 = y;
                if (y > sb.by1) sb.by1 = y;
              }
            }
          }
        }

        // Filter out tiny 1-pixel dust specks
        const subBlobs = rawSubBlobs
          .filter(sb => sb.darkCount >= 3 && sb.by1 >= sb.by0)
          .map(sb => {
            const bw = sb.bx1 - sb.bx0 + 1;
            const bh = sb.by1 - sb.by0 + 1;
            return {
              ...sb,
              bw,
              bh,
              aspect: bw / Math.max(1, bh),
            };
          });

        if (subBlobs.length === 0 || subBlobs.length > 4) continue;

        let hasTrailingZeroDot = false;
        let geometricNumber: number | null = null;
        let isTeenPattern = false;

        if (subBlobs.length === 1) {
          const b0 = subBlobs[0];
          // Single narrow vertical stem is digit '1' ('۱' / '١' / '1')
          if (b0.bh >= 6 && b0.aspect <= 0.48) {
            geometricNumber = 1;
          }
        } else if (subBlobs.length === 2) {
          const leftBlob = subBlobs[0];
          const rightBlob = subBlobs[1];
          const isLeftStemOne = leftBlob.bh >= 6 && leftBlob.aspect <= 0.54;
          const isRightZeroDot =
            leftBlob.bh >= 6 &&
            rightBlob.bh >= 2 &&
            rightBlob.bh <= leftBlob.bh * 0.68 &&
            rightBlob.aspect >= 0.45 &&
            rightBlob.aspect <= 2.1;
          const isRightStemOne =
            rightBlob.bh >= 6 &&
            rightBlob.aspect <= 0.52 &&
            Math.abs(leftBlob.bh - rightBlob.bh) <= Math.max(3, leftBlob.bh * 0.35);

          if (isRightZeroDot) {
            hasTrailingZeroDot = true;
          }
          if (isLeftStemOne) {
            isTeenPattern = true;
            if (isRightZeroDot) {
              // '[vertical stem ۱] + [small zero dot ۰]' is unambiguously 10 ('۱۰')!
              geometricNumber = 10;
            } else if (isRightStemOne) {
              // '[vertical stem ۱] + [vertical stem ۱]' is unambiguously 11 ('۱۱' / '11')!
              geometricNumber = 11;
            }
          }
        }

        // Render 3.5x magnified corner number on a clean white canvas with generous padding
        const cropX0 = Math.max(0, seg.x0 - 10);
        const cropX1 = Math.min(w, seg.x1 + 10);
        const cropW = Math.max(14, cropX1 - cropX0);
        const scaleUp = 3.5;
        const pad = 32;
        const outW = Math.round(cropW * scaleUp) + pad * 2;
        const outH = Math.round(bandH * scaleUp) + pad * 2;

        const cornerCanvas = document.createElement('canvas');
        cornerCanvas.width = outW;
        cornerCanvas.height = outH;
        const cCtx = cornerCanvas.getContext('2d');
        if (!cCtx) continue;

        cCtx.fillStyle = '#FFFFFF';
        cCtx.fillRect(0, 0, outW, outH);
        cCtx.imageSmoothingEnabled = true;
        cCtx.imageSmoothingQuality = 'high';
        cCtx.drawImage(
          srcCanvas,
          cropX0,
          y0,
          cropW,
          bandH,
          pad,
          pad,
          Math.round(cropW * scaleUp),
          Math.round(bandH * scaleUp)
        );

        const cImg = cCtx.getImageData(0, 0, outW, outH);
        const cd = cImg.data;
        for (let i = 0; i < cd.length; i += 4) {
          const lum = (cd[i] * 299 + cd[i + 1] * 587 + cd[i + 2] * 114) / 1000;
          const v = lum > 228 ? 255 : Math.max(0, Math.min(255, Math.round((lum - 110) * 1.45)));
          cd[i] = v;
          cd[i + 1] = v;
          cd[i + 2] = v;
        }
        cCtx.putImageData(cImg, 0, 0);

        candidates.push({
          corner,
          dataUrl: cornerCanvas.toDataURL('image/png'),
          hasTrailingZeroDot,
          geometricNumber,
          blobCount: subBlobs.length,
          isTeenPattern,
          relWidth,
        });
        cornerCanvas.width = 0;
        cornerCanvas.height = 0;
      }
    };

    extractCornersFromBand(firstInkY, headerLineEndY, true);
    extractCornersFromBand(footerLineStartY, lastInkY, false);

    // Sort candidates by narrowest width first so compact numbers are always inspected before anything wider
    candidates.sort((a, b) => a.relWidth - b.relWidth);

    srcCanvas.width = 0;
    srcCanvas.height = 0;
    return candidates;
  } catch {
    return [];
  }
}

/**
 * Legacy helper kept for compatibility: returns the best corner crop dataUrl for a page.
 */
export async function renderPageHeaderFooterStripToJpeg(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number
): Promise<string | null> {
  const crops = await extractCornerNumberCropsFromPage(pdfDoc, pageNum);
  return crops[0]?.dataUrl || null;
}

/**
 * Quickly inspects the 4 corners of a single PDF page (native text first, then geometric sub-blobs + OCR)
 * to read the printed page number written on that page.
 */
export async function detectPrintedPageNumberFromCorners(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  totalPages: number
): Promise<number | null> {
  if (pageNum < 2 || pageNum > totalPages) return null;
  const maxReasonableOffset = Math.min(45, Math.max(15, Math.floor(totalPages * 0.25)));

  // 1. Fast check: Native PDF text items in the 4 corners (top-right, top-left, bottom-right, bottom-left)
  try {
    const page = await pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    const pageW = Math.max(1, vp.width);
    const pageH = Math.max(1, vp.height);
    const content = await page.getTextContent();

    for (const rawIt of content.items) {
      const it = rawIt as { str?: string; transform?: number[] };
      const rawStr = (it.str || '').trim();
      if (!rawStr || rawStr.length > 18) continue;
      const tx = it.transform ? it.transform[4] : 0;
      const ty = it.transform ? it.transform[5] : 0;
      const pt = vp.convertToViewportPoint(tx, ty);
      const nx = pt[0] / pageW;
      const ny = pt[1] / pageH;

      const isTopOrBottomEdge = ny <= 0.16 || ny >= 0.84;
      const isCornerOrCenter = nx <= 0.38 || nx >= 0.62 || (nx >= 0.42 && nx <= 0.58);
      if (!isTopOrBottomEdge || !isCornerOrCenter) continue;

      const clean = normalizeDigitsToAsciiClient(rawStr).trim();
      const m = clean.match(/^(?:[-–—~•*[\]()\s]|صفحه|ص\.?|page|p\.?)*(\d{1,4})(?:[-–—~•*[\]()\s])*$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        const offset = pageNum - n;
        if (n >= 1 && n <= totalPages && offset >= -2 && offset <= maxReasonableOffset) {
          return n;
        }
      }
    }
  } catch {
    // ignore native text error
  }

  // 2. Scanned page 4-corner visual & geometric sub-blob analysis
  const cornerCrops = await extractCornerNumberCropsFromPage(pdfDoc, pageNum);
  if (cornerCrops.length === 0) return null;

  // Check instant geometric sub-blob recognition first (e.g. '۱۰' = 10, '۱۱' = 11, '۱' = 1)
  for (const crop of cornerCrops) {
    if (crop.geometricNumber !== null) {
      const n = crop.geometricNumber;
      const offset = pageNum - n;
      if (n >= 1 && n <= totalPages && offset >= -2 && offset <= maxReasonableOffset) {
        return n;
      }
    }
  }

  try {
    const worker = await getSharedTesseractWorker();
    for (const crop of cornerCrops) {
      const rec = await worker.recognize(crop.dataUrl);
      const rawText = (rec?.data?.text || '').trim();
      const norm = normalizeDigitsToAsciiClient(rawText)
        .replace(/[|lI!]/g, '1')
        .replace(/[^0-9]/g, '');

      if (!norm) continue;
      let n = parseInt(norm, 10);
      if (!Number.isFinite(n) || n <= 0) continue;

      if (n >= 1 && n <= 9 && crop.hasTrailingZeroDot) {
        const withZero = n * 10;
        const offsetWithZero = pageNum - withZero;
        if (offsetWithZero >= -2 && offsetWithZero <= maxReasonableOffset) {
          n = withZero;
        }
      }

      const offset = pageNum - n;
      if (n >= 1 && n <= totalPages && offset >= -2 && offset <= maxReasonableOffset) {
        return n;
      }
    }
  } catch {
    // ignore OCR error
  }

  return null;
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

/**
 * Automatically detects the printed book page offset (`pdfPage - printedBookPage`,
 * e.g. 4 when Book Page 1 starts on PDF page 5, or 5 when PDF page 15 has printed page 10)
 * by analyzing the 4 corners across the opening and sample body pages.
 */
export async function detectAndCacheBookPageOffset(
  docKey: string,
  bookTitle: string,
  totalPages: number,
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  preferredCurrentPage = 1,
  forceRecalculate = false
): Promise<number> {
  if (!forceRecalculate) {
    const cachedOffset = loadCachedBookPageOffset(docKey);
    if (cachedOffset !== null) {
      return cachedOffset;
    }
  }

  if (totalPages <= 3) {
    saveCachedBookPageOffset(docKey, 0);
    return 0;
  }

  // 1. Check native digital PDF text lines across pages 2..18 first
  const cachedOcr = await loadCachedOcrPages(docKey);
  const linesMap: Record<number, string[]> = { ...cachedOcr };
  const probeLimit = Math.min(18, totalPages);
  for (let p = 2; p <= probeLimit; p++) {
    if (!linesMap[p] || linesMap[p].length === 0) {
      const nativeLines = await extractNativePageLines(pdfDoc, p);
      if (nativeLines.length > 0) {
        linesMap[p] = nativeLines;
      }
    }
  }

  const nativeConsensus = computePageOffsetFromLinesMap(linesMap, totalPages);
  if (nativeConsensus && nativeConsensus.distinctPages >= 2) {
    saveCachedBookPageOffset(docKey, nativeConsensus.offset);
    return nativeConsensus.offset;
  }

  // 2. Scanned Book Multi-Page 4-Corner Sub-Blob & Sequence Calibrator
  // Check pages 15, 16, 14, 17, 13, 12, 11, 10, 6, 5, 4 (plus preferredCurrentPage)
  // Because page 10 ('۱۰') is [stem '1' + zero dot '0'] and page 11 ('۱۱') is [stem '1' + stem '1'],
  // and pages 10..19 all have 2 sub-blobs starting with stem '1' while pages 1..9 have 1 sub-blob,
  // checking these pages finds the exact offset immediately!
  const scanPagesOrder = [
    ...(preferredCurrentPage >= 4 && preferredCurrentPage <= totalPages
      ? [preferredCurrentPage]
      : []),
    15,
    16,
    14,
    17,
    13,
    12,
    11,
    10,
    9,
    8,
    7,
    6,
    5,
    4,
  ].filter((p, idx, arr) => p >= 2 && p <= totalPages && arr.indexOf(p) === idx);

  const offsetWeights = new Map<number, number>();
  const pageCropInfo = new Map<number, CornerCropCandidate>();

  const addVote = (offset: number, weight: number) => {
    if (offset < 0 || offset > Math.min(40, Math.floor(totalPages * 0.35))) return;
    offsetWeights.set(offset, (offsetWeights.get(offset) || 0) + weight);
  };

  for (const p of scanPagesOrder) {
    const crops = await extractCornerNumberCropsFromPage(pdfDoc, p);
    if (crops.length === 0) continue;
    const bestCrop = crops[0];
    pageCropInfo.set(p, bestCrop);

    if (bestCrop.geometricNumber !== null) {
      const offset = p - bestCrop.geometricNumber;
      const weight = bestCrop.geometricNumber >= 10 ? 15 : 8;
      addVote(offset, weight);

      // If we hit a high-confidence geometric anchor ('۱۰' = 10 or '۱۱' = 11) confirmed by another vote, lock in right away!
      if ((offsetWeights.get(offset) || 0) >= 20) {
        saveCachedBookPageOffset(docKey, offset);
        return offset;
      }
    }
  }

  // Score sequence transition from 1-digit pages (1..9 -> blobCount === 1) to teen pages (10..19 -> isTeenPattern === true)
  for (let candOffset = 0; candOffset <= Math.min(20, totalPages - 5); candOffset++) {
    let seqScore = 0;
    for (const [p, crop] of pageCropInfo.entries()) {
      const bookP = p - candOffset;
      if (bookP >= 1 && bookP <= 9 && crop.blobCount === 1) {
        seqScore += 3;
      } else if (bookP >= 10 && bookP <= 19 && crop.isTeenPattern) {
        seqScore += 4;
      }
    }
    if (seqScore >= 9) {
      addVote(candOffset, seqScore);
    }
  }

  if (offsetWeights.size > 0) {
    let bestOffset = 0;
    let bestWeight = 0;
    for (const [off, w] of offsetWeights.entries()) {
      if (w > bestWeight) {
        bestOffset = off;
        bestWeight = w;
      }
    }
    if (bestWeight >= 10) {
      saveCachedBookPageOffset(docKey, bestOffset);
      return bestOffset;
    }
  }

  // 3. Also query Server Gemini AI (/api/chapters in offset_only mode) with corner crops if available
  const bodySamplePayload: Array<{
    page: number;
    lines: string[];
    imageBase64?: string;
    mimeType?: string;
  }> = [];

  for (const [p, crop] of Array.from(pageCropInfo.entries()).slice(0, 4)) {
    bodySamplePayload.push({
      page: p,
      lines: linesMap[p] || [],
      imageBase64: crop.dataUrl,
      mimeType: 'image/png',
    });
  }

  if (bodySamplePayload.length > 0) {
    try {
      const res = await fetch('/api/chapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookTitle,
          totalPages,
          bodySamplePages: bodySamplePayload,
          mode: 'offset_only',
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { pageOffset?: number | null };
        if (typeof data.pageOffset === 'number' && Number.isFinite(data.pageOffset)) {
          saveCachedBookPageOffset(docKey, data.pageOffset);
          return data.pageOffset;
        }
      }
    } catch {
      // ignore
    }
  }

  return loadCachedBookPageOffset(docKey) ?? 0;
}

/**
 * Recognizes the book's Table of Contents / Chapters ONLY if the book actually has a chapters
 * section in its opening pages. Saves and returns [] if the book has no Table of Contents.
 */
export async function recognizeAndCacheBookChapters(
  docKey: string,
  bookTitle: string,
  totalPages: number,
  pdfDoc?: pdfjsLib.PDFDocumentProxy,
  preferredCurrentPage = 1
): Promise<SmartBookChapter[]> {
  if (hasAnalyzedBookChapters(docKey)) {
    const cached = loadCachedBookChapters(docKey);
    if (pdfDoc && loadCachedBookPageOffset(docKey) === null) {
      detectAndCacheBookPageOffset(docKey, bookTitle, totalPages, pdfDoc, preferredCurrentPage).catch(
        () => {}
      );
    }
    return cached;
  }

  const frontLimit = Math.min(12, totalPages);
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
    if (lines.length < 3 && pdfDoc && p >= 2 && p <= 8) {
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

  if (frontPagesPayload.length === 0) {
    saveCachedBookChapters(docKey, []);
    return [];
  }

  try {
    const res = await fetch('/api/chapters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookTitle,
        totalPages,
        frontPages: frontPagesPayload,
        bodySamplePages: [],
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        chapters?: SmartBookChapter[];
        pageOffset?: number | null;
      };
      if (typeof data.pageOffset === 'number' && Number.isFinite(data.pageOffset)) {
        saveCachedBookPageOffset(docKey, data.pageOffset);
      }
      const detectedChapters = Array.isArray(data.chapters) ? data.chapters : [];
      saveCachedBookChapters(docKey, detectedChapters);
      return detectedChapters;
    }
  } catch {
    // ignore network error
  }

  if (pdfDoc && loadCachedBookPageOffset(docKey) === null) {
    detectAndCacheBookPageOffset(docKey, bookTitle, totalPages, pdfDoc, preferredCurrentPage).catch(
      () => {}
    );
  }

  saveCachedBookChapters(docKey, []);
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

    // Immediately calibrate the book's printed page number offset first!
    await detectAndCacheBookPageOffset(docKey, book.title, total, pdfDoc, book.currentPage || 1);

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
      await recognizeAndCacheBookChapters(docKey, book.title, total, pdfDoc, book.currentPage || 1);
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
      (await recognizeAndCacheBookChapters(docKey, book.title, total, pdfDoc, book.currentPage || 1)).length > 0;

    // Step 2: Review remaining pages with Server Gemini AI (/api/ocr) or Built-In Browser OCR fallback
    let useLocalBrowserOcr = false;
    const batchSize = 3;

    for (let i = 0; i < pagesNeedingVisualOcr.length; i += batchSize) {
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
        const found = await recognizeAndCacheBookChapters(
          docKey,
          book.title,
          total,
          pdfDoc,
          book.currentPage || 1
        );
        if (found.length > 0) {
          chaptersRecognized = true;
        }
      }

      await new Promise(r => setTimeout(r, 120));
    }

    if (!chaptersRecognized) {
      await recognizeAndCacheBookChapters(docKey, book.title, total, pdfDoc, book.currentPage || 1);
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

export function enqueueLibraryForBackgroundScan(books: Book[]): void {
  if (typeof window === 'undefined' || !Array.isArray(books)) return;
  for (const book of books) {
    enqueueBookForBackgroundScan(book, false);
  }
}
