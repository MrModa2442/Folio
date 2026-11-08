import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const DEFAULT_API_ID = 2040;
const DEFAULT_API_HASH = 'b18441a1ff607e10a989891a5462e627';

function getApiCredentials(): { apiId: number; apiHash: string } {
  const envId = Number.parseInt((process.env.TELEGRAM_API_ID || '').trim(), 10);
  const envHash = (process.env.TELEGRAM_API_HASH || '').trim();
  if (envId && !Number.isNaN(envId) && envHash) {
    return { apiId: envId, apiHash: envHash };
  }
  return { apiId: DEFAULT_API_ID, apiHash: DEFAULT_API_HASH };
}

export function normalizeTelegramChannel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/(?:https?:\/\/)?t\.me\/(?:s\/)?([a-zA-Z0-9_]+)/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  return trimmed.replace(/^@/, '');
}

function extractPdfFromMessage(
  msg: Api.Message,
  channelUsername: string,
  channelTitle: string
) {
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

// Vercel Serverless Function Handler (Stateless MTProto support)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  const rawUrl = req.originalUrl || req.url || '/';
  const urlObj = new URL(rawUrl, 'http://localhost');
  const actionParam = String(req.query?.action || '');
  const pathname = urlObj.pathname.replace(/^\/api\/telegram\/?/, '').replace(/^\//, '') || actionParam;

  const headerSession = String(req.headers?.['x-telegram-session'] || '').trim();
  const querySession = String(req.query?.session || '').trim();
  const envSession = (process.env.TELEGRAM_SESSION || '').trim();
  const activeSession = headerSession || querySession || envSession;

  const { apiId, apiHash } = getApiCredentials();

  try {
    // 1. GET /api/telegram/status
    if (pathname === 'status' || pathname === '') {
      const defaultChannel = normalizeTelegramChannel(process.env.TELEGRAM_CHANNEL || '');
      return res.status(200).json({
        configured: Boolean(activeSession),
        hasApiId: true,
        hasApiHash: true,
        hasSession: Boolean(activeSession),
        defaultChannel,
      });
    }

    // 2. POST /api/telegram/auth/send-code
    if (pathname === 'auth/send-code' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const phoneNumber = String(body.phoneNumber || '').trim();
      if (!phoneNumber) {
        return res.status(400).json({
          error: 'Please enter your phone number in international format (e.g. +1234567890).',
        });
      }

      const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 3,
      });
      await client.connect();

      const result = await client.sendCode({ apiId, apiHash }, phoneNumber);
      const pendingSession = (client.session.save() as unknown as string) || '';
      await client.disconnect();

      return res.status(200).json({
        ok: true,
        phoneNumber,
        phoneCodeHash: result.phoneCodeHash,
        pendingSession,
      });
    }

    // 3. POST /api/telegram/auth/verify-code
    if (pathname === 'auth/verify-code' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const phoneNumber = String(body.phoneNumber || '').trim();
      const phoneCode = String(body.phoneCode || '').trim();
      const phoneCodeHash = String(body.phoneCodeHash || '').trim();
      const pendingSession = String(body.pendingSession || '').trim();
      const password = String(body.password || '').trim();

      if (!phoneNumber || !phoneCodeHash || !pendingSession) {
        return res.status(400).json({
          error: 'Session expired. Please click "Send Login Code" again.',
        });
      }

      if (!phoneCode) {
        return res.status(400).json({
          error: 'Please enter the 5-digit verification code sent to your Telegram app.',
        });
      }

      const client = new TelegramClient(new StringSession(pendingSession), apiId, apiHash, {
        connectionRetries: 3,
      });
      await client.connect();

      try {
        await client.invoke(
          new Api.auth.SignIn({
            phoneNumber,
            phoneCodeHash,
            phoneCode,
          })
        );
      } catch (signInErr: unknown) {
        const errMsg = signInErr instanceof Error ? signInErr.message : String(signInErr);
        if (errMsg.includes('SESSION_PASSWORD_NEEDED')) {
          if (!password) {
            await client.disconnect();
            return res.status(401).json({
              needsPassword: true,
              error: 'Your Telegram account has 2-Step Verification (2FA) enabled. Enter your 2FA password below.',
            });
          }
          await client.signInWithPassword(
            { apiId, apiHash },
            {
              password: async () => password,
              onError: e => {
                throw e;
              },
            }
          );
        } else {
          await client.disconnect();
          throw signInErr;
        }
      }

      const sessionString = (client.session.save() as unknown as string) || '';
      await client.disconnect();

      return res.status(200).json({
        ok: true,
        configured: true,
        sessionString,
      });
    }

    // 4. POST /api/telegram/auth/logout
    if (pathname === 'auth/logout') {
      return res.status(200).json({ ok: true });
    }

    // 5. GET /api/telegram/channel-pdfs
    if (pathname === 'channel-pdfs') {
      const rawChannel = String(req.query?.channel || process.env.TELEGRAM_CHANNEL || '');
      const channel = normalizeTelegramChannel(rawChannel);
      const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 25));

      if (!channel) {
        return res.status(400).json({
          error: 'Please provide a Telegram channel username (e.g. @channelname).',
        });
      }

      if (!activeSession) {
        return res.status(401).json({
          error: 'Please sign in with your phone number above first to connect to Telegram.',
        });
      }

      const client = new TelegramClient(new StringSession(activeSession), apiId, apiHash, {
        connectionRetries: 3,
      });
      await client.connect();

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

      await client.disconnect();

      return res.status(200).json({
        channel,
        channelTitle,
        pdfs: pdfItems,
      });
    }

    // 6. GET /api/telegram/download-pdf
    if (pathname === 'download-pdf') {
      const rawChannel = String(req.query?.channel || process.env.TELEGRAM_CHANNEL || '');
      const channel = normalizeTelegramChannel(rawChannel);
      const messageId = Number.parseInt(String(req.query?.messageId || ''), 10);

      if (!channel || !messageId || Number.isNaN(messageId)) {
        return res.status(400).json({
          error: 'Both channel and messageId query parameters are required.',
        });
      }

      if (!activeSession) {
        return res.status(401).json({
          error: 'Not signed in to Telegram. Please sign in first.',
        });
      }

      const client = new TelegramClient(new StringSession(activeSession), apiId, apiHash, {
        connectionRetries: 3,
      });
      await client.connect();

      const entity = await client.getEntity(channel);
      const messages = await client.getMessages(entity, { ids: [messageId] });
      const msg = messages?.[0];

      if (!msg || !(msg instanceof Api.Message)) {
        await client.disconnect();
        return res.status(404).json({ error: `Message #${messageId} not found in @${channel}.` });
      }

      const meta = extractPdfFromMessage(msg, channel, channel);
      if (!meta) {
        await client.disconnect();
        return res.status(400).json({ error: `Message #${messageId} does not contain a valid PDF document.` });
      }

      const buffer = await client.downloadMedia(msg, {});
      await client.disconnect();

      if (!buffer || !(buffer instanceof Buffer)) {
        return res.status(500).json({ error: 'Failed to download PDF binary stream from Telegram.' });
      }

      const safeFilename = encodeURIComponent(meta.fileName);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(buffer.byteLength));
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('X-Telegram-Filename', safeFilename);
      res.setHeader('X-Telegram-Message-Id', String(meta.messageId));
      return res.status(200).send(buffer);
    }

    return res.status(404).json({ error: `Unknown Telegram API route: ${pathname}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Telegram server error.';
    console.error('[/api/telegram] Error:', message);
    return res.status(500).json({ error: message });
  }
}
