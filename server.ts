import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import telegramHandler, { normalizeTelegramChannel } from './api/telegram.js';
import ocrHandler from './api/ocr.js';
import dictionaryHandler from './api/dictionary.js';
import chaptersHandler from './api/chapters.js';
import { requireAuth, AuthRequest } from './src/middleware/auth.ts';
import {
  getUserLibraryFromSql,
  syncUserLibraryToSql,
  saveVocabularyToSql,
} from './src/db/users.ts';

export { normalizeTelegramChannel };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '25mb' }));

  // Delegate all /api/telegram/* requests to the unified Vercel/Express handler
  app.use('/api/telegram', (req, res) => {
    return telegramHandler(req, res);
  });

  // Fast Gemini OCR endpoint for scanning PDF pages
  app.use('/api/ocr', (req, res) => {
    return ocrHandler(req, res);
  });

  // Instant On-Page Dictionary, Word Translator & Literary Explainer endpoint
  app.use('/api/dictionary', (req, res) => {
    return dictionaryHandler(req, res);
  });

  // AI Table of Contents & Chapter Page-Range Extractor endpoint
  app.use('/api/chapters', (req, res) => {
    return chaptersHandler(req, res);
  });

  // Authenticated Cloud SQL (PostgreSQL) endpoints
  app.get('/api/cloudsql/library', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid || '';
      const email = req.user?.email || 'reader@folio.app';
      const displayName = req.user?.name || email.split('@')[0] || 'Reader';
      const data = await getUserLibraryFromSql(uid, email, displayName);
      res.json(data);
    } catch (error) {
      console.error('Failed to fetch Cloud SQL library:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch Cloud SQL library',
      });
    }
  });

  app.post('/api/cloudsql/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid || '';
      const email = req.user?.email || 'reader@folio.app';
      const displayName =
        String(req.body?.displayName || req.user?.name || email.split('@')[0] || 'Reader');
      const booksInput = Array.isArray(req.body?.books) ? req.body.books : [];
      const notesInput = Array.isArray(req.body?.notes) ? req.body.notes : [];
      const data = await syncUserLibraryToSql(uid, email, displayName, booksInput, notesInput);
      res.json(data);
    } catch (error) {
      console.error('Failed to sync library to Cloud SQL:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to sync library to Cloud SQL',
      });
    }
  });

  app.post('/api/cloudsql/vocabulary', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid || '';
      const email = req.user?.email || 'reader@folio.app';
      const saved = await saveVocabularyToSql(uid, email, {
        word: String(req.body?.word || ''),
        partOfSpeech: String(req.body?.partOfSpeech || ''),
        persianMeaning: String(req.body?.persianMeaning || ''),
        englishMeaning: String(req.body?.englishMeaning || ''),
        contextExplanation: String(req.body?.contextExplanation || ''),
        bookTitle: String(req.body?.bookTitle || ''),
        page: Number(req.body?.page) || 1,
      });
      res.json({ entry: saved });
    } catch (error) {
      console.error('Failed to save vocabulary to Cloud SQL:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to save vocabulary to Cloud SQL',
      });
    }
  });

  // Mount Vite dev server or production static files
  if (process.env.NODE_ENV !== 'production') {
    // Ensure any previously registered Service Worker in the dev preview unregisters immediately
    app.get(['/sw.js', '/dev-sw.js', '/registerSW.js'], (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'no-store');
      res.send(
        `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => {
  self.registration.unregister().then(() => self.clients.matchAll()).then(clients => {
    clients.forEach(client => client.navigate(client.url));
  });
});`
      );
    });

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: httpServer,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Folio server running on http://0.0.0.0:${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch(err => {
    console.error('Failed to start Folio server:', err);
  });
}
