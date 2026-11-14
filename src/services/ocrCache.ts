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
const CHAPTERS_STORAGE_PREFIX = 'folio_book_chapters_v3_';
const PAGE_OFFSET_STORAGE_PREFIX = 'folio_page_offset_v2_';

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
}

/**
 * Analyzes the 4 corners (Top-Right, Top-Left, Bottom-Right, Bottom-Left) of a PDF page
 * and crops any compact corner page-number cluster at 3.5x magnification on a clean white canvas.
 * Filters out wide book-title running headers (like "شهد شورستان") and full body paragraph lines.
 */
export async function extractCornerNumberCropsFromPage(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number
): Promise<CornerCropCandidate[]> {
  if (typeof document === 'undefined') return [];
  try {
    const page = await pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1.8 });
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

    const minRowInk = Math.max(2, Math.floor(w * 0.0025));

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
      for (let y = firstInkY + 6; y < Math.min(h - 1, firstInkY + Math.floor(h * 0.1)); y++) {
        if (rowInkCounts[y] < minRowInk) {
          blankRun++;
          if (blankRun >= 6) {
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
      for (let y = lastInkY - 6; y > Math.max(0, lastInkY - Math.floor(h * 0.1)); y--) {
        if (rowInkCounts[y] < minRowInk) {
          blankRun++;
          if (blankRun >= 6) {
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
      const y0 = Math.max(0, y0Raw - 6);
      const y1 = Math.min(h, y1Raw + 6);
      const bandH = y1 - y0;
      if (bandH < 8) return;

      const colHasInk = new Uint8Array(w);
      let activeCols = 0;
      for (let x = xMargin; x < w - xMargin; x++) {
        let darkPixels = 0;
        for (let y = y0; y < y1; y++) {
          const idx = (y * w + x) * 4;
          const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
          if (lum < 208) darkPixels++;
        }
        if (darkPixels >= 2) {
          colHasInk[x] = 1;
          activeCols++;
        }
      }

      // Skip full-width body text lines (a paragraph line covers > 40% of the page width)
      const inkCoverage = activeCols / Math.max(1, w - 2 * xMargin);
      if (inkCoverage > 0.4) return;

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
          if (gap >= 16) {
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
        // Printed corner page numbers (1 to 4 digits) are compact: between 0.4% and 11% of page width.
        // Wide segments like book titles ("شهد شورستان" = ~17% of page width) are automatically excluded!
        if (segW < Math.max(4, w * 0.004) || segW > w * 0.115) continue;

        const cx = (seg.x0 + seg.x1) / (2 * w);
        let corner: CornerCropCandidate['corner'] | null = null;
        if (cx >= 0.6) {
          corner = isTop ? 'top-right' : 'bottom-right';
        } else if (cx <= 0.4) {
          corner = isTop ? 'top-left' : 'bottom-left';
        } else if (segments.length === 1 && segW <= w * 0.09) {
          corner = isTop ? 'top-center' : 'bottom-center';
        }
        if (!corner) continue;

        // Inspect horizontal sub-blobs inside this corner segment to detect Persian zero dot '۰' (e.g. "۱۰", "۲۰", "۳۰")
        const subBlobs: Array<{ bx0: number; bx1: number; by0: number; by1: number }> = [];
        let inSub = false;
        let sbStart = seg.x0;
        for (let x = seg.x0; x <= seg.x1; x++) {
          let hasDark = false;
          for (let y = y0; y < y1; y++) {
            const idx = (y * w + x) * 4;
            const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
            if (lum < 205) {
              hasDark = true;
              break;
            }
          }
          if (hasDark && !inSub) {
            inSub = true;
            sbStart = x;
          } else if (!hasDark && inSub) {
            subBlobs.push({ bx0: sbStart, bx1: x - 1, by0: y1, by1: y0 });
            inSub = false;
          }
        }
        if (inSub) {
          subBlobs.push({ bx0: sbStart, bx1: seg.x1, by0: y1, by1: y0 });
        }

        for (const sb of subBlobs) {
          for (let y = y0; y < y1; y++) {
            for (let x = sb.bx0; x <= sb.bx1; x++) {
              const idx = (y * w + x) * 4;
              const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
              if (lum < 205) {
                if (y < sb.by0) sb.by0 = y;
                if (y > sb.by1) sb.by1 = y;
              }
            }
          }
        }

        let hasTrailingZeroDot = false;
        if (subBlobs.length === 2) {
          const leftBlob = subBlobs[0];
          const rightBlob = subBlobs[1];
          const leftH = Math.max(1, leftBlob.by1 - leftBlob.by0 + 1);
          const rightH = Math.max(1, rightBlob.by1 - rightBlob.by0 + 1);
          const rightW = Math.max(1, rightBlob.bx1 - rightBlob.bx0 + 1);
          // In Persian/Arabic fonts, '۰' (0) is a small diamond dot ~25%..58% the height of the left digit
          if (
            leftH >= 12 &&
            rightH >= 3 &&
            rightH <= leftH * 0.62 &&
            rightW >= 3 &&
            rightW <= rightH * 1.85
          ) {
            hasTrailingZeroDot = true;
          }
        }

        // Render 3.5x magnified corner number on a clean white canvas with generous padding
        const cropX0 = Math.max(0, seg.x0 - 12);
        const cropX1 = Math.min(w, seg.x1 + 12);
        const cropW = Math.max(16, cropX1 - cropX0);
        const scaleUp = 3.5;
        const pad = 36;
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

        // Gentle contrast stretch that preserves thin Persian strokes and zero dots
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
        });
        cornerCanvas.width = 0;
        cornerCanvas.height = 0;
      }
    };

    extractCornersFromBand(firstInkY, headerLineEndY, true);
    extractCornersFromBand(footerLineStartY, lastInkY, false);

    srcCanvas.width = 0;
    srcCanvas.height = 0;
    return candidates;
  } catch {
    return [];
  }
}

/**
 * Legacy helper kept for compatibility: combines extracted corner crops into a single JPEG strip if needed.
 */
export async function renderPageHeaderFooterStripToJpeg(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number
): Promise<string | null> {
  const crops = await extractCornerNumberCropsFromPage(pdfDoc, pageNum);
  return crops[0]?.dataUrl || null;
}

/**
 * Quickly inspects the 4 corners of a single PDF page (native text first, then 4-corner visual crops)
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

  // 2. Scanned page 4-corner visual analysis
  const cornerCrops = await extractCornerNumberCropsFromPage(pdfDoc, pageNum);
  if (cornerCrops.length === 0) return null;

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

      // If Tesseract read a single digit (e.g. "1" from "۱۰") and our sub-blob geometry detected the trailing Persian zero dot '۰', multiply by 10
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
 * e.g. 5 when PDF page 15 has printed page 10 at its corner) by checking the 4 corners
 * of the current page and sample body pages.
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

  // Prioritize the page the user is currently viewing (if >= 4), plus nearby body pages
  const samplePagesSet = new Set<number>();
  if (preferredCurrentPage >= 4 && preferredCurrentPage <= totalPages) {
    samplePagesSet.add(preferredCurrentPage);
    if (preferredCurrentPage + 1 <= totalPages) samplePagesSet.add(preferredCurrentPage + 1);
    if (preferredCurrentPage + 2 <= totalPages) samplePagesSet.add(preferredCurrentPage + 2);
  }
  for (const p of [15, 17, 16, 14, 12, 10, 8]) {
    if (p <= totalPages && samplePagesSet.size < 5) {
      samplePagesSet.add(p);
    }
  }
  if (samplePagesSet.size === 0) {
    for (let p = Math.max(2, Math.floor(totalPages * 0.3)); p <= totalPages && samplePagesSet.size < 4; p++) {
      samplePagesSet.add(p);
    }
  }

  const samplePages = Array.from(samplePagesSet);
  const offsetVotes = new Map<number, number>();

  // 1. Analyze the 4 corners of each sample page directly
  for (const p of samplePages) {
    const printedNum = await detectPrintedPageNumberFromCorners(pdfDoc, p, totalPages);
    if (printedNum !== null) {
      const offset = p - printedNum;
      const nextCount = (offsetVotes.get(offset) || 0) + 1;
      offsetVotes.set(offset, nextCount);

      // If the user's current page gave a clear corner page number, or 2 pages agree on the exact offset, lock it in immediately!
      if (p === preferredCurrentPage || nextCount >= 2) {
        saveCachedBookPageOffset(docKey, offset);
        return offset;
      }
    }
  }

  // If at least one sample page yielded a valid corner number, use the best offset vote
  if (offsetVotes.size > 0) {
    let bestOffset = 0;
    let bestCount = 0;
    for (const [off, cnt] of offsetVotes.entries()) {
      if (cnt > bestCount) {
        bestOffset = off;
        bestCount = cnt;
      }
    }
    saveCachedBookPageOffset(docKey, bestOffset);
    return bestOffset;
  }

  // 2. Fallback: Check cached OCR lines or Server AI if corner crops needed server vision
  const cachedOcr = await loadCachedOcrPages(docKey);
  const consensus = computePageOffsetFromLinesMap(cachedOcr, totalPages);
  if (consensus && consensus.distinctPages >= 2) {
    saveCachedBookPageOffset(docKey, consensus.offset);
    return consensus.offset;
  }

  const bodySamplePayload: Array<{
    page: number;
    lines: string[];
    imageBase64?: string;
    mimeType?: string;
  }> = [];

  for (const p of samplePages.slice(0, 3)) {
    const crops = await extractCornerNumberCropsFromPage(pdfDoc, p);
    if (crops.length > 0) {
      bodySamplePayload.push({
        page: p,
        lines: cachedOcr[p] || [],
        imageBase64: crops[0].dataUrl,
        mimeType: 'image/png',
      });
    }
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
 * section in its opening pages. Returns [] if the book has no Table of Contents.
 */
export async function recognizeAndCacheBookChapters(
  docKey: string,
  bookTitle: string,
  totalPages: number,
  pdfDoc?: pdfjsLib.PDFDocumentProxy,
  preferredCurrentPage = 1
): Promise<SmartBookChapter[]> {
  const existingChapters = loadCachedBookChapters(docKey);
  if (existingChapters.length > 0) {
    if (pdfDoc && loadCachedBookPageOffset(docKey) === null) {
      detectAndCacheBookPageOffset(docKey, bookTitle, totalPages, pdfDoc, preferredCurrentPage).catch(
        () => {}
      );
    }
    return existingChapters;
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

  if (frontPagesPayload.length === 0) return [];

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
      if (Array.isArray(data.chapters) && data.chapters.length > 0) {
        saveCachedBookChapters(docKey, data.chapters);
        return data.chapters;
      }
    }
  } catch {
    // ignore network error
  }

  if (pdfDoc && loadCachedBookPageOffset(docKey) === null) {
    detectAndCacheBookPageOffset(docKey, bookTitle, totalPages, pdfDoc, preferredCurrentPage).catch(
      () => {}
    );
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
