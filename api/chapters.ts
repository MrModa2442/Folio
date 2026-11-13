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
    // In Persian/Arabic OCR, a zero (۰ / ٠) right after a Persian/Arabic digit 1-9 is occasionally read as a dot/bullet
    .replace(/([۱-۹١-٩])[.٫•·](?=\s|$)/g, '$1۰')
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Extracts candidate printed page numbers from a page's header/footer lines.
 */
function extractCandidateNumbersFromEdgeLines(
  pdfPage: number,
  lines: string[],
  totalPages: number
): Array<{ printedPage: number; weight: number }> {
  if (!Array.isArray(lines) || lines.length === 0) return [];

  // Inspect top 2 lines (header) and bottom 2 lines (footer)
  const edgeIndices = new Set<number>();
  edgeIndices.add(0);
  if (lines.length > 1) edgeIndices.add(1);
  edgeIndices.add(lines.length - 1);
  if (lines.length > 2) edgeIndices.add(lines.length - 2);

  const results: Array<{ printedPage: number; weight: number }> = [];
  const maxReasonableOffset = Math.min(45, Math.max(15, Math.floor(totalPages * 0.25)));

  for (const idx of edgeIndices) {
    const rawLine = lines[idx] || '';
    const line = normalizeDigitsToAscii(rawLine).trim();
    if (!line || line.length > 110) continue;

    const isVeryEdge = idx === 0 || idx === lines.length - 1;
    const baseBonus = isVeryEdge ? 2 : 1;

    // Pattern 1: Standalone page number line (e.g. "10", "- 10 -", "[ 10 ]", "صفحه 10", "ص 10", "Page 10")
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

    // Pattern 2: Running header/footer with number at the start or end (e.g., "10 شهد شورستان" or "شهد شورستان 10")
    const leadingNumMatch = line.match(/^(\d{1,4})(?:\s+|[\s/|\\\-–—:•·]+)(.+)$/);
    const trailingNumMatch = line.match(/^(.+?)(?:\s+|[\s/|\\\-–—:•·]+)(\d{1,4})$/);

    if (leadingNumMatch) {
      const n = parseInt(leadingNumMatch[1], 10);
      const rest = leadingNumMatch[2].trim();
      const offset = pdfPage - n;
      // Avoid matching TOC lines that have leader dots "....."
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
    if (!p || p.page < 3 || !Array.isArray(p.lines) || p.lines.length === 0) continue;
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
  maxBookPage: number
): ExtractedChapterItem[] {
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
    .filter(ch => ch.title.length >= 2);

  if (cleaned.length === 0) return [];

  // Sort by startPage ascending, preserving order for same page
  cleaned.sort((a, b) => a.startPage - b.startPage);

  // Deduplicate identical consecutive titles
  const deduped: typeof cleaned = [];
  for (const item of cleaned) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.title.toLowerCase() === item.title.toLowerCase() &&
      Math.abs(prev.startPage - item.startPage) <= 2
    ) {
      continue;
    }
    deduped.push(item);
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
 * Heuristic parser for Table of Contents ("فهرست مطالب" / "Contents") from the opening pages
 * when GEMINI_API_KEY is not configured or as a fast fallback.
 */
export function parseHeuristicChaptersFromFrontPages(
  frontPages: FrontPageInput[],
  maxBookPage: number
): ExtractedChapterItem[] {
  const candidates: Array<{ title: string; startPage: number; level: number }> = [];
  const tocHeaderRegex =
    /(فهرست|مندرجات|سرآغاز|سرفصل|table\s+of\s+contents|\bcontents\b)/i;
  const chapterPrefixRegex =
    /^(فصل|بخش|باب|گفتار|مقدمه|پیشگفتار|دیباچه|سرآغاز|پیوست|نتیجه|chapter|part|section|introduction|preface|epilogue|appendix)\b/i;

  let insideTocRegion = false;
  let tocEndPage = 0;

  for (const fp of frontPages) {
    const pageText = (fp.lines || []).join(' ');
    if (tocHeaderRegex.test(pageText)) {
      insideTocRegion = true;
      tocEndPage = Math.max(tocEndPage, fp.page + 4);
    }
    if (fp.page > tocEndPage && insideTocRegion) {
      insideTocRegion = false;
    }

    for (const rawLine of fp.lines || []) {
      const line = normalizeDigitsToAscii(rawLine).trim();
      if (line.length < 3 || line.length > 160) continue;
      if (tocHeaderRegex.test(line) && line.length < 35) continue;

      // Pattern 1: "Topic Title ....... 45" or "Topic Title   45"
      const trailingMatch = line.match(
        /^(.+?)(?:[\s.…_ـ\-–—]+|(?:ص\.?|صفحه|page|p\.?)\s*)(\d{1,4})$/i
      );
      // Pattern 2 (RTL): "45 ....... Topic Title"
      const leadingMatch = line.match(
        /^(\d{1,4})(?:[\s.…_ـ\-–—]+)(.+?)$/
      );

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
        const cleanTitle = titlePart
          .replace(/^[0-9۰-۹٠-٩]+[\s.)\-–—:]+/, '')
          .replace(/[.…_ـ\-–—]{2,}/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const hasLeaderDots = /[.…_ـ]{2,}/.test(line);
        const isHeadingKeyword = chapterPrefixRegex.test(cleanTitle);

        if (
          cleanTitle.length >= 2 &&
          !/^\d+$/.test(cleanTitle) &&
          (insideTocRegion || hasLeaderDots || isHeadingKeyword)
        ) {
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
    return finalizeChapterRanges(candidates, maxBookPage);
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
    '1. PAGE NUMBER CALIBRATION (pageOffset): Books almost always have unnumbered front-matter pages (cover, title page, copyright, introduction) so the PDF page number is ahead of the printed page number written inside the book. For example, if PDF Page 15 has the printed page number "۱۰" (10) in its top header or bottom footer, then `pageOffset = 15 - 10 = 5` (meaning `printedBookPage = pdfPage - pageOffset`). Inspect the provided sample pages (both text lines and header/footer strip images) and determine the exact integer `pageOffset = pdfPage - printedBookPage`.\n' +
    '2. TABLE OF CONTENTS CHAPTERS: Read the opening pages carefully and extract the complete list of chapters/topics from the Table of Contents ("فهرست مطالب" / "Contents") with their printed book `startPage` and `endPage`. Keep chapter titles in the exact language of the book.';

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

  // Prioritize body sample page header/footer images for exact pageOffset calibration + front TOC images
  const imagePages = [
    ...bodySamplePages.filter(p => p.imageBase64).slice(0, 4),
    ...frontPages.filter(p => p.imageBase64).slice(0, 4),
  ];

  const imageParts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  for (const p of imagePages) {
    imageParts.push({
      text: `Image below is from physical PDF Page ${p.page} (inspect top header and bottom footer for the printed book page number, e.g. Persian digits ۱۰, ۱۱, ۱۲, so you can compute pageOffset = ${p.page} - printedPageNumber):`,
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
      ? 'Determine the exact `pageOffset` (`pdfPage - printedBookPage`) from the sample pages. Return JSON with `pageOffset` (integer) and an empty `chapters` array.'
      : 'Determine the exact `pageOffset` (`pdfPage - printedBookPage`) AND extract all chapters from the Table of Contents with their printed book `startPage` and `endPage`.',
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
            pageOffset: {
              type: Type.INTEGER,
              description:
                'The integer offset (pdfPage - printedBookPage). For example, if PDF Page 15 shows printed page 10 in the book, pageOffset is 5. If unknown, return -999.',
            },
            chapters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: {
                    type: Type.STRING,
                    description: 'Title of the chapter or topic in the book\'s original language.',
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
          required: ['pageOffset', 'chapters'],
        },
      },
    });

    const rawText = (response.text ?? '{"pageOffset":-999,"chapters":[]}').trim();
    const parsed = JSON.parse(rawText) as {
      pageOffset?: number;
      chapters?: Array<{ title: string; startPage: number; endPage?: number; level?: number }>;
    };

    const rawOffset = typeof parsed.pageOffset === 'number' ? Math.round(parsed.pageOffset) : -999;
    const validOffset =
      rawOffset >= -2 && rawOffset <= Math.min(50, Math.floor(totalPages * 0.4))
        ? rawOffset
        : null;

    const maxBookPage =
      validOffset !== null && validOffset > 0 ? Math.max(1, totalPages - validOffset) : totalPages;

    const list = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    const finalized = finalizeChapterRanges(list, maxBookPage);

    if (!offsetOnly && finalized.length === 0 && validOffset === null) {
      throw new Error('Neither chapters nor pageOffset extracted');
    }

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
    };

    const bookTitle = String(body.bookTitle || 'Book').trim();
    const totalPages = Math.max(1, Number(body.totalPages) || 1);
    const frontPages = Array.isArray(body.frontPages) ? body.frontPages.slice(0, 18) : [];
    const bodySamplePages = Array.isArray(body.bodySamplePages)
      ? body.bodySamplePages.slice(0, 8)
      : [];
    const offsetOnly = body.mode === 'offset_only';

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
        if (aiResult.chapters.length > 0 || finalOffset !== null) {
          const maxBookPage =
            finalOffset !== null && finalOffset > 0
              ? Math.max(1, totalPages - finalOffset)
              : totalPages;
          const fallbackChapters =
            !offsetOnly && aiResult.chapters.length === 0
              ? parseHeuristicChaptersFromFrontPages(frontPages, maxBookPage)
              : aiResult.chapters;

          return res.status(200).json({
            chapters: fallbackChapters,
            pageOffset: finalOffset,
            source: 'ai',
          });
        }
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
      : parseHeuristicChaptersFromFrontPages(frontPages, maxBookPage);

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
