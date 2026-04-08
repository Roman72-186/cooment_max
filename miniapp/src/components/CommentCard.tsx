// Карточка одного комментария
import { useState } from 'react';
import type { Comment } from '../api/backend';
import { deleteComment, toggleReaction } from '../api/backend';
import { useAppStore } from '../store/useAppStore';
import { getBridgeUser } from '../bridge/maxBridge';

interface Props {
  comment: Comment;
  depth?: number;
  onDeleted?: (id: number) => void;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

export function CommentCard({ comment, depth = 0, onDeleted }: Props) {
  const setReplyTo = useAppStore((s) => s.setReplyTo);

  // Локальное состояние реакции — обновляется без перезагрузки списка
  const [likes, setLikes] = useState(comment.likes_count ?? 0);
  const [liked, setLiked] = useState(comment.liked_by_me ?? false);
  const [reacting, setReacting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Проверка прав: показывать кнопку удаления
  const bridgeUser = getBridgeUser();
  const currentMaxId = bridgeUser?.id ?? bridgeUser?.user_id;
  const canDelete = Boolean(
    currentMaxId &&
    (currentMaxId === comment.author_max_id ||
     currentMaxId === comment.channel_owner_max_id)
  );

  if (comment.is_hidden) return null;

  async function handleReact() {
    if (reacting) return;
    setReacting(true);
    // Оптимистичное обновление
    setLiked((prev) => !prev);
    setLikes((prev) => (liked ? prev - 1 : prev + 1));
    try {
      const result = await toggleReaction(comment.id);
      // Синхронизируем с сервером
      setLiked(result.liked);
      setLikes(result.likes_count);
    } catch {
      // Откатываем при ошибке
      setLiked((prev) => !prev);
      setLikes((prev) => (liked ? prev + 1 : prev - 1));
    } finally {
      setReacting(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteComment(comment.id);
      onDeleted?.(comment.id);
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className={`comment-card ${depth > 0 ? 'comment-card--reply' : ''}`}>
      <div className="comment-avatar">{getInitials(comment.author_name)}</div>
      <div className="comment-body">
        <div className="comment-header">
          <span className="comment-author">{comment.author_name}</span>
          <span className="comment-time">{formatTime(comment.created_at)}</span>
          {canDelete && (
            <button
              className="comment-delete-btn"
              onClick={handleDelete}
              disabled={deleting}
              title="Удалить"
            >
              ✕
            </button>
          )}
        </div>

        <p className="comment-text">{comment.text}</p>

        <div className="comment-actions">
          {/* Реакция ❤️ */}
          <button
            className={`reaction-btn ${liked ? 'reaction-btn--active' : ''}`}
            onClick={handleReact}
            disabled={reacting}
          >
            ❤️ {likes > 0 && <span className="reaction-count">{likes}</span>}
          </button>

          {/* Ответить — только верхний уровень */}
          {depth === 0 && (
            <button className="comment-reply-btn" onClick={() => setReplyTo(comment)}>
              Ответить
            </button>
          )}
        </div>

        {/* Вложенные ответы */}
        {comment.replies?.map((reply) => (
          <CommentCard
            key={reply.id}
            comment={reply}
            depth={1}
            onDeleted={onDeleted}
          />
        ))}
      </div>
    </div>
  );
}
