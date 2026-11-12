import type { Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

let cachedAiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI | null {
  if (cachedAiClient) return cachedAiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  cachedAiClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return cachedAiClient;
}

export interface DictionaryLookupRequest {
  term: string;
  bookTitle?: string;
  bookAuthor?: string;
  pageContext?: string;
  mode?: 'instant' | 'ai';
}

export interface DictionaryLookupResult {
  word: string;
  pronunciation: string;
  partOfSpeech: string;
  persianMeaning: string;
  englishMeaning: string;
  contextExplanation: string;
  isAiEnhanced?: boolean;
}

const aiLookupCache = new Map<string, DictionaryLookupResult>();
const instantLookupCache = new Map<string, DictionaryLookupResult>();

async function fetchInstantLexicon(term: string): Promise<DictionaryLookupResult | null> {
  const cached = instantLookupCache.get(term.toLowerCase());
  if (cached) return cached;

  try {
    const encoded = encodeURIComponent(term);
    const [faRes, enRes] = await Promise.all([
      fetch(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=fa&dt=t&dt=bd&dt=rm&q=${encoded}`,
        { signal: AbortSignal.timeout(1500) }
      ),
      fetch(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=bd&dt=rm&q=${encoded}`,
        { signal: AbortSignal.timeout(1500) }
      ),
    ]);

    if (!faRes.ok && !enRes.ok) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const faData: any = faRes.ok ? await faRes.json() : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enData: any = enRes.ok ? await enRes.json() : null;

    const extractPrimaryTranslation = (data: unknown): string => {
      if (!Array.isArray(data) || !Array.isArray(data[0])) return '';
      return data[0]
        .map((seg: unknown) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
        .join('')
        .trim();
    };

    const extractDictMeanings = (data: unknown): { pos: string; meanings: string[] } => {
      if (!Array.isArray(data) || !Array.isArray(data[1])) {
        return { pos: '', meanings: [] };
      }
      const posList: string[] = [];
      const meanings: string[] = [];
      for (const entry of data[1]) {
        if (Array.isArray(entry)) {
          if (typeof entry[0] === 'string' && entry[0]) posList.push(entry[0]);
          if (Array.isArray(entry[1])) {
            for (const w of entry[1].slice(0, 6)) {
              if (typeof w === 'string' && w) meanings.push(w);
            }
          }
        }
      }
      return {
        pos: posList[0] || '',
        meanings: Array.from(new Set(meanings)).slice(0, 6),
      };
    };

    const extractPronunciation = (data: unknown): string => {
      if (!Array.isArray(data) || !Array.isArray(data[0])) return '';
      for (const seg of data[0]) {
        if (Array.isArray(seg) && typeof seg[3] === 'string' && seg[3]) return seg[3];
        if (Array.isArray(seg) && typeof seg[2] === 'string' && seg[2]) return seg[2];
      }
      return '';
    };

    const faPrimary = extractPrimaryTranslation(faData);
    const enPrimary = extractPrimaryTranslation(enData);
    const faDict = extractDictMeanings(faData);
    const enDict = extractDictMeanings(enData);
    const pron = extractPronunciation(faData) || extractPronunciation(enData);

    const persianMeaning = [
      faPrimary,
      faDict.meanings.filter(m => m !== faPrimary).join('، '),
    ]
      .filter(Boolean)
      .join(' — ');

    const englishMeaning = [
      enPrimary,
      enDict.meanings.filter(m => m.toLowerCase() !== enPrimary.toLowerCase()).join(', '),
    ]
      .filter(Boolean)
      .join(' — ');

    if (!persianMeaning && !englishMeaning) return null;

    const result: DictionaryLookupResult = {
      word: term,
      pronunciation: pron,
      partOfSpeech: enDict.pos || faDict.pos || (term.includes(' ') ? 'Phrase' : 'Word'),
      persianMeaning: persianMeaning || term,
      englishMeaning: englishMeaning || term,
      contextExplanation: '',
      isAiEnhanced: false,
    };

    instantLookupCache.set(term.toLowerCase(), result);
    return result;
  } catch {
    return null;
  }
}

async function fetchDeepGeminiDefinition(
  term: string,
  bookInfo: string,
  pageSnippet: string
): Promise<DictionaryLookupResult | null> {
  const ai = getAiClient();
  if (!ai) return null;

  const systemInstruction =
    'You are a master literary scholar, Persian/Arabic/English lexicographer (like Dehkhoda, Moein, and Oxford), and book companion. ' +
    'Given a word, idiom, or phrase from a book, provide a rich, deeply accurate explanation: ' +
    '1) In Persian (فارسی): Explain its exact meaning, synonyms, literary or classical root/etymology, and subtle nuances in fluent Persian. ' +
    '2) In English: Provide a precise English definition, nuances, and equivalents. ' +
    '3) In Context: Explain what the author means by this word/phrase in the context of the book and page.';

  const prompt = [
    `Word or Phrase: "${term}"`,
    bookInfo ? `Book: ${bookInfo}` : '',
    pageSnippet ? `Page Excerpt:\n"${pageSnippet}"` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const modelsToTry: Array<{ name: string; useLowThinking: boolean }> = [
    { name: 'gemini-3.8-flash', useLowThinking: true },
    { name: 'gemini-flash-latest', useLowThinking: false },
    { name: 'gemini-3.1-flash-lite', useLowThinking: false },
  ];

  const runModel = async (modelSpec: {
    name: string;
    useLowThinking: boolean;
  }): Promise<DictionaryLookupResult> => {
    const response = await ai.models.generateContent({
      model: modelSpec.name,
      contents: prompt,
      config: {
        systemInstruction,
        ...(modelSpec.useLowThinking
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            pronunciation: {
              type: Type.STRING,
              description: 'Phonetic pronunciation and vowel markings (حرکت‌گذاری / تلفظ).',
            },
            partOfSpeech: {
              type: Type.STRING,
              description: 'Part of speech in English and Persian (e.g. Noun / اسم).',
            },
            persianMeaning: {
              type: Type.STRING,
              description:
                'Rich, accurate Persian definition, synonyms, and literary meaning (در ۲ تا ۳ جمله دقیق و روان).',
            },
            englishMeaning: {
              type: Type.STRING,
              description: 'Precise English definition and nuances (1-2 clear sentences).',
            },
            contextExplanation: {
              type: Type.STRING,
              description:
                'Deep literary, philosophical, or contextual explanation of this word/phrase in the book (written in the same language as the book/word).',
            },
          },
          required: [
            'word',
            'pronunciation',
            'partOfSpeech',
            'persianMeaning',
            'englishMeaning',
            'contextExplanation',
          ],
        },
      },
    });

    const rawJson = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawJson) as DictionaryLookupResult;
    if (!parsed.persianMeaning && !parsed.englishMeaning) {
      throw new Error('Empty definition returned');
    }
    return {
      ...parsed,
      isAiEnhanced: true,
    };
  };

  try {
    return await Promise.any(modelsToTry.map(spec => runModel(spec)));
  } catch {
    return null;
  }
}

export default async function dictionaryHandler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = (req.body || {}) as DictionaryLookupRequest;
    const term = String(body.term || '').trim();
    const mode = body.mode || 'ai';

    if (!term) {
      return res.status(400).json({ error: 'Please provide a word or phrase to look up.' });
    }

    const aiCacheKey = `${term.toLowerCase()}::${(body.bookTitle || '').toLowerCase()}`;
    const cachedAi = aiLookupCache.get(aiCacheKey);
    if (cachedAi) {
      return res.status(200).json({ result: cachedAi });
    }

    // Fast ~150ms preview mode for immediate UI display while deep AI analysis runs
    if (mode === 'instant') {
      const fastResult = await fetchInstantLexicon(term);
      if (fastResult) {
        return res.status(200).json({ result: fastResult });
      }
    }

    const bookInfo = [body.bookTitle, body.bookAuthor].filter(Boolean).join(' by ');
    const pageSnippet = String(body.pageContext || '').slice(0, 600).trim();

    const [deepAiResult, lexiconFallback] = await Promise.all([
      fetchDeepGeminiDefinition(term, bookInfo, pageSnippet),
      fetchInstantLexicon(term),
    ]);

    const finalResult = deepAiResult
      ? {
          ...deepAiResult,
          pronunciation: deepAiResult.pronunciation || lexiconFallback?.pronunciation || '',
          isAiEnhanced: true,
        }
      : lexiconFallback;

    if (!finalResult) {
      return res.status(500).json({ error: 'Could not define or translate this word.' });
    }

    if (finalResult.isAiEnhanced) {
      if (aiLookupCache.size >= 400) {
        const oldestKey = aiLookupCache.keys().next().value;
        if (oldestKey) aiLookupCache.delete(oldestKey);
      }
      aiLookupCache.set(aiCacheKey, finalResult);
    }

    return res.status(200).json({ result: finalResult });
  } catch (err) {
    console.error('Dictionary lookup error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Dictionary lookup failed.',
    });
  }
}
