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
  parent_id: number | null;
  text: string;
  is_hidden: boolean;
  created_at: string;
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

// ─── ПОСТ ────────────────────────────────────────────────────────

export async function getPost(postId: number): Promise<Post | null> {
  try {
    const { data } = await api.get<Post>(`/api/posts/${postId}`);
    return data;
  } catch {
    return null;
  }
}
