// Все HTTP-запросы к нашему REST API
import axios from 'axios';
import { getInitData } from '../bridge/maxBridge';

// baseURL пустой — Mini App и API на одном домене (sushi-house-39.online)
const api = axios.create({
  baseURL: '',
  timeout: 10000,
});

// Добавляем initData в каждый запрос для аутентификации
api.interceptors.request.use((config) => {
  const initData = getInitData();
  if (initData) {
    config.headers['X-Init-Data'] = initData;
  }
  return config;
});

// ─── ТИПЫ ────────────────────────────────────────────────────────

export interface EmojiReaction {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
}

export type CommentAttachment =
  | {
      type: 'image';
      url: string;
      width?: number;
      height?: number;
      mime_type?: string;
      filename?: string;
      size?: number;
    }
  | {
      type: 'sticker';
      sticker_id: string;
      emoji: string;
      label?: string;
    };

export interface Comment {
  id: number;
  post_id: number;
  author_id: number;
  author_name: string;
  author_username?: string;
  author_max_id?: number;         // MAX user ID автора (для проверки прав удаления)
  channel_owner_max_id?: number;  // MAX user ID владельца канала
  channel_id?: number;            // ID канала (для бана)
  parent_id: number | null;
  text: string;
  attachments_json: CommentAttachment[];
  is_hidden: boolean;
  created_at: string;
  likes_count?: number;           // устаревшее — для совместимости
  liked_by_me?: boolean;          // устаревшее — для совместимости
  emoji_reactions?: EmojiReaction[];  // актуальные emoji-реакции
  replies?: Comment[];
}

export interface Post {
  id: number;
  channel_id: number;
  text_preview: string;
  comment_count: number;
  published_at: string;
  media_comments_enabled?: boolean;
}

// ─── КОММЕНТАРИИ ─────────────────────────────────────────────────

interface GetCommentsOptions {
  afterId?: number;
}

export async function getComments(postId: number, options: GetCommentsOptions = {}): Promise<Comment[]> {
  const { data } = await api.get<Comment[]>('/api/comments', {
    params: {
      post_id: postId,
      ...(options.afterId ? { after_id: options.afterId } : {}),
    },
  });
  return data;
}

export async function postComment(
  postId: number,
  text: string,
  parentId?: number,
  attachments: CommentAttachment[] = []
): Promise<Comment> {
  const { data } = await api.post<Comment>('/api/comments', {
    post_id: postId,
    text,
    parent_id: parentId ?? null,
    attachments,
  });
  return data;
}

export async function deleteComment(commentId: number): Promise<void> {
  await api.delete(`/api/comments/${commentId}`);
}

export async function toggleReaction(
  commentId: number,
  emoji: string = '❤️'
): Promise<{ emoji: string; liked: boolean; reactions: EmojiReaction[] }> {
  const { data } = await api.post(`/api/reactions/${commentId}`, { emoji });
  return data;
}

// ─── ПОСТ ────────────────────────────────────────────────────────

export async function getPost(postId: number): Promise<Post | null> {
  try {
    const { data } = await api.get<Post>(`/api/posts/${postId}`);
    return data;
  } catch {
    return null;
  }
}

// Получить результаты опроса поста.
// Возвращает null если у поста нет опроса.
export async function getPollResults(postId: number): Promise<{
  question: string;
  options: Array<{ text: string; count: number; percent: number }>;
  total_votes: number;
  voted_option: number | null;
} | null> {
  try {
    const { data } = await api.get<{ poll: {
      question: string;
      options: Array<{ text: string; count: number; percent: number }>;
      total_votes: number;
      voted_option: number | null;
    } | null }>(`/api/polls/${postId}/results`);
    return data.poll;
  } catch {
    return null;
  }
}

// Зафиксировать просмотр поста (открытие раздела комментариев)
export async function recordView(postId: number): Promise<void> {
  try {
    await api.post(`/api/posts/${postId}/view`);
  } catch {
    // Не критично — просто не считаем этот просмотр
  }
}

// Попросить бота немедленно обновить счётчик на кнопке поста.
// Вызывается перед закрытием Mini App, чтобы пользователь увидел актуальное число.
export async function refreshPostCounter(postId: number): Promise<void> {
  try {
    await api.post(`/api/posts/${postId}/refresh`);
  } catch {
    // Не критично — счётчик обновится через фоновый job (≤60 с)
  }
}

// ─── СОБЫТИЯ (аналитика кликов и переходов) ───────────────────────

interface QueuedEvent {
  type: string;
  name: string;
  metadata?: Record<string, unknown>;
}

let eventQueue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const EVENT_BATCH_SIZE = 20;
const EVENT_FLUSH_DELAY_MS = 1500;

function flushEvents(): void {
  flushTimer = null;
  if (eventQueue.length === 0) return;
  const batch = eventQueue.splice(0, EVENT_BATCH_SIZE);
  api.post('/api/events', { events: batch }).catch(() => {
    // Метрика не критична — не блокируем и не уведомляем пользователя об ошибке
  });
}

// Зафиксировать просмотр страницы или клик кнопки. Не блокирует UI —
// события копятся и отправляются батчем раз в 1.5с.
export function trackEvent(
  name: string,
  metadata?: Record<string, unknown>,
  type: 'page_view' | 'click' = 'click'
): void {
  eventQueue.push({ type, name, metadata });
  if (!flushTimer) {
    flushTimer = setTimeout(flushEvents, EVENT_FLUSH_DELAY_MS);
  }
}

// ─── ПОЛЬЗОВАТЕЛЬ ────────────────────────────────────────────────

export interface ChannelSummary {
  id: number;
  max_chat_id: string;
  channel_name: string | null;
  is_active: boolean;
  post_count: number;
  total_comments: number;
  comments_enabled: boolean;
  notifications_enabled: boolean;
  banned_words: string[];
  post_reactions: string[];
  poll_enabled?: boolean;
  poll_question?: string | null;
  poll_options?: Array<{ text: string }> | null;
  connected_at: string;
}

export interface UserMe {
  id: number;
  max_user_id: number;
  name: string | null;
  username: string | null;
  plan: 'free' | 'pro';
  plan_expires: string | null;
  ref_code: string | null;
  is_admin: boolean;
  reply_notifications_enabled: boolean;
  channels: ChannelSummary[];
}

// startParam передаём только при первом заходе — backend сохраняет атрибуцию
// (источник привлечения) один раз и не перезаписывает её при повторных вызовах.
export async function getUserMe(startParam?: string | null): Promise<UserMe> {
  const { data } = await api.get<UserMe>('/api/user/me', {
    headers: startParam ? { 'X-Start-Param': startParam } : undefined,
  });
  return data;
}

export async function updateReplyNotifications(enabled: boolean): Promise<void> {
  await api.patch('/api/user/notifications', { enabled });
}

// ─── КАНАЛЫ ──────────────────────────────────────────────────────

export interface AnalyticsDayData {
  date: string;
  views: number;
  comments: number;
  reactions: number;
}

export interface PostSummary {
  id: number;
  text_preview: string | null;
  comment_count: number;
  published_at: string;
}

export interface AnalyticsSummary {
  days: AnalyticsDayData[];
  top_posts: PostSummary[];
  total_views: number;
  total_comments: number;
  total_reactions: number;
  engagement_rate: number;
}

export async function getChannelAnalytics(
  channelId: number,
  days: 7 | 30 | 90 = 7
): Promise<AnalyticsSummary> {
  const { data } = await api.get<AnalyticsSummary>(
    `/api/channels/${channelId}/analytics`,
    { params: { days } }
  );
  return data;
}

export async function syncChannels(): Promise<{
  registered: number;
  channels: ChannelSummary[];
  requires_pro?: boolean;
  blocked_by_limit?: number;
  message?: string;
}> {
  const { data } = await api.post('/api/channels/sync');
  return data;
}

export async function updateChannelSettings(
  channelId: number,
  settings: {
    comments_enabled?: boolean;
    banned_words?: string[];
    post_reactions?: string[];
    notifications_enabled?: boolean;
    poll_enabled?: boolean;
    poll_question?: string | null;
    poll_options?: Array<{ text: string }> | null;
  }
): Promise<{
  id: number;
  comments_enabled: boolean;
  banned_words: string[];
  post_reactions: string[];
  notifications_enabled: boolean;
  poll_enabled: boolean;
  poll_question: string | null;
  poll_options: Array<{ text: string }> | null;
}> {
  const { data } = await api.patch(`/api/channels/${channelId}/settings`, settings);
  return data;
}

export async function deleteChannel(channelId: number): Promise<void> {
  await api.delete(`/api/channels/${channelId}`);
}

// ─── АГРЕГАТОР КОММЕНТАРИЕВ ────────────────────────────────────────

export interface FeedItem {
  id: number;
  text: string;
  attachments_json?: CommentAttachment[];
  created_at: string;
  author_name: string;
  post_id: number;
  post_preview: string | null;
  channel_id: number;
  channel_name: string | null;
  max_chat_id: string;
}

export async function getFeed(channelId?: number): Promise<FeedItem[]> {
  const { data } = await api.get<FeedItem[]>('/api/comments/feed', {
    params: channelId ? { channel_id: channelId } : undefined,
  });
  return data;
}

export async function createPayment(promoCode?: string): Promise<{ payment_url: string; payment_id: number }> {
  const { data } = await api.post('/api/payments/create', promoCode ? { promo_code: promoCode } : {});
  return data;
}

export interface PromoValidation {
  valid: boolean;
  discount_percent?: number;
  final_price?: number;
  error?: string;
}

export async function validatePromoCode(code: string): Promise<PromoValidation> {
  const { data } = await api.post('/api/payments/validate-promo', { code });
  return data;
}

export interface ReferralTeamLevel {
  level: number;
  invited: number;
  converted: number;
  earned_rub: number;
}

export interface ReferralStats {
  referral_available: boolean;
  requires_paid_pro: boolean;
  has_paid_pro: boolean;
  invited: number;
  converted: number;
  days_earned: number;
  commission_earned_rub: number;
  manual_adjustments_rub: number;
  balance_rub: number;
  current_rate_percent: number;
  next_tier_at: number | null;
  referrals_to_next_tier: number;
  ref_link: string | null;
  team_levels: ReferralTeamLevel[];
  team_total: {
    invited: number;
    converted: number;
    earned_rub: number;
  };
}

export async function getReferralStats(): Promise<ReferralStats> {
  const { data } = await api.get('/api/referrals/stats');
  return data;
}

// ─── ADMIN ────────────────────────────────────────────────────────

export interface AdminUser {
  id: number;
  max_user_id: number;
  name: string | null;
  username: string | null;
  plan: 'free' | 'pro';
  plan_expires: string | null;
  is_admin: boolean;
  created_at: string;
  channel_count: number;
  acquisition_source: string | null;
  acquisition_detail: string | null;
  bot_dialog_started_at: string | null;
}

export interface AdminChannel {
  id: number;
  max_chat_id: string;
  channel_name: string | null;
  is_active: boolean;
  post_count: number;
  total_comments: number;
  comments_enabled: boolean;
  connected_at: string;
  channel_url: string | null;
  owner_name: string | null;
  owner_max_id: number | string | null;
  owner_created_at: string | null;
}

export async function adminGetUsers(): Promise<AdminUser[]> {
  const { data } = await api.get('/api/admin/users', { params: { limit: 5000 } });
  return data;
}

export async function adminGetChannels(): Promise<AdminChannel[]> {
  const { data } = await api.get('/api/admin/channels', { params: { limit: 5000 } });
  return data;
}

export async function adminUpdateUser(
  userId: number,
  payload: { plan: 'free' | 'pro'; days?: number }
): Promise<void> {
  await api.patch(`/api/admin/users/${userId}`, payload);
}

export async function adminDeleteUser(userId: number): Promise<void> {
  await api.delete(`/api/admin/users/${userId}`);
}

export async function adminToggleChannel(channelId: number, isActive: boolean): Promise<void> {
  await api.patch(`/api/admin/channels/${channelId}`, { is_active: isActive });
}

export async function adminDeleteChannel(channelId: number): Promise<void> {
  await api.delete(`/api/admin/channels/${channelId}`);
}

// ─── БАН ПОЛЬЗОВАТЕЛЕЙ ───────────────────────────────────────────

export async function banUser(channelId: number, bannedMaxId: number): Promise<void> {
  await api.post(`/api/channels/${channelId}/ban`, { banned_max_id: bannedMaxId });
}

// ─── НАСТРОЙКИ ПЛАТФОРМЫ ──────────────────────────────────────────

export async function getPaymentConfig(): Promise<{ price: number; days: number }> {
  const { data } = await api.get('/api/payments/config');
  return data;
}

export async function adminGetSettings(): Promise<{ pro_price_rub: number; pro_days: number }> {
  const { data } = await api.get('/api/admin/settings');
  return data;
}

export async function adminUpdateSettings(
  settings: { pro_price_rub?: number; pro_days?: number }
): Promise<void> {
  await api.patch('/api/admin/settings', settings);
}

// ─── ADMIN: ИСТОРИЯ ПЛАТЕЖЕЙ ──────────────────────────────────────

export interface AdminPayment {
  id: number;
  user_name: string | null;
  max_user_id: number | null;
  amount_rub: number;
  status: 'pending' | 'succeeded' | 'cancelled';
  promo_code: string | null;
  discount_percent: number | null;
  created_at: string;
}

export async function adminGetPayments(): Promise<AdminPayment[]> {
  const { data } = await api.get('/api/admin/payments');
  return data;
}

// ─── ADMIN: РЕФЕРАЛЫ ─────────────────────────────────────────────

export interface AdminReferralReferrer {
  id: number;
  max_user_id: number;
  name: string | null;
  username: string | null;
  ref_code: string | null;
  invited: number;
  converted: number;
  days_earned: number;
  commission_earned_rub: number;
  manual_adjustments_rub: number;
  balance_rub: number;
  current_rate_percent: number;
}

export interface AdminReferralAdjustment {
  id: number;
  referrer_id: number;
  referrer_name: string | null;
  referrer_max_user_id: number;
  admin_name: string | null;
  admin_max_user_id: number | null;
  amount_rub: number;
  reason: string;
  created_at: string;
}

export interface AdminReferralStats {
  summary: {
    invited: number;
    converted: number;
    days_earned: number;
    commission_earned_rub: number;
    manual_adjustments_rub: number;
    balance_rub: number;
  };
  referrers: AdminReferralReferrer[];
  adjustments: AdminReferralAdjustment[];
}

export async function adminGetReferralStats(): Promise<AdminReferralStats> {
  const { data } = await api.get('/api/admin/referrals');
  return data;
}

export async function adminAdjustReferralBalance(
  referrerId: number,
  payload: { amount_rub: number; reason: string }
): Promise<void> {
  await api.post(`/api/admin/referrals/${referrerId}/adjust`, payload);
}

// ─── ADMIN: ПРОМО-КОДЫ ────────────────────────────────────────────

export interface PromoCode {
  id: number;
  code: string;
  discount_percent: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  created_at: string;
}

export async function adminGetPromoCodes(): Promise<PromoCode[]> {
  const { data } = await api.get('/api/admin/promo-codes');
  return data;
}

export async function adminCreatePromoCode(payload: {
  code: string;
  discount_percent: number;
  max_uses?: number | null;
  expires_at?: string | null;
}): Promise<PromoCode> {
  const { data } = await api.post('/api/admin/promo-codes', payload);
  return data;
}

export async function adminDeletePromoCode(code: string): Promise<void> {
  await api.delete(`/api/admin/promo-codes/${code}`);
}

// ─── ADMIN: АТРИБУЦИЯ И СОБЫТИЯ ───────────────────────────────────

export interface AdminAcquisitionStats {
  by_source: Array<{ source: string; count: number }>;
  top_details: Array<{ source: string; detail: string; count: number }>;
}

export async function adminGetAcquisitionStats(): Promise<AdminAcquisitionStats> {
  const { data } = await api.get('/api/admin/acquisition');
  return data;
}

export interface AdminEventItem {
  id: number;
  event_type: string;
  event_name: string;
  metadata: Record<string, unknown>;
  created_at: string;
  user_max_id: string;
  user_name: string | null;
  user_username: string | null;
}

export interface AdminEventsStats {
  days: number;
  top_events: Array<{ event_name: string; event_type: string; count: number }>;
  recent: AdminEventItem[];
}

export async function adminGetEvents(days = 30): Promise<AdminEventsStats> {
  const { data } = await api.get('/api/admin/events', { params: { days } });
  return data;
}
