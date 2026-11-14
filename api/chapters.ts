import type { Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

function getAiClient(): GoogleGenAI | null {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.API_KEY ||
    process.env.GOOGLE_API_KEY ||
    '';
  if (!apiKey.trim()) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface FrontPageInput {
  page: number;
  lines: string[];
  imageBase64?: string;
  mimeType?: string;
}

export interface ExtractedChapterItem {
  id: string;
  title: string;
  page: number;
  startPage: number;
  endPage: number;
  level: number;
  isBookPageNumber?: boolean;
}

export function normalizeDigitsToAscii(str: string): string {
  return str
    // In Persian/Arabic OCR, a zero (۰ / ٠) right after a digit 1-9 is occasionally read as a dot/bullet/degree/o
    .replace(/([1-9۱-۹١-٩])[.٫•·°oO](?=\s|$|[^\d۰-۹٠-٩])/g, '$10')
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Extracts candidate printed page numbers from a page's top/bottom corner lines.
 */
function extractCandidateNumbersFromEdgeLines(
  pdfPage: number,
  lines: string[],
  totalPages: number
): Array<{ printedPage: number; weight: number }> {
  if (!Array.isArray(lines) || lines.length === 0) return [];

  // Inspect top 3 lines (header corners) and bottom 3 lines (footer corners)
  const edgeIndices = new Set<number>();
  for (let i = 0; i < Math.min(3, lines.length); i++) edgeIndices.add(i);
  for (let i = Math.max(0, lines.length - 3); i < lines.length; i++) edgeIndices.add(i);

  const results: Array<{ printedPage: number; weight: number }> = [];
  const maxReasonableOffset = Math.min(60, Math.max(18, Math.floor(totalPages * 0.3)));

  for (const idx of edgeIndices) {
    const rawLine = lines[idx] || '';
    const line = normalizeDigitsToAscii(rawLine)
      .replace(/^[^\dA-Za-z\u0600-\u06FF]+|[^\dA-Za-z\u0600-\u06FF]+$/g, '')
      .trim();
    if (!line || line.length > 110) continue;

    const isVeryEdge = idx === 0 || idx === lines.length - 1;
    const baseBonus = isVeryEdge ? 2 : 1;

    // Pattern 1: Standalone corner page number (e.g. "10", "- 10 -", "صفحه 10", "ص 10", "Page 10")
    const standaloneMatch = line.match(
      /^(?:[-–—~•*[\]()\s]|صفحه|ص\.?|page|p\.?)*(\d{1,4})(?:[-–—~•*[\]()\s])*$/i
    );
    if (standaloneMatch) {
      const n = parseInt(standaloneMatch[1], 10);
      const offset = pdfPage - n;
      if (n >= 1 && n <= totalPages && offset >= -2 && offset <= maxReasonableOffset) {
        results.push({ printedPage: n, weight: 5 + baseBonus });
        continue;
      }
    }

    // Pattern 2: Corner number at start or end of running header/footer (e.g. "10 شهد شورستان" or "شهد شورستان 10")
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
        rest.length <= 70 &&
        !/[.…_ـ]{3,}/.test(line)
      ) {
        results.push({ printedPage: n, weight: 3 + baseBonus });
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
        rest.length <= 70 &&
        !/[.…_ـ]{3,}/.test(line)
      ) {
        results.push({ printedPage: n, weight: 3 + baseBonus });
      }
    }
  }

  return results;
}

/**
 * Consensus voter across pages: since `pdfPage - printedBookPage = pageOffset` is constant
 * throughout a book, checking multiple pages finds the exact offset with mathematical certainty.
 */
export function detectHeuristicPageOffset(
  pages: FrontPageInput[],
  totalPages: number
): number | null {
  const offsetStats = new Map<number, { pages: Set<number>; totalWeight: number }>();

  for (const p of pages) {
    if (!p || p.page < 2 || !Array.isArray(p.lines) || p.lines.length === 0) continue;
    const candidates = extractCandidateNumbersFromEdgeLines(p.page, p.lines, totalPages);
    for (const c of candidates) {
      const offset = p.page - c.printedPage;
      const existing = offsetStats.get(offset) || { pages: new Set<number>(), totalWeight: 0 };
      existing.pages.add(p.page);
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

  if (bestOffset !== null && (bestPageCount >= 2 || bestWeight >= 5)) {
    return bestOffset;
  }

  return null;
}

function finalizeChapterRanges(
  rawChapters: Array<{ title: string; startPage: number; endPage?: number; level?: number }>,
  maxBookPage: number,
  bookTitle = ''
): ExtractedChapterItem[] {
  const cleanBookTitle = bookTitle.trim().toLowerCase();
  const cleaned = rawChapters
    .map(ch => ({
      title: String(ch.title || '')
        .replace(/[.…_ـ\-–—]{3,}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      startPage: Math.max(1, Math.min(maxBookPage, Math.round(Number(ch.startPage) || 1))),
      endPage: ch.endPage ? Math.max(1, Math.min(maxBookPage, Math.round(Number(ch.endPage)))) : 0,
      level: Math.max(0, Math.min(2, Math.round(Number(ch.level) || 0))),
    }))
    .filter(
      ch =>
        ch.title.length >= 2 &&
        (!cleanBookTitle || ch.title.toLowerCase() !== cleanBookTitle)
    );

  if (cleaned.length < 2) return [];

  // Sort by startPage ascending, preserving order for same page
  cleaned.sort((a, b) => a.startPage - b.startPage);

  // Deduplicate identical titles (so running headers repeated across pages are never mistaken for chapters)
  const titleCounts = new Map<string, number>();
  for (const item of cleaned) {
    const k = item.title.toLowerCase();
    titleCounts.set(k, (titleCounts.get(k) || 0) + 1);
  }

  const deduped: typeof cleaned = [];
  for (const item of cleaned) {
    const k = item.title.toLowerCase();
    if ((titleCounts.get(k) || 0) >= 3) {
      // A title repeated 3+ times on different pages is a running header, not a chapter
      continue;
    }
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.title.toLowerCase() === k &&
      Math.abs(prev.startPage - item.startPage) <= 2
    ) {
      continue;
    }
    deduped.push(item);
  }

  if (deduped.length < 2) return [];

  const distinctStartPages = new Set(deduped.map(d => d.startPage));
  const minStart = deduped[0].startPage;
  const maxStart = deduped[deduped.length - 1].startPage;
  if (distinctStartPages.size < 2 || maxStart - minStart < 3) {
    return [];
  }

  return deduped.map((ch, idx) => {
    const nextStart = deduped[idx + 1]?.startPage;
    let computedEnd = ch.endPage;
    if (!computedEnd || computedEnd < ch.startPage) {
      if (nextStart && nextStart > ch.startPage) {
        computedEnd = nextStart - 1;
      } else if (nextStart && nextStart === ch.startPage) {
        computedEnd = ch.startPage;
      } else {
        computedEnd = maxBookPage;
      }
    }
    computedEnd = Math.max(ch.startPage, Math.min(maxBookPage, computedEnd));

    return {
      id: `ai_ch_${idx}_${ch.startPage}`,
      title: ch.title,
      page: ch.startPage,
      startPage: ch.startPage,
      endPage: computedEnd,
      level: ch.level,
      isBookPageNumber: true,
    };
  });
}

/**
 * Strictly parses a genuine Table of Contents ("فهرست مطالب" / "Contents") from the opening pages.
 * Returns [] if the book does not have a Table of Contents page in the opening pages.
 */
export function parseHeuristicChaptersFromFrontPages(
  frontPages: FrontPageInput[],
  maxBookPage: number,
  bookTitle = '',
  userRequested = false
): ExtractedChapterItem[] {
  const tocHeaderLineRegex =
    /^(?:[-–—•*\s])*(?:فهرست(?:\s+مطالب|\s+مندرجات)?|مندرجات|سرفصل(?:\s*ها)?|table\s+of\s+contents|contents)(?:[-–—•*:\s])*$/i;
  const chapterPrefixRegex =
    /^(فصل|بخش|باب|گفتار|مقدمه|پیشگفتار|دیباچه|پیوست|نتیجه|chapter|part|section|introduction|preface|epilogue|appendix)\b/i;

  // First check which pages in frontPages actually look like a Table of Contents page
  const tocPageNumbers = new Set<number>();

  for (const fp of frontPages) {
    const lines = (fp.lines || []).map(l => normalizeDigitsToAscii(l).trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const hasExplicitTocHeading = lines.some(
      l => tocHeaderLineRegex.test(l) || /^(?:فهرست\s+مطالب|فهرست\s+مندرجات|table\s+of\s+contents)/i.test(l)
    );
    if (hasExplicitTocHeading) {
      tocPageNumbers.add(fp.page);
      tocPageNumbers.add(fp.page + 1);
      tocPageNumbers.add(fp.page + 2);
    }

    // Or a page where lines have leader dots ("..... 25"), chapter prefixes, or (when userRequested) topic + page number rows
    let tocLikeLinesOnPage = 0;
    for (const line of lines) {
      if (/[.…_ـ]{2,}\s*\d{1,4}$/.test(line) || /^\d{1,4}\s*[.…_ـ]{2,}/.test(line)) {
        tocLikeLinesOnPage++;
      } else if (chapterPrefixRegex.test(line) && /\b\d{1,4}$/.test(line)) {
        tocLikeLinesOnPage++;
      } else if (
        userRequested &&
        line.length >= 4 &&
        line.length <= 110 &&
        (/^(.+?)(?:\s{2,}|\s*[-–—:]\s*|(?:ص\.?|صفحه|page|p\.?)\s*)(\d{1,4})$/i.test(line) ||
          /^(\d{1,4})(?:\s{2,}|\s*[-–—:]\s*)(.+?)$/.test(line))
      ) {
        tocLikeLinesOnPage++;
      }
    }
    if (tocLikeLinesOnPage >= (userRequested ? 2 : 4)) {
      tocPageNumbers.add(fp.page);
    }
  }

  if (tocPageNumbers.size === 0) {
    return [];
  }

  const candidates: Array<{ title: string; startPage: number; level: number }> = [];

  for (const fp of frontPages) {
    if (!tocPageNumbers.has(fp.page)) continue;
    const lines = fp.lines || [];

    for (let idx = 0; idx < lines.length; idx++) {
      const line = normalizeDigitsToAscii(lines[idx] || '').trim();
      if (line.length < 3 || line.length > 160) continue;
      if (tocHeaderLineRegex.test(line)) continue;

      // Skip the very first/last line if it's just the page's own corner number + book title
      const isEdgeLine = idx === 0 || idx === lines.length - 1;

      const trailingMatch = line.match(
        /^(.+?)(?:[\s.…_ـ\-–—]+|(?:ص\.?|صفحه|page|p\.?)\s*)(\d{1,4})$/i
      );
      const leadingMatch = line.match(/^(\d{1,4})(?:[\s.…_ـ\-–—]+)(.+?)$/);

      let titlePart = '';
      let pageNum = 0;

      if (trailingMatch) {
        titlePart = trailingMatch[1].trim();
        pageNum = parseInt(trailingMatch[2], 10);
      } else if (leadingMatch) {
        pageNum = parseInt(leadingMatch[1], 10);
        titlePart = leadingMatch[2].trim();
      }

      if (titlePart && pageNum >= 1 && pageNum <= maxBookPage) {
        const hasLeaderDots = /[.…_ـ]{2,}/.test(line);
        if (isEdgeLine && !hasLeaderDots && pageNum <= fp.page) {
          // Likely the TOC page's own running header/footer number
          continue;
        }

        const cleanTitle = titlePart
          .replace(/^[0-9۰-۹٠-٩]+[\s.)\-–—:]+/, '')
          .replace(/[.…_ـ\-–—]{2,}/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const isHeadingKeyword = chapterPrefixRegex.test(cleanTitle);

        if (cleanTitle.length >= 2 && !/^\d+$/.test(cleanTitle)) {
          candidates.push({
            title: cleanTitle,
            startPage: pageNum,
            level: isHeadingKeyword ? 0 : 1,
          });
        }
      }
    }
  }

  if (candidates.length >= 2) {
    return finalizeChapterRanges(candidates, maxBookPage, bookTitle);
  }
  return [];
}

async function extractChaptersAndOffsetWithGemini(
  ai: GoogleGenAI,
  bookTitle: string,
  totalPages: number,
  frontPages: FrontPageInput[],
  bodySamplePages: FrontPageInput[],
  offsetOnly: boolean
): Promise<{ chapters: ExtractedChapterItem[]; pageOffset: number | null }> {
  const systemInstruction =
    'You are an expert literary archivist and multilingual book analyzer (specializing in Persian/Farsi, Arabic, and English books). ' +
    'You have two critical tasks:\n' +
    '1. PRINTED BOOK PAGE NUMBER DETECTION (pageOffset): Look at the top-right, top-left, bottom-right, and bottom-left corners of each sample page (both text lines and corner/header/footer images). You will see a printed number written by the book author/publisher (e.g. "1" or "۱" on PDF page 5, or "۱۰" = 10 on PDF page 15, or "۱۲" = 12 on PDF page 17). Compute the integer `pageOffset = pdfPage - printedBookPage` (e.g., 5 - 1 = 4, or 15 - 10 = 5).\n' +
    '2. TABLE OF CONTENTS CHAPTERS (User-Requested Analysis): The user explicitly clicked the Chapters button to analyze the provided pages and images for a Table of Contents ("فهرست مطالب" / "فهرست" / "Contents") or chapter/topic index that lists topics alongside their page numbers. Inspect both the text lines AND the page images carefully. If a Table of Contents / Chapters list is present on any of the provided pages, set `hasTableOfContents: true`, set `tocPdfPageNumber` to that page number, and extract all listed chapters/topics with their starting and ending printed book page numbers. If none of the provided pages contain a chapter/topic list, set `hasTableOfContents: false`, `tocPdfPageNumber: -1`, and return `chapters: []`.';

  const allTextPages = [...frontPages, ...bodySamplePages];
  const seenTextPages = new Set<number>();
  const textBlocks = allTextPages
    .filter(p => {
      if (seenTextPages.has(p.page)) return false;
      if (!Array.isArray(p.lines) || p.lines.length === 0) return false;
      seenTextPages.add(p.page);
      return true;
    })
    .map(p => `--- PDF Page ${p.page} ---\n${p.lines.join('\n')}`)
    .join('\n\n');

  const imagePages = [
    ...bodySamplePages.filter(p => p.imageBase64).slice(0, 4),
    ...frontPages.filter(p => p.imageBase64).slice(0, 6),
  ];

  const imageParts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  for (const p of imagePages) {
    imageParts.push({
      text: `Image below is from physical PDF Page ${p.page} (inspect for Table of Contents / فهرست مطالب entries and inspect the 4 corners for the printed book page number so you can compute pageOffset = ${p.page} - printedPageNumber):`,
    });
    imageParts.push({
      inlineData: {
        mimeType: p.mimeType || 'image/jpeg',
        data: p.imageBase64!.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, ''),
      },
    });
  }

  const promptText = [
    `Book Title: "${bookTitle || 'Book'}"`,
    `Total PDF Pages: ${totalPages}`,
    textBlocks ? `Extracted Text from Pages:\n${textBlocks}` : '',
    offsetOnly
      ? 'Determine the exact `pageOffset` (`pdfPage - printedBookPage`) from the corner numbers on the sample pages. Return JSON with `pageOffset` (integer), `hasTableOfContents: false`, `tocPdfPageNumber: -1`, and an empty `chapters` array.'
      : 'The user requested AI analysis to find the book\'s Chapters / Table of Contents ("فهرست مطالب" / "Contents") from these pages. Extract all chapter/section titles and their printed start/end page numbers if a list exists on these pages, and determine `pageOffset` (`pdfPage - printedBookPage`).',
  ]
    .filter(Boolean)
    .join('\n\n');

  const modelsToTry: Array<{ name: string; useLowThinking: boolean }> = [
    { name: 'gemini-4-hydrogen', useLowThinking: true },
    { name: 'gemini-3.1-flash-lite', useLowThinking: false },
  ];

  const runModel = async (modelSpec: {
    name: string;
    useLowThinking: boolean;
  }): Promise<{ chapters: ExtractedChapterItem[]; pageOffset: number | null }> => {
    const response = await ai.models.generateContent({
      model: modelSpec.name,
      contents: {
        parts: [...imageParts, { text: promptText }],
      },
      config: {
        systemInstruction,
        ...(modelSpec.useLowThinking
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            hasTableOfContents: {
              type: Type.BOOLEAN,
              description:
                'True if the provided pages contain a Table of Contents ("فهرست مطالب" / "Contents") or chapter/topic list with page numbers.',
            },
            tocPdfPageNumber: {
              type: Type.INTEGER,
              description:
                'The PDF page number where the Table of Contents page starts, or -1 if no Table of Contents list is present.',
            },
            pageOffset: {
              type: Type.INTEGER,
              description:
                'The integer offset (pdfPage - printedBookPage). For example, if PDF Page 5 has printed page 1, pageOffset is 4; if PDF Page 15 has printed page 10, pageOffset is 5. If unknown, return -999.',
            },
            chapters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: {
                    type: Type.STRING,
                    description: 'Title of the chapter or topic from the Table of Contents.',
                  },
                  startPage: {
                    type: Type.INTEGER,
                    description: 'Starting printed book page number of this chapter.',
                  },
                  endPage: {
                    type: Type.INTEGER,
                    description: 'Ending printed book page number of this chapter.',
                  },
                  level: {
                    type: Type.INTEGER,
                    description: '0 for main chapter/part, 1 for sub-topic.',
                  },
                },
                required: ['title', 'startPage', 'endPage'],
              },
            },
          },
          required: ['hasTableOfContents', 'tocPdfPageNumber', 'pageOffset', 'chapters'],
        },
      },
    });

    const rawText = (
      response.text ?? '{"hasTableOfContents":false,"tocPdfPageNumber":-1,"pageOffset":-999,"chapters":[]}'
    ).trim();
    const parsed = JSON.parse(rawText) as {
      hasTableOfContents?: boolean;
      tocPdfPageNumber?: number;
      pageOffset?: number;
      chapters?: Array<{ title: string; startPage: number; endPage?: number; level?: number }>;
    };

    const rawOffset = typeof parsed.pageOffset === 'number' ? Math.round(parsed.pageOffset) : -999;
    const validOffset =
      rawOffset >= -2 && rawOffset <= Math.min(60, Math.floor(totalPages * 0.4))
        ? rawOffset
        : null;

    const maxBookPage =
      validOffset !== null && validOffset > 0 ? Math.max(1, totalPages - validOffset) : totalPages;

    const tocPageValid =
      parsed.hasTableOfContents === true &&
      (typeof parsed.tocPdfPageNumber !== 'number' ||
        parsed.tocPdfPageNumber === -1 ||
        (parsed.tocPdfPageNumber >= 1 && parsed.tocPdfPageNumber <= totalPages));

    const list =
      !offsetOnly && tocPageValid && Array.isArray(parsed.chapters) ? parsed.chapters : [];
    const finalized = finalizeChapterRanges(list, maxBookPage, bookTitle);

    return {
      chapters: finalized,
      pageOffset: validOffset,
    };
  };

  return Promise.any(modelsToTry.map(spec => runModel(spec)));
}

export default async function chaptersHandler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = (req.body || {}) as {
      bookTitle?: string;
      totalPages?: number;
      frontPages?: FrontPageInput[];
      bodySamplePages?: FrontPageInput[];
      mode?: 'full' | 'offset_only';
      userRequested?: boolean;
    };

    const bookTitle = String(body.bookTitle || 'Book').trim();
    const totalPages = Math.max(1, Number(body.totalPages) || 1);
    const frontPages = Array.isArray(body.frontPages) ? body.frontPages.slice(0, 20) : [];
    const bodySamplePages = Array.isArray(body.bodySamplePages)
      ? body.bodySamplePages.slice(0, 8)
      : [];
    const offsetOnly = body.mode === 'offset_only';
    const userRequested = body.userRequested !== false;

    if (frontPages.length === 0 && bodySamplePages.length === 0) {
      return res.status(200).json({ chapters: [], pageOffset: null, source: 'empty' });
    }

    // 1. First compute deterministic heuristic pageOffset from any text lines in bodySamplePages + frontPages
    const heuristicOffset = detectHeuristicPageOffset(
      [...bodySamplePages, ...frontPages],
      totalPages
    );

    const ai = getAiClient();
    if (ai) {
      try {
        const aiResult = await extractChaptersAndOffsetWithGemini(
          ai,
          bookTitle,
          totalPages,
          frontPages,
          bodySamplePages,
          offsetOnly
        );
        const finalOffset =
          aiResult.pageOffset !== null ? aiResult.pageOffset : heuristicOffset;
        const maxBookPage =
          finalOffset !== null && finalOffset > 0
            ? Math.max(1, totalPages - finalOffset)
            : totalPages;
        const fallbackChapters =
          !offsetOnly && aiResult.chapters.length === 0
            ? parseHeuristicChaptersFromFrontPages(
                frontPages,
                maxBookPage,
                bookTitle,
                userRequested
              )
            : aiResult.chapters;

        return res.status(200).json({
          chapters: fallbackChapters,
          pageOffset: finalOffset,
          source: 'ai',
        });
      } catch (err) {
        console.warn('Gemini chapter/offset extraction fallback to heuristic:', err);
      }
    }

    const maxBookPage =
      heuristicOffset !== null && heuristicOffset > 0
        ? Math.max(1, totalPages - heuristicOffset)
        : totalPages;
    const heuristicChapters = offsetOnly
      ? []
      : parseHeuristicChaptersFromFrontPages(
          frontPages,
          maxBookPage,
          bookTitle,
          userRequested
        );

    return res.status(200).json({
      chapters: heuristicChapters,
      pageOffset: heuristicOffset,
      source: heuristicChapters.length > 0 || heuristicOffset !== null ? 'heuristic' : 'none',
    });
  } catch (err) {
    console.warn('Chapters API error:', err);
    return res.status(200).json({ chapters: [], pageOffset: null, source: 'error' });
  }
}
