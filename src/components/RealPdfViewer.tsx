import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
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
} from 'lucide-react';

// Configure the local worker script hosted in public/
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

interface RealPdfViewerProps {
  arrayBuffer: ArrayBuffer | null;
  initialPage?: number;
  onPageChange?: (page: number, totalPages: number) => void;
  paperTheme?: 'cream' | 'sepia' | 'night' | 'white';
}

export const RealPdfViewer: React.FC<RealPdfViewerProps> = ({
  arrayBuffer,
  initialPage = 1,
  onPageChange,
  paperTheme = 'cream',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.25);
  const [rotation, setRotation] = useState<number>(0);
  const [isLoadingDoc, setIsLoadingDoc] = useState<boolean>(true);
  const [isPageRendering, setIsPageRendering] = useState<boolean>(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [pageRenderError, setPageRenderError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState<string>(String(initialPage));
  const [tapFeedback, setTapFeedback] = useState<'left' | 'right' | null>(null);

  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const rawPageDimensionsRef = useRef<{ width: number; height: number } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

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

  // Render Page onto Canvas
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
      const viewport = page.getViewport({ scale: scale * pixelRatio, rotation });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`;
      canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`;

      const context = canvas.getContext('2d', { willReadFrequently: false });
      if (!context) {
        throw new Error('Could not get 2D canvas context');
      }

      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';

      const renderContext = {
        canvas: canvas,
        canvasContext: context,
        viewport: viewport,
      };

      const task = page.render(renderContext);
      renderTaskRef.current = task;

      await task.promise;
      setIsPageRendering(false);
    } catch (err: unknown) {
      const isCancelled = (err as { name?: string })?.name === 'RenderingCancelledException';
      if (!isCancelled) {
        console.error('PDF page rendering error:', err);
        setPageRenderError((err as Error)?.message || 'Failed to render page.');
      }
      setIsPageRendering(false);
    }
  }, [pdfDoc, currentPage, scale, rotation]);

  useEffect(() => {
    renderCurrentPage();
  }, [renderCurrentPage]);

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

  // Tap Left / Right side of book or Swipe to turn pages
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now(),
    };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || !containerRef.current) return;

    // Ignore if user clicked a button or input inside the container
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) return;

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

    // 2. Clean tap (not a scroll/drag): check if left 40% or right 40% of the book/screen was tapped
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
        return 'sepia(35%) brightness(96%) contrast(102%)';
      case 'cream':
        return 'sepia(16%) brightness(98%)';
      case 'night':
        return 'invert(92%) hue-rotate(180deg) brightness(90%) contrast(110%)';
      default:
        return 'none';
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden select-none">
      {/* Reader Toolbar */}
      <div className="h-10 px-4 border-b border-white/10 flex items-center justify-between gap-2 sm:gap-4 bg-black/40 shrink-0 text-xs">
        {/* Page Switcher */}
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
            title="Previous page (Tap left side or Left arrow)"
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
              className="w-12 text-center py-0.5 rounded border border-white/20 bg-white text-black text-xs font-semibold focus:outline-hidden focus:ring-1 focus:ring-[#1DB954]"
            />
            <span className="opacity-60 text-xs">/ {totalPages}</span>
          </form>

          <button
            onClick={handleNextPage}
            disabled={currentPage >= totalPages}
            className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"
            title="Next page (Tap right side or Right arrow)"
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

          <span className="hidden lg:inline-block ml-2 text-[11px] opacity-45">
            Tip: Tap left/right side of page to turn
          </span>
        </div>

        {/* Zoom Controls & Fit Presets */}
        <div className="flex items-center gap-1 sm:gap-2">
          <div className="hidden md:flex items-center gap-1 border-r border-white/10 pr-2">
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

      {/* Main Canvas Container with Left/Right Tap-to-Turn Zones */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        className="flex-1 overflow-auto p-4 sm:p-6 flex items-start justify-center relative cursor-pointer"
      >
        {/* Subtle Visual Left/Right Page Turn Feedback Pill */}
        {tapFeedback === 'left' && (
          <div className="fixed left-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-black/70 text-white flex items-center justify-center shadow-lg pointer-events-none animate-fade-in">
            <ChevronLeft className="w-5 h-5 text-[#1DB954]" />
          </div>
        )}
        {tapFeedback === 'right' && (
          <div className="fixed right-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-black/70 text-white flex items-center justify-center shadow-lg pointer-events-none animate-fade-in">
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
          </div>
        )}
      </div>
    </div>
  );
};
