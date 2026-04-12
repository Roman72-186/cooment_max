// Глобальное состояние приложения (Zustand)
import { create } from 'zustand';
import type { Comment, UserMe, ChannelSummary } from '../api/backend';

// Страницы приложения
export type Page =
  | { id: 'loading' }
  | { id: 'error' }
  | { id: 'comments'; postId: number; highlightCommentId?: number }
  | { id: 'onboarding' }
  | { id: 'dashboard' }
  | { id: 'analytics'; channelId: number }
  | { id: 'settings'; channelId: number }
  | { id: 'pricing' }
  | { id: 'admin' }
  | { id: 'inbox'; channelId?: number; channelName?: string };

interface AppState {
  // Навигация
  page: Page;
  setPage: (page: Page) => void;

  // Данные пользователя (загружаются при старте)
  user: UserMe | null;
  setUser: (user: UserMe | null) => void;
  updateChannel: (updated: Partial<ChannelSummary> & { id: number }) => void;

  // Комментарии (CommentsPage)
  comments: Comment[];
  loading: boolean;
  error: string | null;
  replyTo: Comment | null;

  setComments: (comments: Comment[]) => void;
  addComment: (comment: Comment) => void;
  removeComment: (id: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setReplyTo: (comment: Comment | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Навигация
  page: { id: 'loading' },
  setPage: (page) => set({ page, comments: [], loading: false, error: null, replyTo: null }),

  // Пользователь
  user: null,
  setUser: (user) => set({ user }),
  updateChannel: (updated) =>
    set((state) => ({
      user: state.user
        ? {
            ...state.user,
            channels: state.user.channels.map((ch) =>
              ch.id === updated.id ? { ...ch, ...updated } : ch
            ),
          }
        : null,
    })),

  // Комментарии
  comments: [],
  loading: false,
  error: null,
  replyTo: null,

  setComments: (comments) => set({ comments }),
  addComment: (comment) =>
    set((state) => ({
      comments: state.comments.some((c) => c.id === comment.id)
        ? state.comments
        : [...state.comments, comment],
    })),
  removeComment: (id) =>
    set((state) => ({ comments: state.comments.filter((c) => c.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setReplyTo: (replyTo) => set({ replyTo }),
}));
