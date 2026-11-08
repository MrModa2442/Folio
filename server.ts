import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import telegramHandler, { normalizeTelegramChannel } from './api/telegram.js';

export { normalizeTelegramChannel };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json());

  // Delegate all /api/telegram/* requests to the unified Vercel/Express handler
  app.use('/api/telegram', (req, res) => {
    return telegramHandler(req, res);
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
