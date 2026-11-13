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

interface PageInput {
  page: number;
  imageBase64: string;
  mimeType?: string;
}

async function transcribeSinglePage(
  ai: GoogleGenAI,
  pageInput: PageInput
): Promise<{ page: number; lines: string[] }> {
  const cleanBase64 = pageInput.imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
  const mimeType = pageInput.mimeType || 'image/jpeg';

  const systemInstruction =
    'You are a high-precision optical character recognition (OCR) engine for Persian/Farsi, Arabic, and English books. ' +
    'Read the page image from top to bottom and output every line of visible text in standard Unicode characters (using standard Persian Yeh ی and Kaf ک). ' +
    'Do not translate or summarize; transcribe every word on each line accurately in reading order.';

  const promptText =
    'Transcribe all text lines visible on this book page from top to bottom as a JSON object with a "lines" array of strings.';

  const modelsToTry: Array<{ name: string; useLowThinking: boolean }> = [
    { name: 'gemini-4-hydrogen', useLowThinking: true },
    { name: 'gemini-3.1-flash-lite', useLowThinking: false },
  ];

  const runOcrModel = async (modelSpec: {
    name: string;
    useLowThinking: boolean;
  }): Promise<{ page: number; lines: string[] }> => {
    const response = await ai.models.generateContent({
      model: modelSpec.name,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: cleanBase64,
            },
          },
          {
            text: promptText,
          },
        ],
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
            lines: {
              type: Type.ARRAY,
              items: {
                type: Type.STRING,
              },
              description: 'All lines of text on the page ordered from top to bottom.',
            },
          },
          required: ['lines'],
        },
      },
    });

    const rawText = (response.text ?? '{"lines":[]}').trim();
    const parsed = JSON.parse(rawText) as { lines?: string[] };
    const lines = Array.isArray(parsed.lines)
      ? parsed.lines.map(l => String(l || '').trim()).filter(Boolean)
      : [];
    return { page: pageInput.page, lines };
  };

  try {
    return await Promise.any(modelsToTry.map(spec => runOcrModel(spec)));
  } catch (err) {
    throw err instanceof Error ? err : new Error('Failed to OCR page with Gemini.');
  }
}

export default async function ocrHandler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = req.body as { pages?: PageInput[] };
    const pages = Array.isArray(body?.pages) ? body.pages.slice(0, 6) : [];

    if (pages.length === 0) {
      return res.status(400).json({ error: 'No pages provided for OCR scanning.' });
    }

    const ai = getAiClient();
    if (!ai) {
      // Signal the client to seamlessly run built-in browser OCR (Tesseract fas+eng)
      return res.status(200).json({ results: [], useClientOcr: true });
    }

    let anySucceeded = false;
    const results = await Promise.all(
      pages.map(async p => {
        try {
          const out = await transcribeSinglePage(ai, p);
          anySucceeded = true;
          return out;
        } catch (err) {
          console.warn(`OCR model fallback on page ${p.page}:`, err);
          return {
            page: p.page,
            lines: [],
            error: err instanceof Error ? err.message : 'OCR failed',
          };
        }
      })
    );

    if (!anySucceeded) {
      return res.status(200).json({ results: [], useClientOcr: true });
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.warn('OCR API fallback to client OCR:', err);
    return res.status(200).json({
      results: [],
      useClientOcr: true,
    });
  }
}

