import * as pdfjsLib from 'pdfjs-dist';
import { cleanPdfFilename, sanitizeBookTitle, sanitizeBookAuthor } from './library';

// Polyfill Promise.try for environments/runtimes that need it
if (typeof Promise !== 'undefined' && !(Promise as unknown as { try?: unknown }).try) {
  (Promise as unknown as { try: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> }).try = function (
    fn: (...args: unknown[]) => unknown,
    ...args: unknown[]
  ) {
    return new Promise(resolve => resolve(fn(...args)));
  };
}

// Configure PDF.js worker in browser environment
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  } catch {
    // Ignore if already set or readonly
  }
}

export interface ExtractedPdfMetadata {
  title: string;
  author: string;
  pageCount: number;
  coverImage?: string;
}

/**
 * Renders the first page of a PDF document proxy to a JPEG data URL for the book cover.
 */
async function renderPageOneToDataUrl(pdfDoc: pdfjsLib.PDFDocumentProxy): Promise<string | undefined> {
  if (typeof document === 'undefined' || pdfDoc.numPages < 1) return undefined;
  try {
    const page = await pdfDoc.getPage(1);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const targetWidth = 360;
    const scale = targetWidth / Math.max(1, unscaledViewport.width);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
      canvas,
    }).promise;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    return dataUrl && dataUrl.startsWith('data:image/') ? dataUrl : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Standalone helper to render a cover image from a stored PDF Blob.
 */
export async function renderPdfFirstPageCover(blob: Blob): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  try {
    const buffer = await blob.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) return null;
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      cMapUrl: '/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/standard_fonts/',
      wasmUrl: '/wasm/',
      stopAtErrors: false,
    });
    pdfDoc = await loadingTask.promise;
    const cover = await renderPageOneToDataUrl(pdfDoc);
    return cover || null;
  } catch {
    return null;
  } finally {
    if (pdfDoc) {
      try {
        pdfDoc.cleanup();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Automatically extracts the title, author, total page count, and first-page cover image from a PDF file.
 */
export async function extractPdfMetadata(file: File): Promise<ExtractedPdfMetadata> {
  const fallback = cleanPdfFilename(file.name);
  let pageCount = 1;
  let detectedTitle = '';
  let detectedAuthor = '';
  let coverImage: string | undefined;

  let buffer: ArrayBuffer | null = null;
  try {
    buffer = await file.arrayBuffer();
  } catch (e) {
    console.warn('Could not read file arrayBuffer:', e);
  }

  // 1. Primary Engine: PDF.js parsing
  if (buffer && buffer.byteLength > 0) {
    let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
    try {
      const dataCopy = new Uint8Array(buffer.slice(0));
      const loadingTask = pdfjsLib.getDocument({
        data: dataCopy,
        cMapUrl: '/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/standard_fonts/',
        wasmUrl: '/wasm/',
        stopAtErrors: false,
      });

      pdfDoc = await loadingTask.promise;
      if (pdfDoc) {
        if (typeof pdfDoc.numPages === 'number' && pdfDoc.numPages > 0) {
          pageCount = pdfDoc.numPages;
        }

        // Render Page 1 as the book's cover image
        coverImage = await renderPageOneToDataUrl(pdfDoc);

        // Extract metadata dictionary (Info and XMP metadata)
        try {
          const meta = await pdfDoc.getMetadata();
          const info = (meta?.info || {}) as Record<string, unknown>;

          if (typeof info.Title === 'string' && info.Title.trim()) {
            const cleaned = sanitizeBookTitle(sanitizeString(info.Title));
            if (isValidTitle(cleaned)) {
              detectedTitle = cleaned;
            }
          }

          if (!detectedTitle && meta?.metadata) {
            try {
              const dcTitle = meta.metadata.get('dc:title');
              if (typeof dcTitle === 'string' && isValidTitle(dcTitle)) {
                detectedTitle = sanitizeBookTitle(sanitizeString(dcTitle));
              }
            } catch {
              // Ignore XMP read error
            }
          }

          if (typeof info.Author === 'string' && info.Author.trim()) {
            const cleaned = sanitizeBookAuthor(sanitizeString(info.Author));
            if (isValidAuthor(cleaned)) {
              detectedAuthor = cleaned;
            }
          } else if (typeof info.Creator === 'string' && info.Creator.trim()) {
            const cleaned = sanitizeBookAuthor(sanitizeString(info.Creator));
            if (isValidAuthor(cleaned)) {
              detectedAuthor = cleaned;
            }
          }

          if (!detectedAuthor && meta?.metadata) {
            try {
              const dcCreator = meta.metadata.get('dc:creator');
              if (typeof dcCreator === 'string' && isValidAuthor(dcCreator)) {
                detectedAuthor = sanitizeBookAuthor(sanitizeString(dcCreator));
              }
            } catch {
              // Ignore XMP read error
            }
          }
        } catch (metaErr) {
          console.warn('PDF.js getMetadata error:', metaErr);
        }

        // If title still not found, peek at the text on the first page
        if (!detectedTitle && pdfDoc.numPages > 0) {
          try {
            const firstPage = await pdfDoc.getPage(1);
            const textContent = await firstPage.getTextContent();
            if (textContent && textContent.items && textContent.items.length > 0) {
              const strings = textContent.items
                .map((item: unknown) => {
                  const it = item as { str?: string };
                  return typeof it.str === 'string' ? it.str.trim() : '';
                })
                .filter(s => s.length > 0);

              for (const candidate of strings) {
                if (candidate.length >= 3 && candidate.length <= 80 && isValidTitle(candidate)) {
                  detectedTitle = sanitizeBookTitle(sanitizeString(candidate));
                  break;
                }
              }
            }
          } catch {
            // Non-critical: ignore page text inspection failure
          }
        }
      }
    } catch (pdfJsErr) {
      console.warn('PDF.js parser encountered notice, trying secondary inspector:', pdfJsErr);
    } finally {
      if (pdfDoc) {
        try {
          pdfDoc.cleanup();
        } catch {
          // ignore
        }
      }
    }
  }

  // 2. Secondary Engine: Binary stream scanning fallback
  if (buffer && (!detectedTitle || !detectedAuthor || pageCount <= 1)) {
    try {
      const binaryMeta = extractMetadataFromBinary(new Uint8Array(buffer));
      if (pageCount <= 1 && binaryMeta.pageCount > 1) {
        pageCount = binaryMeta.pageCount;
      }
      if (!detectedTitle && binaryMeta.title) {
        detectedTitle = sanitizeBookTitle(binaryMeta.title);
      }
      if (!detectedAuthor && binaryMeta.author) {
        detectedAuthor = sanitizeBookAuthor(binaryMeta.author);
      }
    } catch (binErr) {
      console.warn('Binary metadata fallback notice:', binErr);
    }
  }

  // 3. Smart Filename Fallback (never use channel names or "Unknown Writer")
  const finalTitle = sanitizeBookTitle(fallback.title || detectedTitle || file.name.replace(/\.pdf$/i, ''));
  const finalAuthor = sanitizeBookAuthor(detectedAuthor || fallback.author);

  return {
    title: finalTitle,
    author: finalAuthor,
    pageCount: Math.max(1, pageCount),
    coverImage,
  };
}

function isValidTitle(val: string): boolean {
  if (!val || val.length < 2) return false;
  const lower = val.toLowerCase().trim();
  const banned = ['untitled', 'microsoft word', 'powerpoint', 'presentation', 'scan', 'document', 'pdf', 'adobe indesign'];
  return !banned.some(b => lower === b || lower.startsWith(b + ' -'));
}

function isValidAuthor(val: string): boolean {
  if (!val || val.length < 2) return false;
  const lower = val.toLowerCase().trim();
  const banned = ['unknown', 'anonymous', 'administrator', 'user', 'owner', 'root', 'hp', 'canon', 'epson', 'ricoh'];
  return !banned.some(b => lower === b);
}

function sanitizeString(raw: string): string {
  let decoded = raw;
  // Handle UTF-16BE BOM (\xFE\xFF)
  if (raw.charCodeAt(0) === 0xFE && raw.charCodeAt(1) === 0xFF) {
    let s = '';
    for (let i = 2; i < raw.length; i += 2) {
      const code = (raw.charCodeAt(i) << 8) | (raw.charCodeAt(i + 1) || 0);
      s += String.fromCharCode(code);
    }
    decoded = s;
  }

  return decoded
    .replace(/\\([()\\\/])/g, '$1')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fast binary stream inspector used as fallback when PDF.js cannot run (e.g. headless node tests)
 */
function extractMetadataFromBinary(bytes: Uint8Array): { title: string; author: string; pageCount: number } {
  let pageCount = 1;
  let title = '';
  let author = '';

  const text = decodeBufferToLatin1(bytes);

  // Look for `/Type /Pages ... /Count N`
  const countMatches = [...text.matchAll(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/gi)];
  if (countMatches.length > 0) {
    const counts = countMatches.map(m => parseInt(m[1], 10)).filter(n => !isNaN(n) && n > 0);
    if (counts.length > 0) {
      pageCount = Math.max(...counts);
    }
  }

  if (pageCount <= 1) {
    const generalCounts = [...text.matchAll(/\/Count\s+(\d+)/g)];
    if (generalCounts.length > 0) {
      const counts = generalCounts.map(m => parseInt(m[1], 10)).filter(n => !isNaN(n) && n > 0 && n < 20000);
      if (counts.length > 0) {
        pageCount = Math.max(...counts);
      }
    }
  }

  if (pageCount <= 1) {
    const pageMatches = text.match(/\/Type\s*\/Page\b/g);
    if (pageMatches && pageMatches.length > 0) {
      pageCount = pageMatches.length;
    }
  }

  // Detect Author
  const authorMatch = text.match(/\/Author\s*\(([^)]+)\)/i);
  if (authorMatch && authorMatch[1]) {
    const cleaned = sanitizeString(authorMatch[1]);
    if (isValidAuthor(cleaned)) {
      author = cleaned;
    }
  }

  // Detect Title
  const titleMatch = text.match(/\/Title\s*\(([^)]+)\)/i);
  if (titleMatch && titleMatch[1]) {
    const cleaned = sanitizeString(titleMatch[1]);
    if (isValidTitle(cleaned)) {
      title = cleaned;
    }
  }

  return { title, author, pageCount };
}

function decodeBufferToLatin1(bytes: Uint8Array): string {
  const maxScan = 400 * 1024;
  let result = '';
  const len = Math.min(bytes.length, maxScan);
  for (let i = 0; i < len; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  if (bytes.length > maxScan) {
    const tailStart = Math.max(maxScan, bytes.length - 100 * 1024);
    for (let i = tailStart; i < bytes.length; i++) {
      result += String.fromCharCode(bytes[i]);
    }
  }
  return result;
}
