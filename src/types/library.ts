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
  coverImage?: string;
  bookmarks?: PageBookmark[];
  highlights?: Record<number, PageHighlightStroke[]>;
}

export interface PageBookmark {
  id: string;
  page: number;
  note: string;
  createdAt: string;
}

export interface PageHighlightStroke {
  color: string;
  points: Array<{ x: number; y: number }>;
}

export interface SavedVocabularyItem {
  id: string;
  word: string;
  pronunciation?: string;
  partOfSpeech: string;
  persianMeaning: string;
  englishMeaning: string;
  contextExplanation: string;
  bookId?: string;
  bookTitle: string;
  page: number;
  createdAt: string;
}

export interface DailyReadingStats {
  dailyGoalPages: number;
  pagesReadToday: number;
  streakDays: number;
  lastReadDate: string;
}

export interface TelegramPdfItem {
  messageId: number;
  fileName: string;
  fileSize: number;
  date: string;
  caption: string;
  channelTitle: string;
  channelUsername: string;
  coverPhotoMsgId?: number;
  hasThumb?: boolean;
  cleanTitle?: string;
  author?: string;
}

export interface TelegramConfigStatus {
  configured: boolean;
  hasApiId: boolean;
  hasApiHash: boolean;
  hasSession: boolean;
  defaultChannel: string;
  serverChannels?: string[];
  sessionInvalidated?: boolean;
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

export type SortOption = 'recently-added' | 'title-asc' | 'progress-desc';

export type AmbientSoundType = 'none' | 'rain' | 'fireplace' | 'library';

export type AppTheme = 'spotify-dark' | 'nordic-light' | 'warm-minimal';

export interface UiSectionPreferences {
  showReadingTab: boolean;
  showFinishedTab: boolean;
  showNotesHub: boolean;
  showVocabularyHub: boolean;
  showPlaylistsSection: boolean;
  showBookshelfTab: boolean;
  showExploreTab: boolean;
  showBottomPlayerBar: boolean;
}

export const DEFAULT_UI_PREFERENCES: UiSectionPreferences = {
  showReadingTab: false,
  showFinishedTab: true,
  showNotesHub: true,
  showVocabularyHub: true,
  showPlaylistsSection: true,
  showBookshelfTab: true,
  showExploreTab: true,
  showBottomPlayerBar: true,
};

