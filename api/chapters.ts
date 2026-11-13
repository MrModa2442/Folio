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
}

function normalizeDigitsToAscii(str: string): string {
  return str
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
}

function finalizeChapterRanges(
  rawChapters: Array<{ title: string; startPage: number; endPage?: number; level?: number }>,
  totalPages: number
): ExtractedChapterItem[] {
  const cleaned = rawChapters
    .map(ch => ({
      title: String(ch.title || '')
        .replace(/[.…_ـ\-–—]{3,}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      startPage: Math.max(1, Math.min(totalPages, Math.round(Number(ch.startPage) || 1))),
      endPage: ch.endPage ? Math.max(1, Math.min(totalPages, Math.round(Number(ch.endPage)))) : 0,
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
        computedEnd = totalPages;
      }
    }
    computedEnd = Math.max(ch.startPage, Math.min(totalPages, computedEnd));

    return {
      id: `ai_ch_${idx}_${ch.startPage}`,
      title: ch.title,
      page: ch.startPage,
      startPage: ch.startPage,
      endPage: computedEnd,
      level: ch.level,
    };
  });
}

/**
 * Heuristic parser for Table of Contents ("فهرست مطالب" / "Contents") from the first 16 pages
 * when GEMINI_API_KEY is not configured or as a fast fallback.
 */
export function parseHeuristicChaptersFromFrontPages(
  frontPages: FrontPageInput[],
  totalPages: number
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

      if (titlePart && pageNum >= 1 && pageNum <= totalPages) {
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
    return finalizeChapterRanges(candidates, totalPages);
  }
  return [];
}

async function extractChaptersWithGemini(
  ai: GoogleGenAI,
  bookTitle: string,
  totalPages: number,
  frontPages: FrontPageInput[]
): Promise<ExtractedChapterItem[]> {
  const systemInstruction =
    'You are an expert literary archivist and multilingual book analyzer (specializing in Persian/Farsi, Arabic, and English books). ' +
    'You are given the opening pages (first ~15 pages) of a book, which usually contain the Table of Contents ("فهرست مطالب" / "فهرست" / "Contents") or introductory chapter breakdown. ' +
    'Read these opening pages carefully and extract the complete list of chapters/topics and their starting and ending page numbers. ' +
    'If the Table of Contents lists printed page numbers, map them accurately within 1..' +
    totalPages +
    ' and compute each chapter\'s startPage and endPage (where a chapter ends on the page right before the next chapter starts, and the last chapter ends on page ' +
    totalPages +
    '). Keep chapter titles in the exact language of the book (e.g. Persian for Persian books).';

  const textBlocks = frontPages
    .filter(p => Array.isArray(p.lines) && p.lines.length > 0)
    .map(p => `--- PDF Page ${p.page} ---\n${p.lines.join('\n')}`)
    .join('\n\n');

  // Also include up to 6 page images for pages that have few text lines or look like Table of Contents pages
  const imageParts = frontPages
    .filter(p => p.imageBase64)
    .slice(0, 6)
    .map(p => ({
      inlineData: {
        mimeType: p.mimeType || 'image/jpeg',
        data: p.imageBase64!.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, ''),
      },
    }));

  const promptText = [
    `Book Title: "${bookTitle || 'Book'}"`,
    `Total PDF Pages: ${totalPages}`,
    textBlocks
      ? `Extracted Text from Opening Pages:\n${textBlocks}`
      : 'Analyze the attached opening page images to locate the Table of Contents (فهرست مطالب) and extract all chapters with their startPage and endPage.',
    'Return a JSON object with a "chapters" array containing each chapter\'s title, startPage, endPage, and level (0 for main chapter, 1 for sub-section).',
  ].join('\n\n');

  const modelsToTry: Array<{ name: string; useLowThinking: boolean }> = [
    { name: 'gemini-4-hydrogen', useLowThinking: true },
    { name: 'gemini-3.1-flash-lite', useLowThinking: false },
  ];

  const runModel = async (modelSpec: {
    name: string;
    useLowThinking: boolean;
  }): Promise<ExtractedChapterItem[]> => {
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
                    description: 'Starting page number of this chapter.',
                  },
                  endPage: {
                    type: Type.INTEGER,
                    description: 'Ending page number of this chapter.',
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
          required: ['chapters'],
        },
      },
    });

    const rawText = (response.text ?? '{"chapters":[]}').trim();
    const parsed = JSON.parse(rawText) as {
      chapters?: Array<{ title: string; startPage: number; endPage?: number; level?: number }>;
    };
    const list = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    const finalized = finalizeChapterRanges(list, totalPages);
    if (finalized.length === 0) {
      throw new Error('No chapters extracted');
    }
    return finalized;
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
    };

    const bookTitle = String(body.bookTitle || 'Book').trim();
    const totalPages = Math.max(1, Number(body.totalPages) || 1);
    const frontPages = Array.isArray(body.frontPages) ? body.frontPages.slice(0, 18) : [];

    if (frontPages.length === 0) {
      return res.status(200).json({ chapters: [], source: 'empty' });
    }

    const ai = getAiClient();
    if (ai) {
      try {
        const aiChapters = await extractChaptersWithGemini(ai, bookTitle, totalPages, frontPages);
        if (aiChapters.length > 0) {
          return res.status(200).json({ chapters: aiChapters, source: 'ai' });
        }
      } catch (err) {
        console.warn('Gemini chapter extraction fallback to heuristic:', err);
      }
    }

    const heuristicChapters = parseHeuristicChaptersFromFrontPages(frontPages, totalPages);
    return res.status(200).json({
      chapters: heuristicChapters,
      source: heuristicChapters.length > 0 ? 'heuristic' : 'none',
    });
  } catch (err) {
    console.warn('Chapters API error:', err);
    return res.status(200).json({ chapters: [], source: 'error' });
  }
}
