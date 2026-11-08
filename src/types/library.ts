export type ReadingStatus = 'to-read' | 'reading' | 'completed';

export type SpineTexture = 'linen' | 'leather' | 'cloth' | 'smooth';

export type CoverPattern = 'minimal' | 'botanical' | 'geometric' | 'classical' | 'embossed';

export interface Book {
  id: string;
  title: string;
  author: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  currentPage: number;
  status: ReadingStatus;
  spineColor: string;
  spineTexture: SpineTexture;
  coverPattern: CoverPattern;
  notes?: string;
  rating?: number;
  dateAdded: string;
  lastRead?: string | null;
  pdfBlobKey?: string;
  telegramChannel?: string;
  telegramMessageId?: number;
}

export interface TelegramPdfItem {
  messageId: number;
  fileName: string;
  fileSize: number;
  date: string;
  caption: string;
  channelTitle: string;
  channelUsername: string;
}

export interface TelegramConfigStatus {
  configured: boolean;
  hasApiId: boolean;
  hasApiHash: boolean;
  hasSession: boolean;
  defaultChannel: string;
}

export interface Collaborator {
  id: string;
  email: string;
  name: string;
  role: 'viewer' | 'editor';
  avatarColor: string;
  addedAt: string;
}

export type CoverArtStyle = 'autumn' | 'coffee' | 'scholar' | 'night' | 'botanical';

export interface Booklist {
  id: string;
  title: string;
  description: string;
  isPublic: boolean;
  ownerName: string;
  ownerEmail: string;
  isOwner: boolean;
  coverColor: string;
  coverArtStyle: CoverArtStyle;
  bookIds: string[];
  inviteCode: string;
  collaborators: Collaborator[];
  likesCount: number;
  savesCount: number;
  isSavedByUser?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BookshelfWood = 'walnut' | 'oak' | 'birch' | 'mahogany';

export type ViewMode = 'shelf' | 'grid' | 'table';

export type AmbientSoundType = 'none' | 'rain' | 'fireplace' | 'library';

export type AppTheme = 'spotify-dark' | 'nordic-light' | 'warm-minimal';
