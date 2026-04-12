// Общие TypeScript интерфейсы — используются в боте, бэкенде и Mini App

// ─── ПОЛЬЗОВАТЕЛЬ ────────────────────────────────────────────────
export interface User {
  id: number;
  max_user_id: number;
  name: string | null;
  username: string | null;
  plan: 'free' | 'pro';
  plan_expires: string | null; // ISO дата
  is_admin: boolean;           // суперадмин платформы
  ref_code: string | null;
  referred_by: number | null;
  reply_notifications_enabled: boolean; // получать DM когда ответили на комментарий
  created_at: string;
}

// ─── КАНАЛ ───────────────────────────────────────────────────────
export interface Channel {
  id: number;
  owner_id: number;
  max_chat_id: string;
  channel_name: string | null;
  channel_type: 'public' | 'private';
  discussion_chat_id: string | null; // ID скрытого группового чата
  is_active: boolean;
  post_count: number;
  total_comments: number;
  connected_at: string;
  comments_enabled: boolean;         // вкл/выкл комментарии на канале
  banned_words: string[];            // список стоп-слов (PRO)
  post_reactions: string[];          // эмодзи реакций под постами (до 5)
  notifications_enabled: boolean;    // уведомлять владельца о новых комментариях
}

// Краткая сводка канала для списка на Dashboard
export interface ChannelSummary {
  id: number;
  max_chat_id: string;
  channel_name: string | null;
  is_active: boolean;
  post_count: number;
  total_comments: number;
  comments_enabled: boolean;
  notifications_enabled: boolean;  // уведомлять владельца о новых комментариях
  connected_at: string;
}

// Пользователь с каналами — ответ GET /api/user/me
export interface UserWithChannels extends User {
  channels: ChannelSummary[];
}

// ─── АНАЛИТИКА ───────────────────────────────────────────────────

// Краткая сводка поста для топ-5
export interface PostSummary {
  id: number;
  text_preview: string | null;
  comment_count: number;
  published_at: string;
}

// Ответ GET /api/channels/:id/analytics
export interface AnalyticsSummary {
  days: AnalyticsDaily[];        // данные по дням
  top_posts: PostSummary[];      // топ-5 постов по комментариям
  total_views: number;
  total_comments: number;
  total_reactions: number;
  engagement_rate: number;       // (comments + reactions) / views * 100
}

// ─── ПОСТ ────────────────────────────────────────────────────────
export interface Post {
  id: number;
  channel_id: number;
  max_message_id: string;
  discussion_msg_id: string | null; // ID репоста в скрытом чате
  text_preview: string | null;
  view_count: number;
  comment_count: number;
  published_at: string;
  attachments_json?: unknown[];     // оригинальные медиа-вложения (фото/видео)
  comments_enabled: boolean;        // зафиксировано на момент создания поста
  post_reactions: string[];         // зафиксировано на момент создания поста
  last_notified_at: string | null;  // время последней отправки уведомления владельцу
}

// ─── КОММЕНТАРИЙ ─────────────────────────────────────────────────
export interface Comment {
  id: number;
  post_id: number;
  author_id: number;
  parent_id: number | null; // null = корневой комментарий
  text: string;
  is_hidden: boolean;
  created_at: string;
  // Поля из JOIN-запросов (добавляются в API-ответах)
  author_name?: string;
  author_username?: string;
  author_max_id?: number;          // MAX user ID автора — для проверки прав удаления
  channel_owner_max_id?: number;   // MAX user ID владельца канала
  channel_id?: number;             // ID канала (для бана)
  likes_count?: number;            // количество ❤️ на комментарии
  liked_by_me?: boolean;           // текущий пользователь поставил ❤️
  emoji_reactions?: Array<{ emoji: string; count: number; reacted_by_me: boolean }>;
  replies?: Comment[];
}

// ─── ПЛАТЁЖ ──────────────────────────────────────────────────────
export interface Payment {
  id: number;
  user_id: number;
  tbank_payment_id: string | null;
  amount_rub: number;
  plan: string;
  status: 'pending' | 'succeeded' | 'cancelled';
  created_at: string;
}

// ─── ЕЖЕДНЕВНАЯ АНАЛИТИКА ────────────────────────────────────────
export interface AnalyticsDaily {
  id: number;
  channel_id: number;
  date: string; // формат YYYY-MM-DD
  views: number;
  comments: number;
  reactions: number;
}

// ─── СОБЫТИЯ WEBHOOK MAX ─────────────────────────────────────────
export type UpdateType =
  | 'message_created'
  | 'bot_added'
  | 'bot_removed'
  | 'message_callback'
  | 'bot_started'
  | 'chat_member_updated';

export interface MaxUser {
  user_id: number;
  name: string;
  username?: string;
  is_bot?: boolean;
}

export interface MaxMessage {
  body: {
    mid: string;
    text?: string;
    attachments?: unknown[];
  };
  sender: MaxUser;
  recipient: {
    chat_id: string;
    chat_type: 'channel' | 'group' | 'dialog';
  };
  timestamp: number;
  stat?: {
    views: number;
  };
}

export interface WebhookUpdate {
  update_id: number;
  timestamp: number;
  update_type: UpdateType;
  message?: MaxMessage;
  // Поля для bot_added / bot_removed
  chat_id?: string | number;
  chat_type?: 'channel' | 'group' | 'dialog';
  user?: MaxUser;
  callback?: {
    callback_id: string;
    user: MaxUser;
    message: MaxMessage;
    payload: string;
    timestamp: number;
  };
  user_locale?: string;
}

// ─── MAX API — ОТВЕТЫ ────────────────────────────────────────────
export interface MaxBotInfo {
  user_id: number;
  name: string;
  username: string;
  is_bot: true;
}

export interface MaxChatInfo {
  chat_id: string;
  type: 'channel' | 'group' | 'dialog';
  title: string;
  members_count: number;
}

export interface MaxSendMessageResult {
  message: {
    body: { mid: string };
    sender: MaxUser;
    recipient: { chat_id: string };
    timestamp: number;
  };
}
