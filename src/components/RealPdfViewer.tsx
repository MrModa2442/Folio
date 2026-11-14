import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { createWorker, Worker as TesseractWorker } from 'tesseract.js';
import { PageBookmark, PageHighlightStroke } from '../types/library';
import {
  loadCachedOcrPages,
  saveCachedOcrPages,
  subscribeToOcrUpdates,
  loadCachedBookChapters,
  recognizeAndCacheBookChapters,
  subscribeToChapterUpdates,
  loadCachedBookPageOffset,
  saveCachedBookPageOffset,
  clearCachedBookPageOffset,
  detectAndCacheBookPageOffset,
  detectPrintedPageNumberFromCorners,
  subscribeToPageOffsetUpdates,
  normalizeDigitsToAsciiClient,
} from '../services/ocrCache';
import { upsertVocabularyItem } from '../services/vocabularyStore';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCw,
  Loader2,
  BookOpen,
  AlertCircle,
  RefreshCw,
  Crop,
  Highlighter,
  Search,
  Bookmark,
  ListTree,
  Undo2,
  Trash2,
  X,
  Sparkles,
  Languages,
  Check,
} from 'lucide-react';

// Configure the local worker script hosted in public/
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

interface PdfSearchBox {
  x: number; // normalized 0..1 of uncropped page width
  y: number; // normalized 0..1 of uncropped page height
  w: number;
  h: number;
}

interface PdfSearchHit {
  id: string;
  page: number;
  matchIndexOnPage: number;
  snippetBefore: string;
  snippetMatch: string;
  snippetAfter: string;
  boxes: PdfSearchBox[];
}

interface CachedPageItem {
  rawStr: string;
  normStr: string;
  normNoSpace: string;
  box: PdfSearchBox;
}

interface CachedPageText {
  page: number;
  items: CachedPageItem[];
  fullRawText: string;
  fullNormText: string;
}

/**
 * Normalizes Persian, Arabic, and Latin text so searches work reliably regardless of
 * Arabic vs Persian Yeh/Kaf, Presentation Forms (\uFB50-\uFEFF), ZWNJ (نیم‌فاصله), or diacritics.
 */
function normalizePdfTextForSearch(input: string, stripSpaces = false): string {
  if (!input) return '';
  const s = input
    .normalize('NFKC')
    // Unify Arabic/Persian Yeh variants
    .replace(/[\u064A\u0649\u0626\u06CC\uFBFD\uFBFE\uFBFF\uFEF1\uFEF2\uFEF3\uFEF4]/g, 'ی')
    // Unify Arabic/Persian Kaf variants
    .replace(/[\u0643\u06A9\uFB8E\uFB8F\uFB90\uFB91\uFED9\uFEDA\uFEDB\uFEDC]/g, 'ک')
    // Unify Heh / Teh Marbuta
    .replace(/[\u0629\u06C0\u06C1\u06D5]/g, 'ه')
    // Unify Alef variants
    .replace(/[\u0622\u0623\u0625\u0671]/g, 'ا')
    // Unify Waw variants
    .replace(/[\u0624]/g, 'و')
    // Remove harakat, tatweel, and directional/zero-width marks (ZWNJ, ZWJ, LRM, RLM)
    .replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    .toLowerCase();

  if (stripSpaces) {
    return s.replace(/\s+/g, '');
  }
  return s.replace(/\s+/g, ' ').trim();
}

function reverseRtlString(str: string): string {
  return Array.from(str).reverse().join('');
}

interface DictionaryEntryResult {
  word: string;
  pronunciation: string;
  partOfSpeech: string;
  persianMeaning: string;
  englishMeaning: string;
  contextExplanation: string;
  isAiEnhanced?: boolean;
}

interface PdfChapterItem {
  id: string;
  title: string;
  page: number;
  startPage: number;
  endPage: number;
  level: number;
  isBookPageNumber?: boolean;
}

interface RealPdfViewerProps {
  bookId?: string;
  bookTitle?: string;
  bookAuthor?: string;
  arrayBuffer: ArrayBuffer | null;
  initialPage?: number;
  onPageChange?: (page: number, totalPages: number) => void;
  paperTheme?: 'cream' | 'sepia' | 'night' | 'white';
  bookmarks?: PageBookmark[];
  onToggleBookmark?: (page: number, note?: string) => void;
  onUpdateBookmarkNote?: (bookmarkId: string, note: string) => void;
  onRemoveBookmark?: (bookmarkId: string) => void;
  highlights?: Record<number, PageHighlightStroke[]>;
  onUpdatePageHighlights?: (page: number, strokes: PageHighlightStroke[]) => void;
}

const HIGHLIGHT_COLORS = [
  { name: 'Yellow', hex: '#FACC15' },
  { name: 'Green', hex: '#4ADE80' },
  { name: 'Rose', hex: '#FB7185' },
  { name: 'Sky', hex: '#38BDF8' },
];

export const RealPdfViewer: React.FC<RealPdfViewerProps> = ({
  bookId,
  bookTitle,
  bookAuthor,
  arrayBuffer,
  initialPage = 1,
  onPageChange,
  paperTheme = 'cream',
  bookmarks = [],
  onToggleBookmark,
  onUpdateBookmarkNote,
  onRemoveBookmark,
  highlights = {},
  onUpdatePageHighlights,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.25);
  const [rotation, setRotation] = useState<number>(0);
  const [trimMargins, setTrimMargins] = useState<boolean>(false);
  const [isLoadingDoc, setIsLoadingDoc] = useState<boolean>(true);
  const [isPageRendering, setIsPageRendering] = useState<boolean>(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [pageRenderError, setPageRenderError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState<string>(String(initialPage));
  const [tapFeedback, setTapFeedback] = useState<'left' | 'right' | null>(null);

  // Highlighter state
  const [isHighlightMode, setIsHighlightMode] = useState<boolean>(false);
  const [highlightColor, setHighlightColor] = useState<string>('#FACC15');
  const activeStrokeRef = useRef<Array<{ x: number; y: number }> | null>(null);

  // In-PDF Full-Text Search + AI Page OCR Scanner state
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchScanProgress, setSearchScanProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [searchResults, setSearchResults] = useState<PdfSearchHit[]>([]);
  const [activeHitIndex, setActiveHitIndex] = useState<number>(0);
  const [showAllSearchHits, setShowAllSearchHits] = useState<boolean>(false);

  // AI OCR Page Scanner state
  const [isAiScanning, setIsAiScanning] = useState<boolean>(false);
  const [aiScanProgress, setAiScanProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [aiCachedPageCount, setAiCachedPageCount] = useState<number>(0);
  const [aiScanError, setAiScanError] = useState<string | null>(null);
  const ocrPagesMapRef = useRef<Record<number, string[]>>({});
  const aiScanAbortRef = useRef<number>(0);

  const pageTextCacheRef = useRef<Map<number, CachedPageText>>(new Map());
  const searchAbortRef = useRef<number>(0);
  const cropTransformRef = useRef<{
    offsetX: number;
    offsetY: number;
    scaleX: number;
    scaleY: number;
  }>({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 });

  // Bookmarks & Notes Drawer state
  const [isBookmarksDrawerOpen, setIsBookmarksDrawerOpen] = useState<boolean>(false);
  const [bookmarkNoteDraft, setBookmarkNoteDraft] = useState<string>('');

  // Table of Contents / Chapters Drawer state (only enabled when book has a real chapters section)
  const [isChaptersDrawerOpen, setIsChaptersDrawerOpen] = useState<boolean>(false);
  const [pdfChapters, setPdfChapters] = useState<PdfChapterItem[]>([]);
  const [hasEmbeddedOutline, setHasEmbeddedOutline] = useState<boolean>(false);
  const [isAiRecognizingChapters, setIsAiRecognizingChapters] = useState<boolean>(false);

  // Printed Book Page Number Calibration (pageOffset = pdfPage - printedBookPage, e.g. 15 - 10 = 5)
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [isCalibratingPageOffset, setIsCalibratingPageOffset] = useState<boolean>(false);
  const [isPageSyncPopoverOpen, setIsPageSyncPopoverOpen] = useState<boolean>(false);
  const [manualPrintedPageInput, setManualPrintedPageInput] = useState<string>('');

  // Instant On-Page Dictionary / Word Translator & Explainer state
  const [isDictionaryOpen, setIsDictionaryOpen] = useState<boolean>(false);
  const [dictQuery, setDictQuery] = useState<string>('');
  const [isDictLoading, setIsDictLoading] = useState<boolean>(false);
  const [isDictAiEnhancing, setIsDictAiEnhancing] = useState<boolean>(false);
  const [dictError, setDictError] = useState<string | null>(null);
  const [dictResult, setDictResult] = useState<DictionaryEntryResult | null>(null);
  const [dictHistory, setDictHistory] = useState<DictionaryEntryResult[]>([]);
  const [savedDictToPin, setSavedDictToPin] = useState<boolean>(false);

  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const rawPageDimensionsRef = useRef<{ width: number; height: number } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const currentBookmark = bookmarks.find(b => b.page === currentPage);
  const currentPageStrokes = highlights[currentPage] || [];
  const docCacheKey = bookId || (arrayBuffer ? `pdf_bytes_${arrayBuffer.byteLength}` : 'default_pdf');

  // Helper to convert any physical PDF page number (1..totalPages) to the Book's Printed Page Number
  const effectiveOffset = Math.max(0, pageOffset);
  const totalBookPages = Math.max(1, totalPages - effectiveOffset);
  const isFrontMatterPage = effectiveOffset > 0 && currentPage <= effectiveOffset;
  const currentBookPage = currentPage > effectiveOffset ? currentPage - effectiveOffset : currentPage;

  const formatBookPageNumber = useCallback(
    (pdfPage: number): string => {
      if (effectiveOffset > 0 && pdfPage <= effectiveOffset) {
        return `Intro ${pdfPage}`;
      }
      return String(pdfPage - effectiveOffset);
    },
    [effectiveOffset]
  );

  // Keep the toolbar page input box synchronized with the Printed Book Page Number (e.g. 1 when on PDF page 5, or 10 when on PDF page 15)
  useEffect(() => {
    if (isFrontMatterPage) {
      setPageInput(`Intro ${currentPage}`);
      setManualPrintedPageInput('');
    } else {
      setPageInput(String(currentBookPage));
      setManualPrintedPageInput(String(currentBookPage));
    }
  }, [currentBookPage, currentPage, isFrontMatterPage, effectiveOffset]);

  // Load PDF Document + Cached AI OCR pages & AI Chapters from IndexedDB/localStorage
  useEffect(() => {
    if (!arrayBuffer) return;

    let isMounted = true;
    setIsLoadingDoc(true);
    setDocError(null);
    setPageRenderError(null);
    pageTextCacheRef.current.clear();
    setSearchResults([]);
    setActiveHitIndex(0);
    aiScanAbortRef.current++;
    setIsAiScanning(false);
    setAiScanProgress(null);
    setIsChaptersDrawerOpen(false);

    loadCachedOcrPages(docCacheKey).then(cachedPages => {
      if (!isMounted) return;
      ocrPagesMapRef.current = cachedPages;
      setAiCachedPageCount(Object.keys(cachedPages).length);
      pageTextCacheRef.current.clear();
    });

    const cachedOffset = loadCachedBookPageOffset(docCacheKey);
    if (cachedOffset !== null) {
      setPageOffset(cachedOffset);
    } else {
      setPageOffset(0);
    }

    const cachedAiChapters = loadCachedBookChapters(docCacheKey);
    if (cachedAiChapters.length > 0) {
      setPdfChapters(cachedAiChapters);
      setHasEmbeddedOutline(true);
    } else {
      setPdfChapters([]);
      setHasEmbeddedOutline(false);
    }

    const unsubOcr = subscribeToOcrUpdates(detail => {
      if (!isMounted || detail.docKey !== docCacheKey) return;
      for (const item of detail.newPages) {
        ocrPagesMapRef.current[item.page] = item.lines;
        pageTextCacheRef.current.delete(item.page);
      }
      setAiCachedPageCount(detail.scannedCount);
    });

    const unsubChapters = subscribeToChapterUpdates(detail => {
      if (!isMounted || detail.docKey !== docCacheKey) return;
      if (detail.chapters.length > 0) {
        setPdfChapters(detail.chapters);
        setHasEmbeddedOutline(true);
        setIsAiRecognizingChapters(false);
      }
    });

    const unsubOffset = subscribeToPageOffsetUpdates(detail => {
      if (!isMounted || detail.docKey !== docCacheKey) return;
      setPageOffset(detail.pageOffset);
      setIsCalibratingPageOffset(false);
    });

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

    loadingTask.promise
      .then(async doc => {
        if (!isMounted) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        const start = Math.max(1, Math.min(doc.numPages, initialPage || 1));
        setCurrentPage(start);
        setIsLoadingDoc(false);

        // 1. Immediately calibrate the printed book page number offset (so PDF page 15 matches Book page 10)
        if (loadCachedBookPageOffset(docCacheKey) === null) {
          setIsCalibratingPageOffset(true);
          detectAndCacheBookPageOffset(
            docCacheKey,
            bookTitle || 'Book',
            doc.numPages,
            doc,
            start
          )
            .then(detected => {
              if (!isMounted) return;
              setPageOffset(detected);
            })
            .finally(() => {
              if (isMounted) setIsCalibratingPageOffset(false);
            });
        }

        const existingAiCh = loadCachedBookChapters(docCacheKey);
        if (existingAiCh.length > 0) {
          setPdfChapters(existingAiCh);
          setHasEmbeddedOutline(true);
          return;
        }

        // 2. Analyze the opening pages for a Table of Contents / Chapters section.
        // If the book's first pages do NOT contain a Table of Contents, pdfChapters remains [] and the Chapters button stays disabled.
        setIsAiRecognizingChapters(true);
        recognizeAndCacheBookChapters(
          docCacheKey,
          bookTitle || 'Book',
          doc.numPages,
          doc,
          start
        )
          .then(aiCh => {
            if (!isMounted) return;
            if (aiCh.length > 0) {
              setPdfChapters(aiCh);
              setHasEmbeddedOutline(true);
            } else {
              setPdfChapters([]);
              setHasEmbeddedOutline(false);
            }
          })
          .finally(() => {
            if (isMounted) setIsAiRecognizingChapters(false);
          });
      })
      .catch(err => {
        console.error('PDF.js failed to load document:', err);
        if (!isMounted) return;
        setDocError(err?.message || 'Could not parse or load the PDF document.');
        setIsLoadingDoc(false);
      });

    return () => {
      isMounted = false;
      unsubOcr();
      unsubChapters();
      unsubOffset();
      aiScanAbortRef.current++;
      try {
        loadingTask.destroy();
      } catch {
        // ignore
      }
    };
  }, [arrayBuffer, docCacheKey, bookTitle]);

  // Fast 4-corner page number check (top-right, top-left, bottom-right, bottom-left) when viewing a page
  useEffect(() => {
    if (!pdfDoc || currentPage < 3 || isCalibratingPageOffset) return;
    const cached = loadCachedBookPageOffset(docCacheKey);
    if (cached !== null && cached !== 0) return;

    let cancelled = false;
    setIsCalibratingPageOffset(true);
    detectPrintedPageNumberFromCorners(pdfDoc, currentPage, totalPages)
      .then(printedNum => {
        if (cancelled) return;
        if (printedNum !== null) {
          const detectedOffset = currentPage - printedNum;
          saveCachedBookPageOffset(docCacheKey, detectedOffset);
          setPageOffset(detectedOffset);
          return;
        }
        if (cached === null && currentPage >= 5) {
          return detectAndCacheBookPageOffset(
            docCacheKey,
            bookTitle || 'Book',
            totalPages,
            pdfDoc,
            currentPage
          ).then(detected => {
            if (!cancelled) setPageOffset(detected);
          });
        }
      })
      .finally(() => {
        if (!cancelled) setIsCalibratingPageOffset(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, currentPage, docCacheKey, bookTitle, totalPages, isCalibratingPageOffset]);

  // Draw highlighter strokes AND active search match boxes on the transparent overlay canvas
  const drawHighlightOverlay = useCallback(
    (extraPoints?: Array<{ x: number; y: number }> | null) => {
      const overlay = overlayCanvasRef.current;
      const baseCanvas = canvasRef.current;
      if (!overlay || !baseCanvas) return;

      overlay.width = baseCanvas.width;
      overlay.height = baseCanvas.height;
      overlay.style.width = baseCanvas.style.width;
      overlay.style.height = baseCanvas.style.height;

      const ctx = overlay.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, overlay.width, overlay.height);

      // 1. Draw Search Match Bounding Boxes on current page
      if (isSearchOpen && searchResults.length > 0) {
        const pageHits = searchResults.filter(h => h.page === currentPage);
        const activeHit = searchResults[activeHitIndex];
        const { offsetX, offsetY, scaleX, scaleY } = cropTransformRef.current;

        for (const hit of pageHits) {
          const isCurrentActiveHit = activeHit && activeHit.id === hit.id;
          for (const box of hit.boxes) {
            const adjX = (box.x - offsetX) * scaleX;
            const adjY = (box.y - offsetY) * scaleY;
            const adjW = box.w * scaleX;
            const adjH = box.h * scaleY;

            const px = adjX * overlay.width;
            const py = adjY * overlay.height;
            const pw = Math.max(18, adjW * overlay.width);
            const ph = Math.max(14, adjH * overlay.height);

            ctx.save();
            ctx.fillStyle = isCurrentActiveHit
              ? 'rgba(29, 185, 84, 0.42)'
              : 'rgba(250, 204, 21, 0.30)';
            ctx.strokeStyle = isCurrentActiveHit ? '#1DB954' : '#FACC15';
            ctx.lineWidth = isCurrentActiveHit ? 3 : 1.5;

            const padX = 4;
            const padY = 3;
            ctx.beginPath();
            ctx.roundRect(px - padX, py - padY, pw + padX * 2, ph + padY * 2, 4);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // 2. Draw user Apple Pencil / finger highlighter strokes
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const allStrokes: PageHighlightStroke[] = [
        ...(highlights[currentPage] || []),
        ...(extraPoints && extraPoints.length > 1
          ? [{ color: highlightColor, points: extraPoints }]
          : []),
      ];

      for (const stroke of allStrokes) {
        if (!stroke.points || stroke.points.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = stroke.color;
        ctx.globalAlpha = 0.36;
        ctx.lineWidth = Math.max(14, overlay.width * 0.022);
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x * overlay.width, stroke.points[0].y * overlay.height);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x * overlay.width, stroke.points[i].y * overlay.height);
        }
        ctx.stroke();
        ctx.restore();
      }
    },
    [highlights, currentPage, highlightColor, isSearchOpen, searchResults, activeHitIndex]
  );

  // Render Page onto Canvas (with optional Auto-Crop White Margins)
  const renderCurrentPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;

    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {
        // ignore
      }
      renderTaskRef.current = null;
    }

    try {
      setIsPageRendering(true);
      setPageRenderError(null);

      const page = await pdfDoc.getPage(currentPage);
      const canvas = canvasRef.current;
      if (!canvas) return;

      const unscaledViewport = page.getViewport({ scale: 1, rotation });
      rawPageDimensionsRef.current = {
        width: unscaledViewport.width,
        height: unscaledViewport.height,
      };

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const effectiveScale = trimMargins ? scale * 1.18 : scale;
      const viewport = page.getViewport({ scale: effectiveScale * pixelRatio, rotation });

      // Render to an offscreen canvas first if trimMargins is enabled so we can crop white borders
      const workCanvas = trimMargins ? document.createElement('canvas') : canvas;
      workCanvas.width = Math.floor(viewport.width);
      workCanvas.height = Math.floor(viewport.height);

      const context = workCanvas.getContext('2d', { willReadFrequently: trimMargins });
      if (!context) {
        throw new Error('Could not get 2D canvas context');
      }

      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, workCanvas.width, workCanvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';

      const task = page.render({
        canvas: workCanvas,
        canvasContext: context,
        viewport,
      });
      renderTaskRef.current = task;
      await task.promise;

      if (trimMargins) {
        const w = workCanvas.width;
        const h = workCanvas.height;
        const imgData = context.getImageData(0, 0, w, h).data;

        let minX = w;
        let minY = h;
        let maxX = 0;
        let maxY = 0;
        const step = Math.max(2, Math.floor(pixelRatio * 2));

        for (let y = 0; y < h; y += step) {
          for (let x = 0; x < w; x += step) {
            const idx = (y * w + x) * 4;
            const r = imgData[idx];
            const g = imgData[idx + 1];
            const b = imgData[idx + 2];
            if (r < 242 || g < 242 || b < 242) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        const pad = Math.round(18 * pixelRatio);
        if (maxX > minX && maxY > minY) {
          const cropX = Math.max(0, minX - pad);
          const cropY = Math.max(0, minY - pad);
          const cropW = Math.min(w - cropX, maxX - minX + pad * 2);
          const cropH = Math.min(h - cropY, maxY - minY + pad * 2);

          cropTransformRef.current = {
            offsetX: cropX / w,
            offsetY: cropY / h,
            scaleX: w / cropW,
            scaleY: h / cropH,
          };

          canvas.width = cropW;
          canvas.height = cropH;
          canvas.style.width = `${Math.floor(cropW / pixelRatio)}px`;
          canvas.style.height = `${Math.floor(cropH / pixelRatio)}px`;

          const destCtx = canvas.getContext('2d');
          if (destCtx) {
            destCtx.fillStyle = '#FFFFFF';
            destCtx.fillRect(0, 0, cropW, cropH);
            destCtx.drawImage(workCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
          }
        } else {
          cropTransformRef.current = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
          canvas.width = w;
          canvas.height = h;
          canvas.style.width = `${Math.floor(w / pixelRatio)}px`;
          canvas.style.height = `${Math.floor(h / pixelRatio)}px`;
          const destCtx = canvas.getContext('2d');
          destCtx?.drawImage(workCanvas, 0, 0);
        }
      } else {
        cropTransformRef.current = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
        canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`;
      }

      drawHighlightOverlay(null);
      setIsPageRendering(false);
    } catch (err: unknown) {
      const isCancelled = (err as { name?: string })?.name === 'RenderingCancelledException';
      if (!isCancelled) {
        console.error('PDF page rendering error:', err);
        setPageRenderError((err as Error)?.message || 'Failed to render page.');
      }
      setIsPageRendering(false);
    }
  }, [pdfDoc, currentPage, scale, rotation, trimMargins, drawHighlightOverlay]);

  useEffect(() => {
    renderCurrentPage();
  }, [renderCurrentPage]);

  useEffect(() => {
    drawHighlightOverlay(null);
  }, [highlights, currentPage, isSearchOpen, searchResults, activeHitIndex, drawHighlightOverlay]);

  // Page turns (goToPage takes physical PDF page 1..totalPages; goToBookPageInput takes printed book page number)
  const goToPage = useCallback(
    (pageNum: number, scrollRatioY?: number) => {
      if (!pdfDoc) return;
      const clamped = Math.max(1, Math.min(totalPages, pageNum));
      setCurrentPage(clamped);
      if (onPageChange) {
        onPageChange(clamped, totalPages);
      }
      if (containerRef.current) {
        if (typeof scrollRatioY === 'number' && canvasRef.current) {
          setTimeout(() => {
            if (!containerRef.current || !canvasRef.current) return;
            const canvasH = canvasRef.current.clientHeight || 800;
            const targetScroll = Math.max(
              0,
              scrollRatioY * canvasH - containerRef.current.clientHeight * 0.35
            );
            containerRef.current.scrollTo({ top: targetScroll, behavior: 'smooth' });
          }, 60);
        } else {
          containerRef.current.scrollTop = 0;
        }
      }
    },
    [pdfDoc, totalPages, onPageChange]
  );

  // Navigate by Printed Book Page Number (supports Persian ۱۰, Arabic ١٠, and English 10 digits)
  const goToBookPageInput = useCallback(
    (rawInput: string) => {
      const normalized = normalizeDigitsToAsciiClient(rawInput || '').trim();
      const parsed = parseInt(normalized.replace(/[^\d-]/g, ''), 10);
      if (!Number.isFinite(parsed)) {
        setPageInput(String(currentBookPage));
        return;
      }
      if (parsed <= 0) {
        // Allow jumping to front-matter pages if 0 or negative
        goToPage(Math.max(1, Math.min(totalPages, effectiveOffset + parsed)));
        return;
      }
      const targetPdfPage = Math.max(1, Math.min(totalPages, parsed + effectiveOffset));
      goToPage(targetPdfPage);
    },
    [currentBookPage, effectiveOffset, goToPage, totalPages]
  );

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) {
      setTapFeedback('left');
      setTimeout(() => setTapFeedback(null), 220);
      goToPage(currentPage - 1);
    }
  }, [currentPage, goToPage]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      setTapFeedback('right');
      setTimeout(() => setTapFeedback(null), 220);
      goToPage(currentPage + 1);
    }
  }, [currentPage, totalPages, goToPage]);

  // Highlighter pointer handlers on overlay canvas
  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height))),
    };
  };

  const handleOverlayPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isHighlightMode) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getNormalizedPoint(e);
    activeStrokeRef.current = [pt];
  };

  const handleOverlayPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isHighlightMode || !activeStrokeRef.current) return;
    e.stopPropagation();
    const pt = getNormalizedPoint(e);
    activeStrokeRef.current.push(pt);
    drawHighlightOverlay(activeStrokeRef.current);
  };

  const handleOverlayPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isHighlightMode || !activeStrokeRef.current) return;
    e.stopPropagation();
    const pts = activeStrokeRef.current;
    activeStrokeRef.current = null;
    if (pts.length > 1 && onUpdatePageHighlights) {
      const updated = [...currentPageStrokes, { color: highlightColor, points: pts }];
      onUpdatePageHighlights(currentPage, updated);
    } else {
      drawHighlightOverlay(null);
    }
  };

  // Tap Left / Right side of book or Swipe to turn pages (when not in Highlighter mode)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isHighlightMode) return;
    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now(),
    };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isHighlightMode) return;
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || !containerRef.current) return;

    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('textarea')) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const elapsed = Date.now() - start.time;

    // 1. Horizontal swipe gesture (iPad / touch)
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8 && elapsed < 500) {
      if (dx < 0) {
        handleNextPage();
      } else {
        handlePrevPage();
      }
      return;
    }

    // 2. Clean click/tap: ONLY trigger when clicking in the brown sides outside the PDF page itself
    if (Math.abs(dx) < 14 && Math.abs(dy) < 14 && elapsed < 450) {
      if (target.closest('[data-pdf-page-surface="true"]')) {
        return;
      }

      if (canvasRef.current) {
        const pageRect = canvasRef.current.getBoundingClientRect();
        // Ignore clicks that fall within the horizontal bounds of the page
        if (e.clientX >= pageRect.left && e.clientX <= pageRect.right) {
          return;
        }
        if (e.clientX < pageRect.left) {
          handlePrevPage();
        } else if (e.clientX > pageRect.right) {
          handleNextPage();
        }
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      if (relX <= 0.25) {
        handlePrevPage();
      } else if (relX >= 0.75) {
        handleNextPage();
      }
    }
  };

  // Render a single PDF page offscreen to a lightweight JPEG data URL for Gemini Flash-Lite OCR
  const renderPageToJpegBase64 = useCallback(
    async (pageNum: number): Promise<string | null> => {
      if (!pdfDoc) return null;
      try {
        const page = await pdfDoc.getPage(pageNum);
        const vp = page.getViewport({ scale: 0.9, rotation });
        const offCanvas = document.createElement('canvas');
        offCanvas.width = Math.max(1, Math.floor(vp.width));
        offCanvas.height = Math.max(1, Math.floor(vp.height));
        const ctx = offCanvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, offCanvas.width, offCanvas.height);
        await page.render({
          canvas: offCanvas,
          canvasContext: ctx,
          viewport: vp,
        }).promise;
        return offCanvas.toDataURL('image/jpeg', 0.68);
      } catch (err) {
        console.warn(`Failed to render page ${pageNum} for OCR:`, err);
        return null;
      }
    },
    [pdfDoc, rotation]
  );

  // Extract and cache page text (combining AI-scanned OCR lines + native PDF text)
  const getOrExtractPageText = useCallback(
    async (pageNum: number): Promise<CachedPageText | null> => {
      if (!pdfDoc) return null;
      const cached = pageTextCacheRef.current.get(pageNum);
      if (cached) return cached;

      const items: Array<
        CachedPageItem & {
          rtlNormStr: string;
          rtlNormNoSpace: string;
          isAiOcr?: boolean;
          glyphs: Array<{
            rawStr: string;
            normStr: string;
            normNoSpace: string;
            box: PdfSearchBox;
          }>;
        }
      > = [];

      // 1. First, if AI OCR has scanned this page, convert its lines into clean searchable line items
      const aiLines = ocrPagesMapRef.current[pageNum];
      if (Array.isArray(aiLines) && aiLines.length > 0) {
        const totalAiLines = aiLines.length;
        aiLines.forEach((rawLine, idx) => {
          const cleanLine = (rawLine || '').replace(/\s+/g, ' ').trim();
          if (!cleanLine) return;
          const normStr = normalizePdfTextForSearch(cleanLine, false);
          const normNoSpace = normalizePdfTextForSearch(cleanLine, true);
          if (!normStr && !normNoSpace) return;

          const approxY = 0.06 + ((idx + 0.35) / Math.max(1, totalAiLines)) * 0.86;
          const approxH = Math.max(0.024, Math.min(0.06, 0.84 / Math.max(8, totalAiLines)));

          items.push({
            rawStr: cleanLine,
            normStr,
            normNoSpace,
            rtlNormStr: normStr,
            rtlNormNoSpace: normNoSpace,
            isAiOcr: true,
            box: {
              x: 0.07,
              y: Math.max(0.02, Math.min(0.94, approxY)),
              w: 0.86,
              h: approxH,
            },
            glyphs: [],
          });
        });
      }

      // 2. Also extract native PDF text items (when the PDF has an embedded text layer)
      const page = await pdfDoc.getPage(pageNum);
      const vp = page.getViewport({ scale: 1, rotation });
      const pageW = Math.max(1, vp.width);
      const pageH = Math.max(1, vp.height);
      const content = await page.getTextContent();

      interface RawGlyphItem {
        str: string;
        x: number;
        y: number;
        w: number;
        h: number;
      }

      const rawGlyphs: RawGlyphItem[] = [];
      for (const rawIt of content.items) {
        const it = rawIt as {
          str?: string;
          transform?: number[];
          width?: number;
          height?: number;
        };
        const str = it.str || '';
        if (!str.trim()) continue;

        const tx = it.transform ? it.transform[4] : 0;
        const ty = it.transform ? it.transform[5] : 0;
        const fontH =
          it.height || (it.transform ? Math.hypot(it.transform[2], it.transform[3]) : 12) || 12;
        const fontW = it.width || Math.max(8, str.length * (fontH * 0.48));

        const p1 = vp.convertToViewportPoint(tx, ty);
        const p2 = vp.convertToViewportPoint(tx + fontW, ty + fontH);
        const minX = Math.min(p1[0], p2[0]);
        const maxX = Math.max(p1[0], p2[0]);
        const minY = Math.min(p1[1], p2[1]);
        const maxY = Math.max(p1[1], p2[1]);

        rawGlyphs.push({
          str,
          x: Math.max(0, Math.min(1, minX / pageW)),
          y: Math.max(0, Math.min(1, minY / pageH)),
          w: Math.max(0.01, Math.min(1, (maxX - minX) / pageW)),
          h: Math.max(0.012, Math.min(1, (maxY - minY) / pageH)),
        });
      }

      // Only add native PDF lines if AI OCR hasn't already provided clean lines for this page
      if (!aiLines || aiLines.length === 0) {
        const lines: RawGlyphItem[][] = [];
        for (const g of rawGlyphs) {
          const existingLine = lines.find(
            line => Math.abs(line[0].y - g.y) <= Math.max(0.01, line[0].h * 0.65)
          );
          if (existingLine) {
            existingLine.push(g);
          } else {
            lines.push([g]);
          }
        }

        lines.sort((a, b) => a[0].y - b[0].y);

        for (const line of lines) {
          const lineRaw = line.map(g => g.str).join(' ').replace(/\s+/g, ' ').trim();
          const lineCompact = line.map(g => g.str).join('');

          const rtlSorted = [...line].sort((a, b) => b.x - a.x);
          const rtlRaw = rtlSorted.map(g => g.str).join(' ').replace(/\s+/g, ' ').trim();
          const rtlCompact = rtlSorted.map(g => g.str).join('');

          const minX = Math.min(...line.map(g => g.x));
          const maxX = Math.max(...line.map(g => g.x + g.w));
          const minY = Math.min(...line.map(g => g.y));
          const maxY = Math.max(...line.map(g => g.y + g.h));

          const normStr = normalizePdfTextForSearch(lineRaw, false);
          const normNoSpace = normalizePdfTextForSearch(lineCompact, true);
          const rtlNormStr = normalizePdfTextForSearch(rtlRaw, false);
          const rtlNormNoSpace = normalizePdfTextForSearch(rtlCompact, true);

          const isRtlLine = /[\u0600-\u06FF\uFB50-\uFEFF]/.test(lineRaw);
          const displayRaw =
            isRtlLine && !lineRaw.includes(' ') && rtlRaw.includes(' ') ? rtlRaw : lineRaw;

          if (normStr || normNoSpace) {
            items.push({
              rawStr: displayRaw,
              normStr,
              normNoSpace,
              rtlNormStr,
              rtlNormNoSpace,
              box: {
                x: minX,
                y: minY,
                w: Math.max(0.02, maxX - minX),
                h: Math.max(0.016, maxY - minY),
              },
              glyphs: line.map(g => ({
                rawStr: g.str,
                normStr: normalizePdfTextForSearch(g.str, false),
                normNoSpace: normalizePdfTextForSearch(g.str, true),
                box: { x: g.x, y: g.y, w: g.w, h: g.h },
              })),
            });
          }
        }
      }

      const fullRawText = items.map(i => i.rawStr).join(' ');
      const fullNormText = items.map(i => i.normStr).join(' ');

      const result: CachedPageText = {
        page: pageNum,
        items,
        fullRawText,
        fullNormText,
      };
      pageTextCacheRef.current.set(pageNum, result);
      return result;
    },
    [pdfDoc, rotation]
  );

  // Match helper on a single page's CachedPageText
  const findMatchesInPageData = useCallback(
    (pageData: CachedPageText, rawQuery: string): PdfSearchHit[] => {
      const qNorm = normalizePdfTextForSearch(rawQuery, false);
      const qNoSpace = normalizePdfTextForSearch(rawQuery, true);
      const qReversed = reverseRtlString(qNorm);
      const qReversedNoSpace = reverseRtlString(qNoSpace);
      const queryTokens = qNorm.split(/\s+/).filter(Boolean);

      if (!qNorm) return [];

      const pageHits: PdfSearchHit[] = [];
      let pageMatchIdx = 0;
      const p = pageData.page;

      for (let lineIdx = 0; lineIdx < pageData.items.length; lineIdx++) {
        const lineItem = pageData.items[lineIdx] as CachedPageItem & {
          rtlNormStr?: string;
          rtlNormNoSpace?: string;
          glyphs?: Array<{
            rawStr: string;
            normStr: string;
            normNoSpace: string;
            box: PdfSearchBox;
          }>;
        };

        const matchedSpaced =
          lineItem.normStr.includes(qNorm) ||
          (lineItem.rtlNormStr && lineItem.rtlNormStr.includes(qNorm)) ||
          (qReversed.length >= 2 && lineItem.normStr.includes(qReversed));

        const matchedCompact =
          !matchedSpaced &&
          qNoSpace.length >= 2 &&
          (lineItem.normNoSpace.includes(qNoSpace) ||
            (lineItem.rtlNormNoSpace && lineItem.rtlNormNoSpace.includes(qNoSpace)) ||
            lineItem.normNoSpace.includes(qReversedNoSpace));

        if (matchedSpaced || matchedCompact) {
          let wordBoxes: PdfSearchBox[] = [];
          if (lineItem.glyphs && lineItem.glyphs.length > 0) {
            for (const g of lineItem.glyphs) {
              if (!g.normNoSpace) continue;
              const glyphMatches =
                g.normStr.includes(qNorm) ||
                g.normNoSpace.includes(qNoSpace) ||
                (qReversedNoSpace.length >= 2 && g.normNoSpace.includes(qReversedNoSpace)) ||
                queryTokens.some(
                  tok =>
                    tok.length >= 2 && (g.normStr.includes(tok) || g.normNoSpace.includes(tok))
                );
              if (glyphMatches) {
                wordBoxes.push(g.box);
              }
            }
          }

          if (wordBoxes.length === 0) {
            wordBoxes = [lineItem.box];
          }

          const prevLine = lineIdx > 0 ? pageData.items[lineIdx - 1].rawStr : '';
          const nextLine =
            lineIdx + 1 < pageData.items.length ? pageData.items[lineIdx + 1].rawStr : '';

          pageHits.push({
            id: `p${p}_m${pageMatchIdx++}_l${lineIdx}`,
            page: p,
            matchIndexOnPage: pageMatchIdx,
            snippetBefore: prevLine ? `${prevLine.slice(-40)} ` : '',
            snippetMatch: lineItem.rawStr,
            snippetAfter: nextLine ? ` ${nextLine.slice(0, 45)}` : '',
            boxes: wordBoxes,
          });
        }
      }

      return pageHits;
    },
    []
  );

  const selectSearchHit = useCallback(
    (index: number, resultsList: PdfSearchHit[] = searchResults) => {
      if (resultsList.length === 0) return;
      const wrapped = ((index % resultsList.length) + resultsList.length) % resultsList.length;
      setActiveHitIndex(wrapped);
      const hit = resultsList[wrapped];
      const firstBoxY = hit.boxes[0]?.y;
      goToPage(hit.page, firstBoxY);
    },
    [searchResults, goToPage]
  );

  const tesseractWorkerRef = useRef<Promise<TesseractWorker> | null>(null);

  const getOrInitTesseractWorker = useCallback(async (): Promise<TesseractWorker> => {
    if (!tesseractWorkerRef.current) {
      tesseractWorkerRef.current = createWorker(['fas', 'eng']);
    }
    return tesseractWorkerRef.current;
  }, []);

  // Background Page Scanner using Server Gemini OCR (/api/ocr) with automatic Built-in Browser OCR (Tesseract fas+eng) fallback
  const startAiPageScanner = useCallback(
    async (activeQueryForLiveMatch = searchQuery, scanOnlyUnscanned = true) => {
      if (!pdfDoc) return;
      const scanId = ++aiScanAbortRef.current;
      setIsAiScanning(true);
      setAiScanError(null);

      const total = pdfDoc.numPages;
      // Order pages starting from currentPage outward so nearby pages are scanned first
      const orderedPages: number[] = [];
      for (let offset = 0; offset < total; offset++) {
        const forward = currentPage + offset;
        if (forward >= 1 && forward <= total) orderedPages.push(forward);
        const backward = currentPage - offset;
        if (offset > 0 && backward >= 1 && backward <= total) orderedPages.push(backward);
      }

      const pagesToScan = scanOnlyUnscanned
        ? orderedPages.filter(p => !ocrPagesMapRef.current[p] || ocrPagesMapRef.current[p].length === 0)
        : orderedPages;

      if (pagesToScan.length === 0) {
        setIsAiScanning(false);
        setAiScanProgress(null);
        return;
      }

      let scannedSoFar = Object.keys(ocrPagesMapRef.current).length;
      setAiScanProgress({ scanned: scannedSoFar, total });
      let jumpedToFirstAiHit = false;
      let useLocalBrowserOcr = false;

      try {
        const batchSize = 3;
        for (let i = 0; i < pagesToScan.length; i += batchSize) {
          if (aiScanAbortRef.current !== scanId) return;
          const batchPageNums = pagesToScan.slice(i, i + batchSize);

          const renderedPages: Array<{ page: number; imageBase64: string; mimeType: string }> = [];
          for (const pNum of batchPageNums) {
            if (aiScanAbortRef.current !== scanId) return;
            const b64 = await renderPageToJpegBase64(pNum);
            if (b64) {
              renderedPages.push({ page: pNum, imageBase64: b64, mimeType: 'image/jpeg' });
            }
          }

          if (renderedPages.length === 0) continue;

          let pageResults: Array<{ page: number; lines: string[]; error?: string }> = [];

          if (!useLocalBrowserOcr) {
            try {
              const response = await fetch('/api/ocr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pages: renderedPages }),
              });

              if (response.ok) {
                const data = (await response.json()) as {
                  results?: Array<{ page: number; lines: string[]; error?: string }>;
                  useClientOcr?: boolean;
                };
                if (data.useClientOcr) {
                  useLocalBrowserOcr = true;
                } else {
                  pageResults = data.results || [];
                }
              } else {
                useLocalBrowserOcr = true;
              }
            } catch {
              useLocalBrowserOcr = true;
            }
          }

          if (useLocalBrowserOcr) {
            const worker = await getOrInitTesseractWorker();
            for (const rp of renderedPages) {
              if (aiScanAbortRef.current !== scanId) return;
              const rec = await worker.recognize(rp.imageBase64);
              const rawText = rec?.data?.text || '';
              const lines = rawText
                .split(/\r?\n/)
                .map(l => l.trim())
                .filter(Boolean);
              pageResults.push({ page: rp.page, lines });
            }
          }

          if (aiScanAbortRef.current !== scanId) return;

          const newEntries: Array<{ page: number; lines: string[] }> = [];
          for (const res of pageResults) {
            if (Array.isArray(res.lines)) {
              ocrPagesMapRef.current[res.page] = res.lines;
              pageTextCacheRef.current.delete(res.page);
              newEntries.push({ page: res.page, lines: res.lines });
            }
          }

          if (newEntries.length > 0) {
            await saveCachedOcrPages(docCacheKey, newEntries);
            scannedSoFar = Object.keys(ocrPagesMapRef.current).length;
            setAiCachedPageCount(scannedSoFar);
            setAiScanProgress({ scanned: scannedSoFar, total });

            // If user has a search query open, live-check the newly scanned pages immediately!
            const qClean = normalizePdfTextForSearch(activeQueryForLiveMatch, false);
            if (qClean) {
              const newlyFoundHits: PdfSearchHit[] = [];
              for (const entry of newEntries) {
                const updatedPageData = await getOrExtractPageText(entry.page);
                if (updatedPageData) {
                  const pHits = findMatchesInPageData(updatedPageData, activeQueryForLiveMatch);
                  newlyFoundHits.push(...pHits);
                }
              }

              if (newlyFoundHits.length > 0) {
                setSearchResults(prev => {
                  const filteredPrev = prev.filter(
                    oldHit => !newEntries.some(ne => ne.page === oldHit.page)
                  );
                  const combined = [...filteredPrev, ...newlyFoundHits].sort(
                    (a, b) => a.page - b.page || a.matchIndexOnPage - b.matchIndexOnPage
                  );
                  if (!jumpedToFirstAiHit && prev.length === 0 && combined.length > 0) {
                    jumpedToFirstAiHit = true;
                    const firstHit = combined[0];
                    setTimeout(() => {
                      goToPage(firstHit.page, firstHit.boxes[0]?.y);
                    }, 20);
                  }
                  return combined;
                });
              }
            }
          }
        }
      } catch (err) {
        console.error('Page Scanner error:', err);
        if (aiScanAbortRef.current === scanId) {
          setAiScanError(err instanceof Error ? err.message : 'Page scan encountered an error');
        }
      } finally {
        if (aiScanAbortRef.current === scanId) {
          setIsAiScanning(false);
          setAiScanProgress(null);
        }
      }
    },
    [
      pdfDoc,
      currentPage,
      searchQuery,
      docCacheKey,
      renderPageToJpegBase64,
      getOrExtractPageText,
      findMatchesInPageData,
      goToPage,
      getOrInitTesseractWorker,
    ]
  );

  // Full-text search inside the open PDF with automatic OCR fallback for scanned image PDFs
  const executePdfSearch = useCallback(
    async (rawQuery: string) => {
      const qNorm = normalizePdfTextForSearch(rawQuery, false);

      if (!pdfDoc || !qNorm) {
        setSearchResults([]);
        setActiveHitIndex(0);
        setIsSearching(false);
        setSearchScanProgress(null);
        return;
      }

      const searchId = ++searchAbortRef.current;
      setIsSearching(true);
      const hits: PdfSearchHit[] = [];
      const total = pdfDoc.numPages;
      let pagesWithSelectableText = 0;

      try {
        for (let p = 1; p <= total; p++) {
          if (searchAbortRef.current !== searchId) return;
          if (p % 8 === 0 || p === total) {
            setSearchScanProgress({ scanned: p, total });
            await new Promise(r => setTimeout(r, 0));
          }

          const pageData = await getOrExtractPageText(p);
          if (!pageData || pageData.items.length === 0) continue;
          pagesWithSelectableText++;

          const pageHits = findMatchesInPageData(pageData, rawQuery);
          if (pageHits.length > 0) {
            hits.push(...pageHits);
            if (hits.length >= 120) break;
          }
        }

        if (searchAbortRef.current !== searchId) return;
        setSearchResults(hits);

        if (hits.length > 0) {
          const nearIdx = hits.findIndex(h => h.page >= currentPage);
          const initialIdx = nearIdx >= 0 ? nearIdx : 0;
          setActiveHitIndex(initialIdx);
          const targetHit = hits[initialIdx];
          goToPage(targetHit.page, targetHit.boxes[0]?.y);
        } else {
          setActiveHitIndex(0);
          // Only auto-start OCR page scanning if this PDF is mostly scanned images without embedded text!
          const alreadyScannedCount = Object.keys(ocrPagesMapRef.current).length;
          const isMostlyScannedImagePdf = pagesWithSelectableText < Math.max(3, Math.floor(total * 0.15));
          if (isMostlyScannedImagePdf && alreadyScannedCount < total && !isAiScanning) {
            startAiPageScanner(rawQuery, true);
          }
        }
      } catch (searchErr) {
        console.warn('PDF text search error:', searchErr);
      } finally {
        if (searchAbortRef.current === searchId) {
          setIsSearching(false);
          setSearchScanProgress(null);
        }
      }
    },
    [
      pdfDoc,
      getOrExtractPageText,
      findMatchesInPageData,
      currentPage,
      goToPage,
      isAiScanning,
      startAiPageScanner,
    ]
  );

  const handleRunPdfSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      searchResults.length > 0 &&
      normalizePdfTextForSearch(searchQuery) !== '' &&
      !isSearching
    ) {
      selectSearchHit(activeHitIndex + 1);
      return;
    }
    executePdfSearch(searchQuery);
  };

  const dictCacheMapRef = useRef<Map<string, DictionaryEntryResult>>(new Map());
  const dictInflightMapRef = useRef<Map<string, Promise<DictionaryEntryResult>>>(new Map());
  const activeLookupWordRef = useRef<string>('');

  const fetchDictEntryFast = useCallback(
    async (
      cleanTerm: string,
      mode: 'instant' | 'ai' = 'ai'
    ): Promise<DictionaryEntryResult> => {
      const baseKey = cleanTerm.toLowerCase();
      const cached = dictCacheMapRef.current.get(baseKey);
      if (cached && (mode === 'instant' || cached.isAiEnhanced)) {
        return cached;
      }

      const inflightKey = `${mode}:${baseKey}`;
      const existingPromise = dictInflightMapRef.current.get(inflightKey);
      if (existingPromise) return existingPromise;

      const syncCachedText =
        pageTextCacheRef.current.get(currentPage)?.fullRawText ||
        (ocrPagesMapRef.current[currentPage] || []).join(' ') ||
        '';

      const promise = (async () => {
        try {
          const res = await fetch('/api/dictionary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              term: cleanTerm,
              bookTitle,
              bookAuthor,
              pageContext: syncCachedText.slice(0, 600),
              mode,
            }),
          });
          const data = (await res.json()) as { result?: DictionaryEntryResult; error?: string };
          if (!res.ok || !data.result) {
            throw new Error(data.error || 'Could not define or translate this word.');
          }
          const currentCached = dictCacheMapRef.current.get(baseKey);
          if (!currentCached || !currentCached.isAiEnhanced || data.result.isAiEnhanced) {
            dictCacheMapRef.current.set(baseKey, data.result);
          }
          return data.result;
        } finally {
          dictInflightMapRef.current.delete(inflightKey);
        }
      })();

      dictInflightMapRef.current.set(inflightKey, promise);
      return promise;
    },
    [currentPage, bookTitle, bookAuthor]
  );

  // Auto-prefetch / progressive lookup after 240ms of typing so both instant and deep AI meanings are ready
  useEffect(() => {
    if (!isDictionaryOpen) return;
    const clean = dictQuery.trim();
    if (clean.length < 2) return;
    const timer = setTimeout(() => {
      const key = clean.toLowerCase();
      const cached = dictCacheMapRef.current.get(key);
      if (cached?.isAiEnhanced) {
        setDictResult(prev => (dictQuery.trim() === clean ? cached : prev));
        return;
      }

      // Stage 1: Instant bilingual preview (~150ms)
      fetchDictEntryFast(clean, 'instant')
        .then(instantRes => {
          setDictResult(prev => {
            if (dictQuery.trim() !== clean) return prev;
            // Don't overwrite if the full AI result already arrived
            if (prev && prev.word.toLowerCase() === key && prev.isAiEnhanced) return prev;
            return instantRes;
          });
        })
        .catch(() => {});

      // Stage 2: Strong Gemini 3.8 Flash literary & lexicographical analysis
      setIsDictAiEnhancing(true);
      fetchDictEntryFast(clean, 'ai')
        .then(aiRes => {
          setDictResult(prev => (dictQuery.trim() === clean ? aiRes : prev));
        })
        .catch(() => {})
        .finally(() => {
          if (dictQuery.trim() === clean) {
            setIsDictAiEnhancing(false);
          }
        });
    }, 240);
    return () => clearTimeout(timer);
  }, [dictQuery, isDictionaryOpen, fetchDictEntryFast]);

  // Look up a word or phrase in the Instant On-Page Dictionary (/api/dictionary) with two-stage progressive AI
  const handleDictionaryLookup = async (termToLookup: string) => {
    const cleanTerm = termToLookup.trim();
    if (!cleanTerm) return;
    const key = cleanTerm.toLowerCase();
    activeLookupWordRef.current = key;
    setDictQuery(cleanTerm);
    setDictError(null);
    setSavedDictToPin(false);

    const cached = dictCacheMapRef.current.get(key);
    if (cached?.isAiEnhanced) {
      setDictResult(cached);
      setIsDictAiEnhancing(false);
      return;
    }

    setIsDictLoading(true);
    setIsDictAiEnhancing(true);

    // Fire both Instant (~150ms) and Strong AI (Gemini 3.8 Flash) concurrently
    const instantPromise = fetchDictEntryFast(cleanTerm, 'instant');
    const aiPromise = fetchDictEntryFast(cleanTerm, 'ai');

    instantPromise
      .then(instantResult => {
        if (activeLookupWordRef.current !== key) return;
        setDictResult(prev => {
          if (prev && prev.word.toLowerCase() === key && prev.isAiEnhanced) return prev;
          return instantResult;
        });
        setIsDictLoading(false);
      })
      .catch(() => {});

    try {
      const aiResult = await aiPromise;
      if (activeLookupWordRef.current !== key) return;
      setDictResult(aiResult);
      setDictHistory(prev => {
        const filtered = prev.filter(
          item => item.word.toLowerCase() !== aiResult.word.toLowerCase()
        );
        return [aiResult, ...filtered].slice(0, 8);
      });
      // Automatically save looked-up word to the user's Saved Vocabulary Bank (Local + Cloud SQL)
      upsertVocabularyItem({
        word: aiResult.word || cleanTerm,
        pronunciation: aiResult.pronunciation || '',
        partOfSpeech: aiResult.partOfSpeech || '',
        persianMeaning: aiResult.persianMeaning || '',
        englishMeaning: aiResult.englishMeaning || '',
        contextExplanation: aiResult.contextExplanation || '',
        bookId,
        bookTitle: bookTitle || 'General Reading',
        page: currentPage,
      });
    } catch (err) {
      if (activeLookupWordRef.current !== key) return;
      // Only show error if instant fallback also failed
      const fallback = dictCacheMapRef.current.get(key);
      if (!fallback) {
        setDictError(err instanceof Error ? err.message : 'Dictionary lookup failed.');
      } else {
        upsertVocabularyItem({
          word: fallback.word || cleanTerm,
          pronunciation: fallback.pronunciation || '',
          partOfSpeech: fallback.partOfSpeech || '',
          persianMeaning: fallback.persianMeaning || '',
          englishMeaning: fallback.englishMeaning || '',
          contextExplanation: fallback.contextExplanation || '',
          bookId,
          bookTitle: bookTitle || 'General Reading',
          page: currentPage,
        });
      }
    } finally {
      if (activeLookupWordRef.current === key) {
        setIsDictLoading(false);
        setIsDictAiEnhancing(false);
      }
    }
  };

  const handleSaveDefinitionToPageNote = () => {
    if (!dictResult) return;
    upsertVocabularyItem({
      word: dictResult.word,
      pronunciation: dictResult.pronunciation || '',
      partOfSpeech: dictResult.partOfSpeech,
      persianMeaning: dictResult.persianMeaning,
      englishMeaning: dictResult.englishMeaning,
      contextExplanation: dictResult.contextExplanation,
      bookId,
      bookTitle: bookTitle || 'General Reading',
      page: currentPage,
    });

    if (onToggleBookmark) {
      const summaryNote = `${dictResult.word} (${dictResult.partOfSpeech}): ${dictResult.persianMeaning} | ${dictResult.englishMeaning}`;
      const existingNote = currentBookmark?.note ? `${currentBookmark.note}\n• ${summaryNote}` : `• ${summaryNote}`;
      if (currentBookmark && onUpdateBookmarkNote) {
        onUpdateBookmarkNote(currentBookmark.id, existingNote);
      } else {
        onToggleBookmark(currentPage, existingNote);
      }
    }

    setSavedDictToPin(true);
    setTimeout(() => setSavedDictToPin(false), 2500);
  };

  // Zoom presets
  const handleFitWidth = () => {
    if (!containerRef.current || !rawPageDimensionsRef.current) return;
    const containerWidth = containerRef.current.clientWidth - 48;
    const targetScale = Math.max(0.5, Math.min(2.5, containerWidth / rawPageDimensionsRef.current.width));
    setScale(parseFloat(targetScale.toFixed(2)));
  };

  const handleFitPage = () => {
    if (!containerRef.current || !rawPageDimensionsRef.current) return;
    const containerHeight = containerRef.current.clientHeight - 48;
    const targetScale = Math.max(0.5, Math.min(2.5, containerHeight / rawPageDimensionsRef.current.height));
    setScale(parseFloat(targetScale.toFixed(2)));
  };

  // Keyboard navigation + Ctrl/Cmd+F shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
        setIsBookmarksDrawerOpen(false);
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        handleNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        handlePrevPage();
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToPage(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        goToPage(totalPages);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNextPage, handlePrevPage, goToPage, totalPages]);

  const getThemeFilter = () => {
    switch (paperTheme) {
      case 'sepia':
        return 'sepia(42%) brightness(95%) contrast(103%)';
      case 'cream':
        return 'sepia(18%) brightness(98%)';
      case 'night':
        return 'invert(92%) hue-rotate(180deg) brightness(92%) contrast(108%)';
      default:
        return 'none';
    }
  };

  const highlightedPageNumbers = Object.keys(highlights)
    .map(Number)
    .filter(p => (highlights[p] || []).length > 0)
    .sort((a, b) => a - b);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden select-none relative">
      {/* Primary Reader Toolbar */}
      <div className="min-h-10 px-3 sm:px-4 py-1.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 bg-black/40 shrink-0 text-xs">
        {/* Left: Page Switcher (Matched to Printed Book Page Numbers) */}
        <div className="flex items-center gap-1 relative">
          {effectiveOffset > 0 && (
            <button
              onClick={() => goToPage(1)}
              disabled={currentPage <= 1}
              className={`hidden md:inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                isFrontMatterPage
                  ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                  : 'opacity-70 hover:opacity-100 hover:bg-white/10 disabled:opacity-30'
              }`}
              title="Go to Cover / Opening Intro Pages"
            >
              Cover
            </button>
          )}

          <button
            onClick={() => goToPage(1 + effectiveOffset)}
            disabled={currentPage === 1 + effectiveOffset}
            className="hidden sm:inline-flex px-1.5 py-0.5 rounded text-[11px] opacity-70 hover:opacity-100 hover:bg-white/10 disabled:opacity-30 transition-colors"
            title="Book Page 1"
          >
            1
          </button>

          <button
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"
            title="Previous page"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <form
            onSubmit={e => {
              e.preventDefault();
              goToBookPageInput(pageInput);
            }}
            className="flex items-center gap-1 font-mono"
          >
            {isFrontMatterPage && (
              <button
                type="button"
                onClick={() => goToPage(1 + effectiveOffset)}
                className="px-1.5 py-0.5 rounded bg-[#1DB954]/20 hover:bg-[#1DB954]/30 text-[#1DB954] border border-[#1DB954]/40 text-[10px] font-sans font-semibold transition-colors"
                title={`Jump to Book Page 1 (starts on PDF page ${effectiveOffset + 1})`}
              >
                Page 1 →
              </button>
            )}
            <input
              type="text"
              dir="auto"
              value={pageInput}
              onChange={e => setPageInput(e.target.value)}
              onBlur={() => goToBookPageInput(pageInput)}
              title="Book Page Number (matches the page number written in the book itself)"
              className="w-14 text-center py-0.5 rounded border border-white/20 bg-white text-black text-xs font-semibold focus:outline-hidden focus:ring-1 focus:ring-[#1DB954]"
            />
            <span
              className="opacity-60 text-xs"
              title={
                effectiveOffset > 0
                  ? `${totalBookPages} numbered book pages (${totalPages} total PDF pages including ${effectiveOffset} intro pages)`
                  : `${totalBookPages} pages`
              }
            >
              / {totalBookPages}
            </span>
          </form>

          <button
            onClick={handleNextPage}
            disabled={currentPage >= totalPages}
            className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"
            title="Next page"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            onClick={() => goToPage(totalPages)}
            disabled={currentPage >= totalPages}
            className="hidden sm:inline-flex px-1.5 py-0.5 rounded text-[11px] opacity-70 hover:opacity-100 hover:bg-white/10 disabled:opacity-30 transition-colors"
            title="Last book page"
          >
            {totalBookPages}
          </button>

          {/* Book Page Number Calibration Badge & 1-Click Manual Match Popover */}
          <button
            type="button"
            onClick={() => {
              setManualPrintedPageInput(String(currentBookPage));
              setIsPageSyncPopoverOpen(v => !v);
            }}
            className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-colors border ${
              effectiveOffset > 0
                ? 'bg-[#1DB954]/15 border-[#1DB954]/40 text-[#1DB954] hover:bg-[#1DB954]/25'
                : isCalibratingPageOffset
                ? 'bg-amber-400/15 border-amber-400/40 text-amber-300'
                : 'bg-white/10 border-white/15 text-white/80 hover:bg-white/20 hover:text-white'
            }`}
            title="Match PDF page number to the exact page number written on this page of the book"
          >
            {isCalibratingPageOffset ? (
              <>
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                <span className="hidden lg:inline">Syncing #</span>
              </>
            ) : effectiveOffset > 0 ? (
              <>
                <Check className="w-2.5 h-2.5" />
                <span className="hidden lg:inline">Book # Synced</span>
              </>
            ) : (
              <span>Match Book #</span>
            )}
          </button>

          {isPageSyncPopoverOpen && (
            <div className="absolute left-0 top-9 z-40 w-72 bg-[#181818] text-white border border-[#383838] rounded-xl shadow-2xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#1DB954]">
                  Match Printed Book Page #
                </span>
                <button
                  type="button"
                  onClick={() => setIsPageSyncPopoverOpen(false)}
                  className="p-0.5 rounded hover:bg-white/10 text-[#B3B3B3] hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-[#B3B3B3] leading-relaxed">
                Look at the page number written on this page of the book (e.g. <span className="text-white font-mono">10</span> or <span className="text-white font-mono">۱۰</span>) and enter it below so every page in this book matches:
              </p>
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const norm = normalizeDigitsToAsciiClient(manualPrintedPageInput || '').trim();
                  const printedNum = parseInt(norm, 10);
                  if (Number.isFinite(printedNum) && printedNum >= 1 && printedNum <= totalPages) {
                    const newOffset = currentPage - printedNum;
                    saveCachedBookPageOffset(docCacheKey, newOffset);
                    setPageOffset(newOffset);
                    setIsPageSyncPopoverOpen(false);
                  }
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  dir="auto"
                  value={manualPrintedPageInput}
                  onChange={e => setManualPrintedPageInput(e.target.value)}
                  placeholder="e.g. 10 or ۱۰"
                  className="w-24 text-center py-1.5 px-2 rounded-lg bg-[#242424] border border-[#383838] text-white font-mono text-xs font-bold focus:outline-hidden focus:border-[#1DB954]"
                  autoFocus
                />
                <button
                  type="submit"
                  className="flex-1 py-1.5 px-3 rounded-lg bg-[#1DB954] text-black font-bold text-xs hover:bg-[#1ed760]"
                >
                  Match Page #
                </button>
              </form>
              <div className="flex items-center justify-between pt-1 border-t border-white/10 text-[10px] text-[#B3B3B3]">
                <span>
                  PDF p.{currentPage} → Book p.{currentBookPage}
                </span>
                <div className="flex items-center gap-2">
                  {pdfDoc && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCalibratingPageOffset(true);
                        detectAndCacheBookPageOffset(
                          docCacheKey,
                          bookTitle || 'Book',
                          totalPages,
                          pdfDoc,
                          currentPage,
                          true
                        )
                          .then(detected => {
                            setPageOffset(detected);
                            setIsPageSyncPopoverOpen(false);
                          })
                          .finally(() => setIsCalibratingPageOffset(false));
                      }}
                      className="text-amber-300 hover:underline"
                    >
                      Auto-Detect
                    </button>
                  )}
                  {effectiveOffset !== 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        clearCachedBookPageOffset(docCacheKey);
                        setPageOffset(0);
                        setIsPageSyncPopoverOpen(false);
                      }}
                      className="text-rose-400 hover:underline"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Center: Smart Reading Tools (Trim Margins, Bookmark, Highlighter, Search PDF) */}
        <div className="flex items-center gap-1.5">
          {/* Auto-Crop White Margins Toggle */}
          <button
            type="button"
            onClick={() => setTrimMargins(v => !v)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 transition-colors ${
              trimMargins
                ? 'bg-[#1DB954] text-black'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title="Auto-crop empty white margins around the text"
          >
            <Crop className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Trim Margins</span>
          </button>

          {/* Pin / Bookmark Current Page */}
          {onToggleBookmark && (
            <button
              type="button"
              onClick={() => onToggleBookmark(currentPage)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                currentBookmark
                  ? 'bg-amber-400 text-black'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
              title={currentBookmark ? 'Page bookmarked (tap to remove)' : 'Bookmark this page'}
            >
              <Bookmark className={`w-3.5 h-3.5 ${currentBookmark ? 'fill-current' : ''}`} />
              <span className="hidden sm:inline">{currentBookmark ? 'Pinned' : 'Pin Page'}</span>
            </button>
          )}

          {/* Open Table of Contents / Chapters Drawer (enabled only if the book has a Chapters / Table of Contents section) */}
          <button
            type="button"
            disabled={pdfChapters.length === 0}
            onClick={() => {
              if (pdfChapters.length === 0) return;
              setIsChaptersDrawerOpen(v => !v);
              setIsBookmarksDrawerOpen(false);
              setIsSearchOpen(false);
              setIsDictionaryOpen(false);
            }}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 transition-colors ${
              pdfChapters.length === 0
                ? 'bg-white/5 text-white/35 cursor-not-allowed opacity-50'
                : isChaptersDrawerOpen
                ? 'bg-[#1DB954] text-black'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title={
              pdfChapters.length > 0
                ? `Open Chapters (${pdfChapters.length} chapters detected)`
                : isAiRecognizingChapters
                ? 'Checking opening pages for a Table of Contents...'
                : 'No Table of Contents / Chapters section found in this book'
            }
          >
            <ListTree className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Chapters</span>
          </button>

          {/* Open Bookmarks & Notes Drawer */}
          <button
            type="button"
            onClick={() => {
              setIsBookmarksDrawerOpen(v => !v);
              setIsChaptersDrawerOpen(false);
              setIsSearchOpen(false);
            }}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 transition-colors ${
              isBookmarksDrawerOpen
                ? 'bg-white text-black'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title="View all pinned pages & highlights"
          >
            <span>Pins ({bookmarks.length + highlightedPageNumbers.length})</span>
          </button>

          {/* Apple Pencil / Finger Highlighter Toggle */}
          <button
            type="button"
            onClick={() => setIsHighlightMode(v => !v)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 transition-colors ${
              isHighlightMode
                ? 'bg-yellow-400 text-black'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title="Draw or highlight directly on the page"
          >
            <Highlighter className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Highlight</span>
          </button>

          {/* Search Inside PDF Toggle */}
          <button
            type="button"
            onClick={() => {
              setIsSearchOpen(v => !v);
              setIsBookmarksDrawerOpen(false);
              setIsChaptersDrawerOpen(false);
              setIsDictionaryOpen(false);
            }}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 transition-colors ${
              isSearchOpen
                ? 'bg-[#1DB954] text-black'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title="Search text inside this PDF"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Find in PDF</span>
          </button>

          {/* Instant On-Page Dictionary / Word Translator & Explainer Toggle */}
          <button
            type="button"
            onClick={() => {
              setIsDictionaryOpen(v => !v);
              setIsBookmarksDrawerOpen(false);
              setIsChaptersDrawerOpen(false);
            }}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 transition-colors ${
              isDictionaryOpen
                ? 'bg-sky-400 text-black'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title="Instant On-Page Dictionary, Word Translator & Literary Explainer"
          >
            <Languages className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Dictionary</span>
          </button>
        </div>

        {/* Right: Zoom Controls & Fit Presets */}
        <div className="flex items-center gap-1 sm:gap-2">
          <div className="hidden lg:flex items-center gap-1 border-r border-white/10 pr-2">
            <button
              onClick={handleFitWidth}
              className="px-2 py-0.5 rounded hover:bg-white/10 text-[11px] transition-colors flex items-center gap-1"
              title="Fit to screen width"
            >
              <Maximize2 className="w-3 h-3 opacity-70" />
              <span>Width</span>
            </button>
            <button
              onClick={handleFitPage}
              className="px-2 py-0.5 rounded hover:bg-white/10 text-[11px] transition-colors flex items-center gap-1"
              title="Fit entire page in view"
            >
              <Minimize2 className="w-3 h-3 opacity-70" />
              <span>Page</span>
            </button>
            <button
              onClick={() => setRotation(r => (r + 90) % 360)}
              className="p-1 rounded hover:bg-white/10 text-[11px] transition-colors"
              title="Rotate 90 degrees"
            >
              <RotateCw className="w-3 h-3 opacity-70" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setScale(s => Math.max(0.5, parseFloat((s - 0.15).toFixed(2))))}
              className="p-1 rounded hover:bg-white/10 transition-colors"
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            <span className="font-mono text-[11px] opacity-75 w-10 text-center">
              {Math.round(scale * 100)}%
            </span>

            <button
              onClick={() => setScale(s => Math.min(2.5, parseFloat((s + 0.15).toFixed(2))))}
              className="p-1 rounded hover:bg-white/10 transition-colors"
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Secondary Highlighter Palette Strip (when Highlighter is active) */}
      {isHighlightMode && (
        <div className="px-4 py-1.5 bg-black/75 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-yellow-300">
              Highlighter Active (draw with finger or Apple Pencil):
            </span>
            <div className="flex items-center gap-1.5">
              {HIGHLIGHT_COLORS.map(c => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setHighlightColor(c.hex)}
                  className={`w-5 h-5 rounded-full border transition-transform ${
                    highlightColor === c.hex ? 'scale-125 ring-2 ring-white' : 'border-white/30'
                  }`}
                  style={{ backgroundColor: c.hex }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {currentPageStrokes.length > 0 && onUpdatePageHighlights && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    onUpdatePageHighlights(currentPage, currentPageStrokes.slice(0, -1))
                  }
                  className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-[11px] flex items-center gap-1"
                >
                  <Undo2 className="w-3 h-3" />
                  <span>Undo</span>
                </button>
                <button
                  type="button"
                  onClick={() => onUpdatePageHighlights(currentPage, [])}
                  className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 text-[11px] flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear Page</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setIsHighlightMode(false)}
              className="px-2.5 py-1 rounded bg-white text-black font-semibold text-[11px]"
            >
              Done Drawing
            </button>
          </div>
        </div>
      )}

      {/* Non-Blocking Top Search Bar with AI Page Scanner, On-Page Highlighting & Prev/Next Stepper */}
      {isSearchOpen && (
        <div className="bg-[#181818] text-white border-b border-[#333333] px-3 sm:px-4 py-2 shrink-0 z-20 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <form onSubmit={handleRunPdfSearch} className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px] max-w-2xl">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 opacity-50 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  dir="auto"
                  value={searchQuery}
                  onChange={e => {
                    const val = e.target.value;
                    setSearchQuery(val);
                    if (!val.trim()) {
                      searchAbortRef.current++;
                      setSearchResults([]);
                      setActiveHitIndex(0);
                      setIsSearching(false);
                    }
                  }}
                  placeholder="Type a word or phrase and press Find..."
                  className="w-full text-xs pl-8 pr-7 py-1.5 rounded-lg bg-[#242424] border border-[#383838] text-white focus:outline-hidden focus:border-[#1DB954]"
                  autoFocus
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      searchAbortRef.current++;
                      setSearchQuery('');
                      setSearchResults([]);
                      setActiveHitIndex(0);
                      setIsSearching(false);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#B3B3B3] hover:text-white"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => executePdfSearch(searchQuery)}
                disabled={isSearching || !searchQuery.trim()}
                className="px-3.5 py-1.5 rounded-lg bg-[#1DB954] text-black font-bold text-xs hover:bg-[#1ed760] disabled:opacity-50 shrink-0"
              >
                {isSearching
                  ? searchScanProgress
                    ? `${searchScanProgress.scanned}/${searchScanProgress.total}`
                    : 'Scanning...'
                  : 'Find'}
              </button>

              {/* AI Page Scanner Button (Gemini Flash-Lite OCR) */}
              {isAiScanning ? (
                <button
                  type="button"
                  onClick={() => {
                    aiScanAbortRef.current++;
                    setIsAiScanning(false);
                    setAiScanProgress(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-400/20 border border-amber-400/50 text-amber-300 font-semibold text-xs flex items-center gap-1.5 hover:bg-amber-400/30 shrink-0"
                  title="Stop AI page scanning"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>
                    AI Reading {aiScanProgress ? `${aiScanProgress.scanned}/${aiScanProgress.total}` : '...'} (Stop)
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    startAiPageScanner(searchQuery, aiCachedPageCount < totalPages)
                  }
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 ${
                    aiCachedPageCount >= totalPages
                      ? 'bg-[#1DB954]/15 border-[#1DB954]/40 text-[#1DB954] hover:bg-[#1DB954]/25'
                      : 'bg-[#242424] border-[#383838] text-amber-300 hover:bg-[#2E2E2E]'
                  }`}
                  title="Use lightweight AI OCR (Gemini Flash-Lite) to scan pages and index every word"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {aiCachedPageCount >= totalPages
                      ? `AI Indexed (${totalPages}/${totalPages})`
                      : `AI Scan Pages (${aiCachedPageCount}/${totalPages})`}
                  </span>
                </button>
              )}
            </form>

            {/* Match Counter + Prev / Next Match Buttons */}
            <div className="flex items-center gap-2">
              {searchResults.length > 0 ? (
                <>
                  <span className="text-xs font-mono text-[#1DB954] font-semibold px-2 py-1 rounded bg-[#1DB954]/10">
                    Match {activeHitIndex + 1} of {searchResults.length} · p.{' '}
                    {searchResults[activeHitIndex]
                      ? formatBookPageNumber(searchResults[activeHitIndex].page)
                      : ''}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => selectSearchHit(activeHitIndex - 1)}
                      className="px-2.5 py-1 rounded-lg bg-[#282828] hover:bg-[#383838] text-xs font-semibold flex items-center gap-1"
                      title="Previous match"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Prev</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => selectSearchHit(activeHitIndex + 1)}
                      className="px-2.5 py-1 rounded-lg bg-[#282828] hover:bg-[#383838] text-xs font-semibold flex items-center gap-1"
                      title="Next match"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowAllSearchHits(v => !v)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                      showAllSearchHits
                        ? 'bg-white text-black border-white'
                        : 'bg-[#242424] border-[#383838] text-[#B3B3B3] hover:text-white'
                    }`}
                  >
                    {showAllSearchHits ? 'Hide List' : `All (${searchResults.length})`}
                  </button>
                </>
              ) : isAiScanning ? (
                <span className="text-xs text-amber-300 font-medium flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>
                    AI scanning pages for &ldquo;{searchQuery.trim()}&rdquo; (
                    {aiScanProgress ? `${aiScanProgress.scanned}/${aiScanProgress.total}` : '...'})
                  </span>
                </span>
              ) : (
                searchQuery.trim() &&
                !isSearching && (
                  <span className="text-xs text-amber-300 font-medium">
                    No matching text found
                  </span>
                )
              )}

              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen(false);
                  setShowAllSearchHits(false);
                }}
                className="p-1.5 rounded-lg hover:bg-white/10 text-[#B3B3B3] hover:text-white"
                title="Close search"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {aiScanError && (
            <div className="text-[11px] text-rose-400 flex items-center justify-between bg-rose-500/10 border border-rose-500/30 rounded-lg px-2.5 py-1">
              <span>{aiScanError}</span>
              <button
                type="button"
                onClick={() => setAiScanError(null)}
                className="text-rose-300 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Optional Expandable Match Snippets Drawer */}
          {showAllSearchHits && searchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 border-t border-white/10">
              {searchResults.map((hit, idx) => {
                const isSelected = idx === activeHitIndex;
                return (
                  <button
                    key={hit.id}
                    type="button"
                    onClick={() => selectSearchHit(idx)}
                    dir="auto"
                    className={`text-left p-2 rounded-lg text-xs transition-colors flex items-start justify-between gap-2 border ${
                      isSelected
                        ? 'bg-[#1DB954]/20 border-[#1DB954] text-white'
                        : 'bg-[#242424] border-transparent hover:bg-[#2E2E2E] text-white/85'
                    }`}
                  >
                    <span className="text-[11px] line-clamp-2 leading-relaxed">
                      <span className="opacity-60">{hit.snippetBefore}</span>
                      <span className="font-bold text-[#1DB954] underline decoration-[#1DB954]/60">
                        {hit.snippetMatch}
                      </span>
                      <span className="opacity-60">{hit.snippetAfter}</span>
                    </span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/50 text-[#1DB954] shrink-0">
                      p. {formatBookPageNumber(hit.page)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Instant On-Page Dictionary / Word Translator & Explainer Drawer */}
      {isDictionaryOpen && (
        <div className="w-full sm:w-96 sm:right-4 sm:top-12 sm:absolute z-30 bg-[#181818] text-white border border-[#333333] sm:rounded-2xl shadow-2xl p-4 space-y-3.5 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-sky-400/15 text-sky-400 flex items-center justify-center">
                <Languages className="w-3.5 h-3.5" />
              </span>
              <div>
                <h4 className="text-xs font-bold">On-Page Dictionary &amp; Explainer</h4>
                <p className="text-[10px] text-[#B3B3B3]">
                  Persian · Arabic · English · Page {formatBookPageNumber(currentPage)} Context
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsDictionaryOpen(false)}
              className="p-1 rounded-lg hover:bg-white/10 text-[#B3B3B3] hover:text-white"
              title="Close Dictionary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Word or Phrase Input Form */}
          <form
            onSubmit={e => {
              e.preventDefault();
              handleDictionaryLookup(dictQuery);
            }}
            className="flex items-center gap-1.5"
          >
            <input
              type="text"
              dir="auto"
              value={dictQuery}
              onChange={e => setDictQuery(e.target.value)}
              placeholder="Type a Persian, Arabic, or English word/phrase..."
              className="flex-1 text-xs px-3 py-2 rounded-lg bg-[#242424] border border-[#383838] text-white focus:outline-hidden focus:border-sky-400"
              autoFocus
            />
            <button
              type="submit"
              disabled={isDictLoading || !dictQuery.trim()}
              className="px-3.5 py-2 rounded-lg bg-sky-400 text-black font-bold text-xs hover:bg-sky-300 disabled:opacity-50 shrink-0 flex items-center gap-1"
            >
              {isDictLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>...</span>
                </>
              ) : (
                <span>Define</span>
              )}
            </button>
          </form>

          {dictError && (
            <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2.5">
              {dictError}
            </div>
          )}

          {/* Dictionary Definition & Translation Result Card */}
          {dictResult && (
            <div className="p-3.5 rounded-xl bg-[#242424] border border-sky-400/30 space-y-3">
              <div className="flex items-start justify-between gap-2 border-b border-white/10 pb-2.5">
                <div dir="auto">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h5 className="text-base font-bold text-white">{dictResult.word}</h5>
                    {dictResult.partOfSpeech && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-400/20 text-sky-300">
                        {dictResult.partOfSpeech}
                      </span>
                    )}
                  </div>
                  {dictResult.pronunciation && (
                    <p className="text-[11px] font-mono text-[#B3B3B3] mt-0.5">
                      {dictResult.pronunciation}
                    </p>
                  )}
                </div>

                {onToggleBookmark && (
                  <button
                    type="button"
                    onClick={handleSaveDefinitionToPageNote}
                    className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-400/20 text-amber-300 hover:bg-amber-400 hover:text-black transition-colors flex items-center gap-1 shrink-0"
                    title={`Save this word definition to Page ${formatBookPageNumber(currentPage)} notes`}
                  >
                    {savedDictToPin ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Saved!</span>
                      </>
                    ) : (
                      <>
                        <Bookmark className="w-3 h-3" />
                        <span>Pin to p.{formatBookPageNumber(currentPage)}</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Persian Meaning */}
              {dictResult.persianMeaning && (
                <div className="space-y-0.5" dir="rtl">
                  <div className="text-[10px] font-bold text-sky-400">معنی و توضیح فارسی:</div>
                  <p className="text-xs leading-relaxed text-white/95">
                    {dictResult.persianMeaning}
                  </p>
                </div>
              )}

              {/* English Meaning */}
              {dictResult.englishMeaning && (
                <div className="space-y-0.5" dir="ltr">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                    English Meaning:
                  </div>
                  <p className="text-xs leading-relaxed text-white/95">
                    {dictResult.englishMeaning}
                  </p>
                </div>
              )}

              {/* Literary / Page Context Explanation */}
              {dictResult.contextExplanation ? (
                <div className="p-2.5 rounded-lg bg-black/35 border border-white/5 space-y-1" dir="auto">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    <span>Literary &amp; Page Context</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-white/85">
                    {dictResult.contextExplanation}
                  </p>
                </div>
              ) : isDictAiEnhancing ? (
                <div className="px-2.5 py-2 rounded-lg bg-black/25 border border-white/5 flex items-center gap-2 text-[11px] text-amber-300/90">
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  <span>Analyzing deep meaning &amp; literary context with AI...</span>
                </div>
              ) : null}
            </div>
          )}

          {/* Session Lookup History */}
          {dictHistory.length > 1 && (
            <div className="pt-2 border-t border-white/10 space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[#B3B3B3] font-semibold">
                Recent Lookups
              </span>
              <div className="flex flex-wrap gap-1.5" dir="auto">
                {dictHistory.map(item => (
                  <button
                    key={item.word}
                    type="button"
                    onClick={() => {
                      setDictResult(item);
                      setDictQuery(item.word);
                    }}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                      dictResult?.word === item.word
                        ? 'bg-sky-400 text-black font-bold'
                        : 'bg-[#242424] text-[#B3B3B3] hover:text-white'
                    }`}
                  >
                    {item.word}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating Table of Contents / Chapters & Sections Drawer */}
      {isChaptersDrawerOpen && pdfChapters.length > 0 && (
        <div className="w-full sm:w-88 sm:left-4 sm:top-12 sm:absolute z-30 bg-[#181818] text-white border border-[#333333] sm:rounded-xl shadow-2xl p-3.5 space-y-3 max-h-[75vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div>
              <h4 className="text-xs font-bold flex items-center gap-1.5">
                <ListTree className="w-3.5 h-3.5 text-[#1DB954]" />
                <span>
                  {hasEmbeddedOutline
                    ? 'Table of Contents & Chapters'
                    : 'Book Chapters & Page Ranges'}
                </span>
              </h4>
              <p className="text-[10px] text-[#B3B3B3] mt-0.5">
                {isAiRecognizingChapters
                  ? 'Reading opening Table of Contents...'
                  : `${pdfChapters.length} chapters detected`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {pdfDoc && (
                <button
                  type="button"
                  disabled={isAiRecognizingChapters}
                  onClick={() => {
                    setIsAiRecognizingChapters(true);
                    try {
                      localStorage.removeItem(`folio_book_chapters_v4_${docCacheKey}`);
                    } catch {
                      // ignore
                    }
                    recognizeAndCacheBookChapters(
                      docCacheKey,
                      bookTitle || 'Book',
                      totalPages,
                      pdfDoc,
                      currentPage
                    )
                      .then(aiCh => {
                        if (aiCh.length > 0) {
                          setPdfChapters(aiCh);
                          setHasEmbeddedOutline(true);
                        }
                      })
                      .finally(() => setIsAiRecognizingChapters(false));
                  }}
                  className="p-1 rounded hover:bg-white/10 text-[#B3B3B3] hover:text-white disabled:opacity-40"
                  title="Re-scan opening Table of Contents"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isAiRecognizingChapters ? 'animate-spin text-[#1DB954]' : ''}`} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsChaptersDrawerOpen(false)}
                className="p-1 rounded hover:bg-white/10"
                title="Close Chapters"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="space-y-1">
            {isAiRecognizingChapters && (
              <div className="px-3 py-2 rounded-lg bg-[#242424] border border-amber-400/30 flex items-center gap-2 text-[11px] text-amber-300 mb-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>Reading the opening Table of Contents pages...</span>
              </div>
            )}

              {pdfChapters.map((ch, idx) => {
                const rawStart = ch.startPage || ch.page || 1;
                const nextChRawStart =
                  pdfChapters[idx + 1]?.startPage || pdfChapters[idx + 1]?.page;
                const rawEnd =
                  ch.endPage && ch.endPage >= rawStart
                    ? ch.endPage
                    : nextChRawStart && nextChRawStart > rawStart
                    ? nextChRawStart - 1
                    : ch.isBookPageNumber
                    ? totalBookPages
                    : totalPages;

                // If extracted from printed Table of Contents (isBookPageNumber), start/end are already Printed Book Pages
                const startBookPage = ch.isBookPageNumber
                  ? Math.max(1, Math.min(totalBookPages, rawStart))
                  : Math.max(1, rawStart - effectiveOffset);
                const endBookPage = ch.isBookPageNumber
                  ? Math.max(startBookPage, Math.min(totalBookPages, rawEnd))
                  : Math.max(startBookPage, rawEnd - effectiveOffset);

                const targetPdfPage = ch.isBookPageNumber
                  ? Math.max(1, Math.min(totalPages, startBookPage + effectiveOffset))
                  : Math.max(1, Math.min(totalPages, rawStart));

                const isCurrentSection =
                  !isFrontMatterPage &&
                  currentBookPage >= startBookPage &&
                  currentBookPage <= endBookPage;

                return (
                  <button
                    key={ch.id}
                    type="button"
                    dir="auto"
                    onClick={() => {
                      goToPage(targetPdfPage);
                      setIsChaptersDrawerOpen(false);
                    }}
                    style={{ paddingLeft: `${10 + ch.level * 12}px` }}
                    className={`w-full text-left py-2 pr-2.5 rounded-lg text-xs flex items-center justify-between gap-2 transition-colors ${
                      isCurrentSection
                        ? 'bg-[#1DB954]/20 border border-[#1DB954]/50 text-white font-semibold'
                        : 'bg-[#242424] hover:bg-[#2E2E2E] text-white/85'
                    }`}
                  >
                    <span className="truncate leading-snug">{ch.title}</span>
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                        isCurrentSection
                          ? 'bg-[#1DB954] text-black font-bold'
                          : 'bg-black/40 text-[#B3B3B3]'
                      }`}
                    >
                      {startBookPage === endBookPage
                        ? `p. ${startBookPage}`
                        : `p. ${startBookPage}–${endBookPage}`}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Floating Bookmarks, Pins & Page Notes Drawer */}
      {isBookmarksDrawerOpen && (
        <div className="w-full sm:w-80 sm:right-4 sm:top-12 sm:absolute z-30 bg-[#181818] text-white border border-[#333333] sm:rounded-xl shadow-2xl p-3.5 space-y-3 max-h-[75vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5 text-amber-400" />
              <span>Pinned Pages &amp; Notes</span>
            </h4>
            <button
              type="button"
              onClick={() => setIsBookmarksDrawerOpen(false)}
              className="p-1 rounded hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Add / Update Note for Current Page */}
          {onToggleBookmark && (
            <form
              onSubmit={e => {
                e.preventDefault();
                if (currentBookmark && onUpdateBookmarkNote) {
                  onUpdateBookmarkNote(currentBookmark.id, bookmarkNoteDraft.trim());
                } else {
                  onToggleBookmark(currentPage, bookmarkNoteDraft.trim());
                }
                setBookmarkNoteDraft('');
              }}
              className="p-2.5 rounded-lg bg-[#242424] space-y-2"
            >
              <p className="text-[11px] font-semibold text-amber-300">
                Page {formatBookPageNumber(currentPage)} {currentBookmark ? '(Pinned)' : ''}
              </p>
              <input
                type="text"
                value={bookmarkNoteDraft}
                onChange={e => setBookmarkNoteDraft(e.target.value)}
                placeholder={currentBookmark?.note || 'Add a note for this page...'}
                className="w-full text-xs px-2.5 py-1.5 rounded bg-[#181818] border border-[#383838] text-white focus:outline-hidden focus:border-amber-400"
              />
              <button
                type="submit"
                className="w-full py-1.5 rounded bg-amber-400 text-black font-semibold text-xs hover:bg-amber-300"
              >
                {currentBookmark
                  ? 'Save Note on Page ' + formatBookPageNumber(currentPage)
                  : 'Pin Page ' + formatBookPageNumber(currentPage) + ' with Note'}
              </button>
            </form>
          )}

          {/* Bookmarks List */}
          <div className="space-y-1.5">
            {bookmarks.length === 0 && highlightedPageNumbers.length === 0 ? (
              <p className="text-[11px] text-[#B3B3B3] text-center py-3">
                No pinned or highlighted pages yet. Tap &ldquo;Pin Page&rdquo; or &ldquo;Highlight&rdquo; while reading.
              </p>
            ) : (
              <>
                {bookmarks.map(bm => (
                  <div
                    key={bm.id}
                    onClick={() => goToPage(bm.page)}
                    className={`p-2.5 rounded-lg cursor-pointer flex items-start justify-between gap-2 transition-colors ${
                      currentPage === bm.page ? 'bg-amber-400/20 border border-amber-400/40' : 'bg-[#242424] hover:bg-[#2E2E2E]'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] font-bold text-amber-300">
                        Page {formatBookPageNumber(bm.page)}
                      </span>
                      {bm.note && <p className="text-xs text-white/90 mt-0.5 break-words">{bm.note}</p>}
                    </div>
                    {onRemoveBookmark && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          onRemoveBookmark(bm.id);
                        }}
                        className="p-1 rounded text-rose-400 hover:bg-rose-500/20"
                        title="Remove bookmark"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}

                {highlightedPageNumbers.length > 0 && (
                  <div className="pt-2 border-t border-white/10">
                    <p className="text-[10px] uppercase tracking-wider text-[#B3B3B3] mb-1.5">
                      Highlighted Pages
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {highlightedPageNumbers.map(pageNum => (
                        <button
                          key={pageNum}
                          type="button"
                          onClick={() => goToPage(pageNum)}
                          className={`px-2.5 py-1 rounded-full text-xs font-mono font-semibold ${
                            currentPage === pageNum
                              ? 'bg-yellow-400 text-black'
                              : 'bg-yellow-400/15 text-yellow-300 hover:bg-yellow-400/25'
                          }`}
                        >
                          p. {formatBookPageNumber(pageNum)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Main Canvas Container with Left/Right Tap-to-Turn Zones */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        className={`flex-1 overflow-auto p-3 sm:p-6 flex items-start justify-center relative ${
          isHighlightMode ? 'cursor-crosshair touch-none' : 'cursor-pointer'
        }`}
      >
        {/* Subtle Visual Left/Right Page Turn Feedback Pill */}
        {tapFeedback === 'left' && (
          <div className="fixed left-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-black/70 text-white flex items-center justify-center shadow-lg pointer-events-none">
            <ChevronLeft className="w-5 h-5 text-[#1DB954]" />
          </div>
        )}
        {tapFeedback === 'right' && (
          <div className="fixed right-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-black/70 text-white flex items-center justify-center shadow-lg pointer-events-none">
            <ChevronRight className="w-5 h-5 text-[#1DB954]" />
          </div>
        )}

        {isLoadingDoc && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-xs z-20">
            <div className="flex flex-col items-center gap-2 text-xs font-semibold">
              <Loader2 className="w-6 h-6 animate-spin text-[#1DB954]" />
              <span>Opening PDF pages...</span>
            </div>
          </div>
        )}

        {docError ? (
          <div className="p-8 text-center text-xs opacity-75 max-w-sm m-auto">
            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-50 text-rose-500" />
            <p className="font-semibold text-rose-400 mb-1 text-sm">Failed to read PDF</p>
            <p className="mb-4 opacity-70">{docError}</p>
          </div>
        ) : (
          <div
            data-pdf-page-surface="true"
            className={`relative shadow-2xl rounded-xs transition-all duration-200 ${
              isHighlightMode ? 'cursor-crosshair' : 'cursor-default'
            }`}
            style={{ filter: getThemeFilter() }}
          >
            {isPageRendering && (
              <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-xs text-white px-2.5 py-1 rounded text-[11px] font-mono flex items-center gap-1.5 z-10 shadow-md">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1DB954]" />
                <span>Page {formatBookPageNumber(currentPage)}...</span>
              </div>
            )}

            {pageRenderError && (
              <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-6 text-center text-xs z-10">
                <AlertCircle className="w-8 h-8 text-rose-400 mb-2" />
                <p className="font-semibold text-rose-300 mb-1">Rendering Notice</p>
                <p className="opacity-70 mb-3 max-w-xs">{pageRenderError}</p>
                <button
                  onClick={renderCurrentPage}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white font-semibold transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Retry Page</span>
                </button>
              </div>
            )}

            <canvas
              ref={canvasRef}
              className="block bg-white shadow-2xl transition-transform origin-top"
            />

            {/* Transparent Highlighter Overlay Canvas */}
            <canvas
              ref={overlayCanvasRef}
              onPointerDown={handleOverlayPointerDown}
              onPointerMove={handleOverlayPointerMove}
              onPointerUp={handleOverlayPointerUp}
              className={`absolute inset-0 ${
                isHighlightMode ? 'pointer-events-auto touch-none' : 'pointer-events-none'
              }`}
            />
          </div>
        )}
      </div>
    </div>
  );
};
