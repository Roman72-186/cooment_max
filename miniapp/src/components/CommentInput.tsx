// Поле ввода нового комментария / ответа
import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { postComment } from '../api/backend';

interface Props {
  postId: number;
  onSent: () => void;  // колбэк для обновления списка
}

export function CommentInput({ postId, onSent }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const replyTo = useAppStore((s) => s.replyTo);
  const setReplyTo = useAppStore((s) => s.setReplyTo);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      await postComment(postId, trimmed, replyTo?.id);
      setText('');
      setReplyTo(null);
      onSent();
    } catch {
      // Ошибка обрабатывается на уровне страницы
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="comment-input-wrap">
      {replyTo && (
        <div className="reply-banner">
          <span>Ответ: {replyTo.author_name}</span>
          <button onClick={() => setReplyTo(null)}>✕</button>
        </div>
      )}
      <div className="comment-input-row">
        <textarea
          className="comment-input"
          placeholder={replyTo ? `Ответить ${replyTo.author_name}…` : 'Написать комментарий…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={2000}
          autoFocus
        />
        <button
          className={`send-btn ${sending || !text.trim() ? 'send-btn--disabled' : ''}`}
          onClick={handleSend}
          disabled={sending || !text.trim()}
        >
          {sending ? '…' : '➤'}
        </button>
      </div>
    </div>
  );
}
