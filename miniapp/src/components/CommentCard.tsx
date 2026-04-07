// Карточка одного комментария
import type { Comment } from '../api/backend';
import { useAppStore } from '../store/useAppStore';

interface Props {
  comment: Comment;
  depth?: number;  // 0 = верхний уровень, 1 = ответ
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function CommentCard({ comment, depth = 0 }: Props) {
  const setReplyTo = useAppStore((s) => s.setReplyTo);

  if (comment.is_hidden) return null;

  return (
    <div className={`comment-card ${depth > 0 ? 'comment-card--reply' : ''}`}>
      <div className="comment-avatar">
        {getInitials(comment.author_name)}
      </div>
      <div className="comment-body">
        <div className="comment-header">
          <span className="comment-author">{comment.author_name}</span>
          <span className="comment-time">{formatTime(comment.created_at)}</span>
        </div>
        <p className="comment-text">{comment.text}</p>
        {depth === 0 && (
          <button
            className="comment-reply-btn"
            onClick={() => setReplyTo(comment)}
          >
            Ответить
          </button>
        )}
        {/* Вложенные ответы */}
        {comment.replies?.map((reply) => (
          <CommentCard key={reply.id} comment={reply} depth={1} />
        ))}
      </div>
    </div>
  );
}
