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
}

// ─── КОММЕНТАРИИ ─────────────────────────────────────────────────

export async function getComments(postId: number): Promise<Comment[]> {
  const { data } = await api.get<Comment[]>('/api/comments', {
    params: { post_id: postId },
  });
  return data;
}

export async function postComment(
  postId: number,
  text: string,
  parentId?: number
): Promise<Comment> {
  const { data } = await api.post<Comment>('/api/comments', {
    post_id: postId,
    text,
    parent_id: parentId ?? null,
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

export async function getUserMe(): Promise<UserMe> {
  const { data } = await api.get<UserMe>('/api/user/me');
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

export async function syncChannels(): Promise<{ registered: number; channels: ChannelSummary[] }> {
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
  }
): Promise<{
  id: number;
  comments_enabled: boolean;
  banned_words: string[];
  post_reactions: string[];
  notifications_enabled: boolean;
}> {
  const { data } = await api.patch(`/api/channels/${channelId}/settings`, settings);
  return data;
}

// ─── АГРЕГАТОР КОММЕНТАРИЕВ ────────────────────────────────────────

export interface FeedItem {
  id: number;
  text: string;
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

export async function getReferralStats(): Promise<{
  invited: number;
  converted: number;
  days_earned: number;
  ref_link: string | null;
}> {
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
  owner_name: string | null;
  owner_max_id: number | null;
}

export async function adminGetUsers(): Promise<AdminUser[]> {
  const { data } = await api.get('/api/admin/users');
  return data;
}

export async function adminGetChannels(): Promise<AdminChannel[]> {
  const { data } = await api.get('/api/admin/channels');
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
