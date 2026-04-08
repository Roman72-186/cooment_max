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

export interface Comment {
  id: number;
  post_id: number;
  author_id: number;
  author_name: string;
  author_username?: string;
  author_max_id?: number;         // MAX user ID автора (для проверки прав удаления)
  channel_owner_max_id?: number;  // MAX user ID владельца канала
  parent_id: number | null;
  text: string;
  is_hidden: boolean;
  created_at: string;
  likes_count?: number;           // количество ❤️
  liked_by_me?: boolean;          // текущий пользователь поставил ❤️
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
  commentId: number
): Promise<{ liked: boolean; likes_count: number }> {
  const { data } = await api.post(`/api/reactions/${commentId}`);
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

// ─── ПОЛЬЗОВАТЕЛЬ ────────────────────────────────────────────────

export interface ChannelSummary {
  id: number;
  max_chat_id: string;
  channel_name: string | null;
  is_active: boolean;
  post_count: number;
  total_comments: number;
  comments_enabled: boolean;
  banned_words: string[];
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
  channels: ChannelSummary[];
}

export async function getUserMe(): Promise<UserMe> {
  const { data } = await api.get<UserMe>('/api/user/me');
  return data;
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

export async function updateChannelSettings(
  channelId: number,
  settings: { comments_enabled?: boolean; banned_words?: string[] }
): Promise<{ id: number; comments_enabled: boolean; banned_words: string[] }> {
  const { data } = await api.patch(`/api/channels/${channelId}/settings`, settings);
  return data;
}
