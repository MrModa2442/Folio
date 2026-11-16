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
import cloudsqlHandler, {
  deleteCloudPdfBuffer,
  loadCloudPdfBuffer,
  saveCloudPdfBuffer,
  resolveUserFromRequest,
} from './api/cloudsql.js';
import { requireAuth, AuthRequest } from './src/middleware/auth.ts';
import { isSqlConfigured } from './src/db/index.ts';
import {
  getUserLibraryFromSql,
  syncUserLibraryToSql,
  saveVocabularyToSql,
  saveBookPdfChunkToSql,
  loadBookPdfBufferFromSql,
} from './src/db/users.ts';

export { normalizeTelegramChannel };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

let sqlCooldownUntil = 0;

function canAttemptSql(): boolean {
  return isSqlConfigured() && Date.now() >= sqlCooldownUntil;
}

async function withSqlTimeout<T>(promise: Promise<T>, ms = 2500): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SQL operation timed out')), ms)
    ),
  ]);
}

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

  // Cloud PDF upload/download endpoint for cross-device PDF sync (Disk Cache + PostgreSQL Chunk Storage)
  app.all('/api/cloudsql/pdf', async (req, res) => {
    const resolvedUser = resolveUserFromRequest(req);
    if (resolvedUser && req.method === 'POST' && canAttemptSql()) {
      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
        const bookKey = String(body.bookKey || '').trim();
        const title = String(body.title || '').trim();
        const pdfBase64 = String(body.pdfBase64 || '').trim().replace(/^data:application\/pdf;base64,/, '');
        const chunkIndex = Math.max(0, Number(body.chunkIndex) || 0);
        const totalChunks = Math.max(1, Number(body.totalChunks) || 1);
        if (bookKey && pdfBase64) {
          await withSqlTimeout(
            saveBookPdfChunkToSql(
              resolvedUser.uid,
              resolvedUser.email,
              bookKey,
              title,
              chunkIndex,
              totalChunks,
              pdfBase64
            ),
            4000
          ).catch(() => {});
        }
      } catch {
        // continue to local cloud store handler
      }
    }

    if (resolvedUser && req.method === 'GET') {
      const userKey = (resolvedUser.email || resolvedUser.uid).trim().toLowerCase();
      const bookKey = String(req.query?.bookKey || '').trim();
      const title = String(req.query?.title || '').trim();
      let buf = loadCloudPdfBuffer(userKey, bookKey, title);
      if (!buf && canAttemptSql() && (bookKey || title)) {
        try {
          buf = await withSqlTimeout(
            loadBookPdfBufferFromSql(resolvedUser.uid, resolvedUser.email, bookKey, title),
            4000
          );
          if (buf && buf.byteLength > 100) {
            saveCloudPdfBuffer(userKey, bookKey || title, buf, title);
          }
        } catch {
          // fallback below
        }
      }
      if (buf && buf.byteLength > 100) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', String(buf.byteLength));
        return res.status(200).send(buf);
      }
    }

    return cloudsqlHandler(req, res);
  });

  // Authenticated Cloud SQL (PostgreSQL) endpoints with instant fallback store
  app.get('/api/cloudsql/library', requireAuth, async (req: AuthRequest, res) => {
    if (!canAttemptSql()) {
      return cloudsqlHandler(req, res);
    }
    try {
      const uid = req.user?.uid || '';
      const email = req.user?.email || 'reader@folio.app';
      const displayName = req.user?.name || email.split('@')[0] || 'Reader';
      const userKey = (email || uid).trim().toLowerCase();
      const data = await withSqlTimeout(getUserLibraryFromSql(uid, email, displayName), 2500);
      data.books = data.books.map(b => ({
        ...b,
        hasCloudPdf: Boolean(
          b.hasCloudPdf || loadCloudPdfBuffer(userKey, b.bookKey, b.title) !== null
        ),
      }));
      res.json(data);
    } catch (error) {
      sqlCooldownUntil = Date.now() + 60_000;
      console.warn('Cloud SQL library fallback to local cloud store:', error);
      return cloudsqlHandler(req, res);
    }
  });

  app.post('/api/cloudsql/sync', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.user?.uid || '';
    const email = req.user?.email || 'reader@folio.app';
    const deletedBookKeys = Array.isArray(req.body?.deletedBookKeys)
      ? req.body.deletedBookKeys.map(String)
      : [];
    const userKey = (email || uid).trim().toLowerCase();
    for (const dk of deletedBookKeys) {
      deleteCloudPdfBuffer(userKey, dk);
    }

    if (!canAttemptSql()) {
      return cloudsqlHandler(req, res);
    }

    try {
      const displayName =
        String(req.body?.displayName || req.user?.name || email.split('@')[0] || 'Reader');
      const booksInput = Array.isArray(req.body?.books) ? req.body.books : [];
      const notesInput = Array.isArray(req.body?.notes) ? req.body.notes : [];
      const readdedBookKeys = Array.isArray(req.body?.readdedBookKeys)
        ? req.body.readdedBookKeys.map(String)
        : [];

      const data = await withSqlTimeout(
        syncUserLibraryToSql(
          uid,
          email,
          displayName,
          booksInput,
          notesInput,
          deletedBookKeys,
          readdedBookKeys
        ),
        2500
      );
      res.json(data);
    } catch (error) {
      sqlCooldownUntil = Date.now() + 60_000;
      console.warn('Cloud SQL sync fallback to local cloud store:', error);
      return cloudsqlHandler(req, res);
    }
  });

  app.post('/api/cloudsql/vocabulary', requireAuth, async (req: AuthRequest, res) => {
    if (!canAttemptSql()) {
      return cloudsqlHandler(req, res);
    }
    try {
      const uid = req.user?.uid || '';
      const email = req.user?.email || 'reader@folio.app';
      const saved = await withSqlTimeout(
        saveVocabularyToSql(uid, email, {
          word: String(req.body?.word || ''),
          partOfSpeech: String(req.body?.partOfSpeech || ''),
          persianMeaning: String(req.body?.persianMeaning || ''),
          englishMeaning: String(req.body?.englishMeaning || ''),
          contextExplanation: String(req.body?.contextExplanation || ''),
          bookTitle: String(req.body?.bookTitle || ''),
          page: Number(req.body?.page) || 1,
        }),
        2500
      );
      res.json({ entry: saved });
    } catch (error) {
      sqlCooldownUntil = Date.now() + 60_000;
      console.warn('Cloud SQL vocabulary fallback to local cloud store:', error);
      return cloudsqlHandler(req, res);
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
