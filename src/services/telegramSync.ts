import { Book, CoverPattern, TelegramConfigStatus, TelegramPdfItem } from '../types/library';
import { extractPdfMetadata } from '../utils/pdfParser';
import { storePdfBlob } from './db';

const PALETTE = [
  '#1E293B', // Slate
  '#27272A', // Charcoal
  '#3D2817', // Umber
  '#14532D', // Spruce
  '#581C1A', // Wine
  '#1E1B4B', // Indigo
];

export function normalizeChannelInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/(?:https?:\/\/)?t\.me\/(?:s\/)?([a-zA-Z0-9_]+)/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  return trimmed.replace(/^@/, '');
}

export async function fetchTelegramStatus(): Promise<TelegramConfigStatus> {
  const res = await fetch('/api/telegram/status');
  if (!res.ok) {
    throw new Error('Could not check Telegram server status.');
  }
  return res.json();
}

export async function fetchChannelPdfs(
  channel: string,
  limit = 20
): Promise<{ channel: string; channelTitle: string; pdfs: TelegramPdfItem[] }> {
  const cleanChannel = normalizeChannelInput(channel);
  const res = await fetch(
    `/api/telegram/channel-pdfs?channel=${encodeURIComponent(cleanChannel)}&limit=${limit}`
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch PDFs from Telegram channel.');
  }
  return data;
}

export async function downloadAndImportTelegramPdf(
  item: TelegramPdfItem
): Promise<Book> {
  const cleanChannel = normalizeChannelInput(item.channelUsername);
  const url = `/api/telegram/download-pdf?channel=${encodeURIComponent(
    cleanChannel
  )}&messageId=${encodeURIComponent(String(item.messageId))}`;

  const res = await fetch(url);
  if (!res.ok) {
    let errMsg = `Failed to download PDF (#${item.messageId}).`;
    try {
      const errJson = await res.json();
      if (errJson.error) errMsg = errJson.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(errMsg);
  }

  const arrayBuffer = await res.arrayBuffer();
  const fileName = item.fileName.toLowerCase().endsWith('.pdf')
    ? item.fileName
    : `${item.fileName}.pdf`;

  const file = new File([arrayBuffer], fileName, { type: 'application/pdf' });
  const metadata = await extractPdfMetadata(file);

  const bookId = `tg_${cleanChannel}_${item.messageId}`;
  await storePdfBlob(bookId, file);

  const colorIndex =
    Math.abs(
      metadata.title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    ) % PALETTE.length;
  const spineColor = PALETTE[colorIndex];
  const patterns: CoverPattern[] = ['classical', 'minimal', 'botanical', 'geometric'];
  const coverPattern = patterns[colorIndex % patterns.length];

  return {
    id: bookId,
    title: metadata.title,
    author: metadata.author,
    fileName,
    fileSize: file.size || item.fileSize,
    pageCount: metadata.pageCount,
    currentPage: 1,
    status: 'to-read',
    spineColor,
    spineTexture: 'leather',
    coverPattern,
    notes: item.caption || `Synced from Telegram @${cleanChannel}`,
    dateAdded: new Date().toISOString().split('T')[0],
    lastRead: null,
    pdfBlobKey: bookId,
    telegramChannel: cleanChannel,
    telegramMessageId: item.messageId,
  };
}
