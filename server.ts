import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const SESSION_CACHE_FILE = path.resolve(__dirname, '.telegram-session');

// Official open-source Telegram Desktop client credentials as a zero-config fallback
// so users never get stuck on my.telegram.org's "Create new application" ERROR bug.
const DEFAULT_API_ID = 2040;
const DEFAULT_API_HASH = 'b18441a1ff607e10a989891a5462e627';

// Cached Telegram MTProto client instance
let cachedClient: TelegramClient | null = null;
let cachedSessionStr = '';

// Pending interactive login state
let pendingAuthClient: TelegramClient | null = null;
let pendingPhoneNumber = '';
let pendingPhoneCodeHash = '';

function getApiCredentials(): { apiId: number; apiHash: string } {
  const envId = Number.parseInt((process.env.TELEGRAM_API_ID || '').trim(), 10);
  const envHash = (process.env.TELEGRAM_API_HASH || '').trim();
  if (envId && !Number.isNaN(envId) && envHash) {
    return { apiId: envId, apiHash: envHash };
  }
  return { apiId: DEFAULT_API_ID, apiHash: DEFAULT_API_HASH };
}

function getSavedSessionString(): string {
  const envSession = (process.env.TELEGRAM_SESSION || '').trim();
  if (envSession) return envSession;
  try {
    if (fs.existsSync(SESSION_CACHE_FILE)) {
      return fs.readFileSync(SESSION_CACHE_FILE, 'utf-8').trim();
    }
  } catch {
    // ignore read error
  }
  return cachedSessionStr;
}

function saveSessionString(sessionStr: string) {
  cachedSessionStr = sessionStr;
  try {
    fs.writeFileSync(SESSION_CACHE_FILE, sessionStr, 'utf-8');
  } catch (err) {
    console.warn('Could not persist .telegram-session file:', err);
  }
}

/**
 * Normalizes a user-provided Telegram channel input:
 * - "https://t.me/s/mybooks" -> "mybooks"
 * - "https://t.me/mybooks" -> "mybooks"
 * - "@mybooks" -> "mybooks"
 */
export function normalizeTelegramChannel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/(?:https?:\/\/)?t\.me\/(?:s\/)?([a-zA-Z0-9_]+)/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  return trimmed.replace(/^@/, '');
}

async function getTelegramClient(): Promise<TelegramClient> {
  const { apiId, apiHash } = getApiCredentials();
  const sessionStr = getSavedSessionString();

  if (!sessionStr) {
    throw new Error(
      'Not signed in to Telegram yet. Use the quick Sign In box above (just your phone number & Telegram code — no my.telegram.org needed!).'
    );
  }

  if (cachedClient && cachedClient.connected) {
    return cachedClient;
  }

  const stringSession = new StringSession(sessionStr);
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 3,
  });

  await client.connect();
  cachedClient = client;
  return client;
}

/**
 * Extracts PDF metadata from a GramJS Message if the message contains a PDF document attachment.
 */
function extractPdfFromMessage(
  msg: Api.Message,
  channelUsername: string,
  channelTitle: string
): {
  messageId: number;
  fileName: string;
  fileSize: number;
  date: string;
  caption: string;
  channelTitle: string;
  channelUsername: string;
} | null {
  if (!msg || !msg.media) return null;
  if (!(msg.media instanceof Api.MessageMediaDocument)) return null;

  const doc = msg.media.document;
  if (!(doc instanceof Api.Document)) return null;

  const mimeType = (doc.mimeType || '').toLowerCase();
  let fileName = `telegram_book_${msg.id}.pdf`;

  for (const attr of doc.attributes || []) {
    if (attr instanceof Api.DocumentAttributeFilename && attr.fileName) {
      fileName = attr.fileName;
      break;
    }
  }

  const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
  if (!isPdf) return null;

  const fileSize = Number(doc.size?.toString() || '0');
  const dateObj = msg.date ? new Date(msg.date * 1000) : new Date();

  return {
    messageId: msg.id,
    fileName: fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`,
    fileSize,
    date: dateObj.toISOString(),
    caption: (msg.message || '').trim(),
    channelTitle,
    channelUsername,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // 1. Check Telegram MTProto configuration status
  app.get('/api/telegram/status', (_req, res) => {
    const hasSession = Boolean(getSavedSessionString());
    const defaultChannel = normalizeTelegramChannel(process.env.TELEGRAM_CHANNEL || '');

    res.json({
      configured: hasSession,
      hasApiId: true,
      hasApiHash: true,
      hasSession,
      defaultChannel,
    });
  });

  // 1b. Interactive Step 1: Send login code to phone number (no my.telegram.org required!)
  app.post('/api/telegram/auth/send-code', async (req, res) => {
    try {
      const phoneNumber = String(req.body?.phoneNumber || '').trim();
      if (!phoneNumber) {
        res.status(400).json({ error: 'Please enter your phone number in international format (e.g. +1234567890).' });
        return;
      }

      const { apiId, apiHash } = getApiCredentials();
      const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 3,
      });
      await client.connect();

      const result = await client.sendCode({ apiId, apiHash }, phoneNumber);
      pendingAuthClient = client;
      pendingPhoneNumber = phoneNumber;
      pendingPhoneCodeHash = result.phoneCodeHash;

      res.json({ ok: true, phoneNumber });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send Telegram verification code.';
      console.error('[/api/telegram/auth/send-code] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // 1c. Interactive Step 2: Verify login code (and optional 2FA password)
  app.post('/api/telegram/auth/verify-code', async (req, res) => {
    try {
      const phoneCode = String(req.body?.phoneCode || '').trim();
      const password = String(req.body?.password || '').trim();

      if (!pendingAuthClient || !pendingPhoneNumber || !pendingPhoneCodeHash) {
        res.status(400).json({ error: 'No pending login session. Please click "Send Code" first.' });
        return;
      }

      if (!phoneCode) {
        res.status(400).json({ error: 'Please enter the verification code sent to your Telegram app.' });
        return;
      }

      const { apiId, apiHash } = getApiCredentials();

      try {
        await pendingAuthClient.invoke(
          new Api.auth.SignIn({
            phoneNumber: pendingPhoneNumber,
            phoneCodeHash: pendingPhoneCodeHash,
            phoneCode,
          })
        );
      } catch (signInErr: unknown) {
        const errMsg = signInErr instanceof Error ? signInErr.message : String(signInErr);
        if (errMsg.includes('SESSION_PASSWORD_NEEDED')) {
          if (!password) {
            res.status(401).json({
              needsPassword: true,
              error: 'Your Telegram account has 2-Step Verification (2FA) enabled. Please enter your 2FA password below.',
            });
            return;
          }
          await pendingAuthClient.signInWithPassword(
            { apiId, apiHash },
            {
              password: async () => password,
              onError: e => {
                throw e;
              },
            }
          );
        } else {
          throw signInErr;
        }
      }

      const sessionString = (pendingAuthClient.session.save() as unknown as string) || '';
      saveSessionString(sessionString);
      cachedClient = pendingAuthClient;
      pendingAuthClient = null;

      res.json({
        ok: true,
        configured: true,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to verify Telegram code.';
      console.error('[/api/telegram/auth/verify-code] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // 1d. Disconnect / sign out Telegram session
  app.post('/api/telegram/auth/logout', (_req, res) => {
    cachedSessionStr = '';
    cachedClient = null;
    try {
      if (fs.existsSync(SESSION_CACHE_FILE)) {
        fs.unlinkSync(SESSION_CACHE_FILE);
      }
    } catch {
      // ignore
    }
    res.json({ ok: true });
  });

  // 2. Fetch recent PDF messages from a Telegram channel
  app.get('/api/telegram/channel-pdfs', async (req, res) => {
    try {
      const rawChannel = String(req.query.channel || process.env.TELEGRAM_CHANNEL || '');
      const channel = normalizeTelegramChannel(rawChannel);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));

      if (!channel) {
        res.status(400).json({ error: 'Please provide a Telegram channel username (e.g. @channelname).' });
        return;
      }

      const client = await getTelegramClient();
      const entity = await client.getEntity(channel);
      const channelTitle =
        (entity && 'title' in entity && typeof entity.title === 'string' && entity.title) || `@${channel}`;

      const messages = await client.getMessages(entity, { limit });
      const pdfItems = [];

      for (const msg of messages) {
        if (msg instanceof Api.Message) {
          const extracted = extractPdfFromMessage(msg, channel, channelTitle);
          if (extracted) {
            pdfItems.push(extracted);
          }
        }
      }

      res.json({
        channel,
        channelTitle,
        pdfs: pdfItems,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch channel messages from Telegram.';
      console.error('[/api/telegram/channel-pdfs] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // 3. Download a specific PDF document binary from a Telegram channel via MTProto
  app.get('/api/telegram/download-pdf', async (req, res) => {
    try {
      const rawChannel = String(req.query.channel || process.env.TELEGRAM_CHANNEL || '');
      const channel = normalizeTelegramChannel(rawChannel);
      const messageId = Number.parseInt(String(req.query.messageId || ''), 10);

      if (!channel || !messageId || Number.isNaN(messageId)) {
        res.status(400).json({ error: 'Both channel and messageId query parameters are required.' });
        return;
      }

      const client = await getTelegramClient();
      const entity = await client.getEntity(channel);
      const messages = await client.getMessages(entity, { ids: [messageId] });
      const msg = messages?.[0];

      if (!msg || !(msg instanceof Api.Message)) {
        res.status(404).json({ error: `Message #${messageId} not found in @${channel}.` });
        return;
      }

      const meta = extractPdfFromMessage(msg, channel, channel);
      if (!meta) {
        res.status(400).json({ error: `Message #${messageId} does not contain a valid PDF document.` });
        return;
      }

      const buffer = await client.downloadMedia(msg, {});
      if (!buffer || !(buffer instanceof Buffer)) {
        res.status(500).json({ error: 'Failed to download PDF binary stream from Telegram MTProto.' });
        return;
      }

      const safeFilename = encodeURIComponent(meta.fileName);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(buffer.byteLength));
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('X-Telegram-Filename', safeFilename);
      res.setHeader('X-Telegram-Message-Id', String(meta.messageId));
      res.send(buffer);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to download PDF from Telegram.';
      console.error('[/api/telegram/download-pdf] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // Mount Vite dev server or production static files
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Folio server running on http://0.0.0.0:${PORT}`);
  });
}

// Only start listening if not imported by a unit test
if (process.env.NODE_ENV !== 'test') {
  startServer().catch(err => {
    console.error('Failed to start Folio server:', err);
  });
}
