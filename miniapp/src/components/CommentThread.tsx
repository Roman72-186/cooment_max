// Плоский список комментариев — мессенджер-стиль (как Tapbox)
import React from 'react';
import type { Comment } from '../api/backend';
import { CommentCard } from './CommentCard';

interface Props {
  comments: Comment[];
  onDeleted?: (id: number) => void;
  onRestoreComment?: (comment: Comment) => void;
}

function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return 'Сегодня';
  if (sameDay(date, yesterday)) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function toDateKey(iso: string): string {
  return iso.slice(0, 10);
}

export function CommentThread({ comments, onDeleted, onRestoreComment }: Props) {
  if (comments.length === 0) {
    return (
      <div className="empty-state">
        <span>Пока нет комментариев</span>
        <span>Будьте первым!</span>
      </div>
    );
  }

  // Карта id → комментарий для быстрого поиска родителя (цитата)
  const commentMap = new Map<number, Comment>(comments.map((c) => [c.id, c]));

  const elements: React.ReactNode[] = [];
  let lastDateKey = '';

  // Плоский рендер — комментарии идут в хронологическом порядке
  comments.forEach((comment) => {
    const dateKey = toDateKey(comment.created_at);
    if (dateKey !== lastDateKey) {
      lastDateKey = dateKey;
      elements.push(
        <div key={`sep-${dateKey}`} className="date-separator">
          <span>{formatDateLabel(comment.created_at)}</span>
        </div>
      );
    }

    const parentComment = comment.parent_id != null
      ? commentMap.get(comment.parent_id)
      : undefined;

    elements.push(
      <CommentCard
        key={comment.id}
        comment={comment}
        parentComment={parentComment}
        onDeleted={onDeleted}
        onRestoreComment={onRestoreComment}
      />
    );
  });

  return (
    <div className="comment-thread">
      {elements}
    </div>
  );
}
