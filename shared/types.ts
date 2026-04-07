// Общие TypeScript интерфейсы — используются в боте, бэкенде и Mini App

// ─── ПОЛЬЗОВАТЕЛЬ ────────────────────────────────────────────────
export interface User {
  id: number;
  max_user_id: number;
  name: string | null;
  username: string | null;
  plan: 'free' | 'pro';
  plan_expires: string | null; // ISO дата
  ref_code: string | null;
  referred_by: number | null;
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
  // Вложенные данные (приходят с бэкенда при запросе треда)
  author?: Pick<User, 'name' | 'username'>;
  replies?: Comment[];
}

// ─── ПЛАТЁЖ ──────────────────────────────────────────────────────
export interface Payment {
  id: number;
  user_id: number;
  yookassa_id: string | null;
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
