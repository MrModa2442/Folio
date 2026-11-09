import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PageBookmark, PageHighlightStroke } from '../types/library';
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
  Undo2,
  Trash2,
  X,
} from 'lucide-react';

// Configure the local worker script hosted in public/
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

interface PdfSearchHit {
  page: number;
  snippet: string;
}

interface RealPdfViewerProps {
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

  // In-PDF Full-Text Search state
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<PdfSearchHit[]>([]);

  // Bookmarks & Notes Drawer state
  const [isBookmarksDrawerOpen, setIsBookmarksDrawerOpen] = useState<boolean>(false);
  const [bookmarkNoteDraft, setBookmarkNoteDraft] = useState<string>('');

  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const rawPageDimensionsRef = useRef<{ width: number; height: number } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const currentBookmark = bookmarks.find(b => b.page === currentPage);
  const currentPageStrokes = highlights[currentPage] || [];

  // Load PDF Document
  useEffect(() => {
    if (!arrayBuffer) return;

    let isMounted = true;
    setIsLoadingDoc(true);
    setDocError(null);
    setPageRenderError(null);

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
      .then(doc => {
        if (!isMounted) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        const start = Math.max(1, Math.min(doc.numPages, initialPage || 1));
        setCurrentPage(start);
        setPageInput(String(start));
        setIsLoadingDoc(false);
      })
      .catch(err => {
        console.error('PDF.js failed to load document:', err);
        if (!isMounted) return;
        setDocError(err?.message || 'Could not parse or load the PDF document.');
        setIsLoadingDoc(false);
      });

    return () => {
      isMounted = false;
      try {
        loadingTask.destroy();
      } catch {
        // ignore
      }
    };
  }, [arrayBuffer]);

  // Draw highlighter strokes on the transparent overlay canvas
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
    [highlights, currentPage, highlightColor]
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
          canvas.width = w;
          canvas.height = h;
          canvas.style.width = `${Math.floor(w / pixelRatio)}px`;
          canvas.style.height = `${Math.floor(h / pixelRatio)}px`;
          const destCtx = canvas.getContext('2d');
          destCtx?.drawImage(workCanvas, 0, 0);
        }
      } else {
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
  }, [highlights, currentPage, drawHighlightOverlay]);

  // Page turns
  const goToPage = useCallback(
    (pageNum: number) => {
      if (!pdfDoc) return;
      const clamped = Math.max(1, Math.min(totalPages, pageNum));
      setCurrentPage(clamped);
      setPageInput(String(clamped));
      if (onPageChange) {
        onPageChange(clamped, totalPages);
      }
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }
    },
    [pdfDoc, totalPages, onPageChange]
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

    // 2. Clean tap: left 42% goes back, right 42% goes forward
    if (Math.abs(dx) < 14 && Math.abs(dy) < 14 && elapsed < 450) {
      const rect = containerRef.current.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;

      if (relX <= 0.42) {
        handlePrevPage();
      } else if (relX >= 0.58) {
        handleNextPage();
      }
    }
  };

  // Full-text search inside the open PDF
  const handleRunPdfSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim().toLowerCase();
    if (!pdfDoc || !q) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    const hits: PdfSearchHit[] = [];

    try {
      const maxPagesToScan = Math.min(pdfDoc.numPages, 250);
      for (let p = 1; p <= maxPagesToScan; p++) {
        const page = await pdfDoc.getPage(p);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((it: unknown) => ((it as { str?: string }).str || ''))
          .join(' ')
          .replace(/\s+/g, ' ');

        const lower = pageText.toLowerCase();
        const idx = lower.indexOf(q);
        if (idx !== -1) {
          const start = Math.max(0, idx - 35);
          const end = Math.min(pageText.length, idx + q.length + 55);
          const snippet =
            (start > 0 ? '…' : '') + pageText.slice(start, end).trim() + (end < pageText.length ? '…' : '');
          hits.push({ page: p, snippet });
          if (hits.length >= 40) break;
        }
      }
      setSearchResults(hits);
      if (hits.length > 0) {
        goToPage(hits[0].page);
      }
    } catch (searchErr) {
      console.warn('PDF text search error:', searchErr);
    } finally {
      setIsSearching(false);
    }
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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
        {/* Left: Page Switcher */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => goToPage(1)}
            disabled={currentPage <= 1}
            className="hidden sm:inline-flex px-1.5 py-0.5 rounded text-[11px] opacity-70 hover:opacity-100 hover:bg-white/10 disabled:opacity-30 transition-colors"
            title="First page"
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
              goToPage(parseInt(pageInput, 10) || 1);
            }}
            className="flex items-center gap-1 font-mono"
          >
            <input
              type="text"
              value={pageInput}
              onChange={e => setPageInput(e.target.value)}
              onBlur={() => goToPage(parseInt(pageInput, 10) || currentPage)}
              className="w-11 text-center py-0.5 rounded border border-white/20 bg-white text-black text-xs font-semibold focus:outline-hidden focus:ring-1 focus:ring-[#1DB954]"
            />
            <span className="opacity-60 text-xs">/ {totalPages}</span>
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
            title="Last page"
          >
            {totalPages}
          </button>
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

          {/* Open Bookmarks & Notes Drawer */}
          <button
            type="button"
            onClick={() => {
              setIsBookmarksDrawerOpen(v => !v);
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

      {/* Floating Full-Text Search Bar & Results */}
      {isSearchOpen && (
        <div className="w-full sm:w-96 sm:right-4 sm:top-12 sm:absolute z-30 bg-[#181818] text-white border border-[#333333] sm:rounded-xl shadow-2xl p-3 space-y-2.5">
          <form onSubmit={handleRunPdfSearch} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 opacity-50 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search word or phrase in PDF..."
                className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg bg-[#242424] border border-[#383838] text-white focus:outline-hidden focus:border-[#1DB954]"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="px-3 py-1.5 rounded-lg bg-[#1DB954] text-black font-semibold text-xs hover:bg-[#1ed760] disabled:opacity-50"
            >
              {isSearching ? '...' : 'Search'}
            </button>
            <button
              type="button"
              onClick={() => setIsSearchOpen(false)}
              className="p-1 rounded hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </form>

          {searchResults.length > 0 ? (
            <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
              <p className="text-[11px] text-[#B3B3B3] px-1">
                Found {searchResults.length} matching pages:
              </p>
              {searchResults.map(hit => (
                <button
                  key={hit.page}
                  type="button"
                  onClick={() => goToPage(hit.page)}
                  className={`w-full text-left p-2 rounded-lg text-xs transition-colors flex items-start justify-between gap-2 ${
                    currentPage === hit.page
                      ? 'bg-[#1DB954]/20 border border-[#1DB954]/40'
                      : 'bg-[#242424] hover:bg-[#2E2E2E]'
                  }`}
                >
                  <span className="text-[11px] opacity-90 line-clamp-2">{hit.snippet}</span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/40 text-[#1DB954] shrink-0">
                    p. {hit.page}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            searchQuery.trim() &&
            !isSearching && (
              <p className="text-[11px] text-[#B3B3B3] text-center py-2">
                No matching text found in scanned pages.
              </p>
            )
          )}
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
                Page {currentPage} {currentBookmark ? '(Pinned)' : ''}
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
                {currentBookmark ? 'Save Note on Page ' + currentPage : 'Pin Page ' + currentPage + ' with Note'}
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
                        Page {bm.page}
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
                          p. {pageNum}
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
            className="relative shadow-2xl rounded-xs transition-all duration-200"
            style={{ filter: getThemeFilter() }}
          >
            {isPageRendering && (
              <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-xs text-white px-2.5 py-1 rounded text-[11px] font-mono flex items-center gap-1.5 z-10 shadow-md">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1DB954]" />
                <span>Page {currentPage}...</span>
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
