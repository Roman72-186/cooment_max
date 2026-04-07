// Глобальное состояние приложения (Zustand)
import { create } from 'zustand';
import type { Comment } from '../api/backend';

interface AppState {
  postId: number | null;
  comments: Comment[];
  loading: boolean;
  error: string | null;
  replyTo: Comment | null;  // комментарий, на который отвечаем

  setPostId: (id: number) => void;
  setComments: (comments: Comment[]) => void;
  addComment: (comment: Comment) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setReplyTo: (comment: Comment | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  postId: null,
  comments: [],
  loading: false,
  error: null,
  replyTo: null,

  setPostId: (id) => set({ postId: id }),
  setComments: (comments) => set({ comments }),
  addComment: (comment) =>
    set((state) => ({ comments: [comment, ...state.comments] })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setReplyTo: (replyTo) => set({ replyTo }),
}));
