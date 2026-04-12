// Поле ввода нового комментария / ответа
// Защита от флуда: не более 5 сообщений за 15 секунд (sliding window)
import { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { postComment } from '../api/backend';
import type { Comment } from '../api/backend';

interface Props {
  postId: number;
  onSent: (comment: Comment) => void;
}

const MAX_INPUT_HEIGHT    = 120;  // px — максимальная высота до скролла
const RATE_LIMIT_COUNT    = 5;    // максимум N сообщений…
const RATE_LIMIT_WINDOW   = 15_000; // …за M мс (15 секунд)

export function CommentInput({ postId, onSent }: Props) {
  const [text, setText]           = useState('');
  const [sending, setSending]     = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cooldown, setCooldown]   = useState(0); // секунды до снятия блокировки

  const textareaRef      = useRef<HTMLTextAreaElement>(null);
  // Хранит timestamp каждого отправленного сообщения (только последние N)
  const sendTimestamps   = useRef<number[]>([]);
  const errorTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replyTo    = useAppStore((s) => s.replyTo);
  const setReplyTo = useAppStore((s) => s.setReplyTo);

  // Фокус при нажатии «Ответить»
  useEffect(() => {
    if (replyTo) {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [replyTo]);

  // Тик каждые 500 мс — пересчитываем оставшееся время блокировки
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      // Убираем устаревшие метки
      sendTimestamps.current = sendTimestamps.current.filter(
        (t) => now - t < RATE_LIMIT_WINDOW
      );
      if (sendTimestamps.current.length >= RATE_LIMIT_COUNT) {
        // Ждём пока самая старая метка выйдет из окна
        const oldest   = sendTimestamps.current[0];
        const remainMs = oldest + RATE_LIMIT_WINDOW - now;
        setCooldown(Math.max(1, Math.ceil(remainMs / 1000)));
      } else {
        setCooldown(0);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Очистка errorTimerRef при размонтировании
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // Авторасширение textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT) + 'px';
  }, []);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending || cooldown > 0) return;

    setSending(true);
    setSendError(null);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);

    try {
      const comment = await postComment(postId, trimmed, replyTo?.id);

      // Фиксируем метку успешной отправки
      sendTimestamps.current.push(Date.now());

      setText('');
      setReplyTo(null);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      onSent(comment);
    } catch (err: any) {
      // 429 — сервер тоже блокирует (fallback если клиент пропустил)
      const retryAfter = Number(err?.response?.data?.retry_after) || 15;
      if (err?.response?.status === 429) {
        // Заполняем окно синтетическими метками чтобы клиентский таймер сработал
        const now = Date.now();
        sendTimestamps.current = Array.from(
          { length: RATE_LIMIT_COUNT },
          (_, i) => now - i * 100
        );
        setCooldown(retryAfter);
        setSendError(`Слишком часто — подождите ${retryAfter} сек.`);
      } else {
        setSendError('Не удалось отправить');
      }
      errorTimerRef.current = setTimeout(() => setSendError(null), 4000);
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

  const isBlocked   = cooldown > 0;
  const btnDisabled = sending || !text.trim() || isBlocked;

  return (
    <div className="comment-input-wrap">
      {sendError && (
        <div className="comment-input-error">{sendError}</div>
      )}
      {isBlocked && !sendError && (
        <div className="comment-input-cooldown">
          Не флудите — подождите {cooldown} сек.
        </div>
      )}
      {replyTo && (
        <div className="reply-banner">
          <div className="reply-banner__body">
            <span className="reply-banner__author">↩ {replyTo.author_name}</span>
            <span className="reply-banner__text">
              {replyTo.text.slice(0, 80)}{replyTo.text.length > 80 ? '…' : ''}
            </span>
          </div>
          <button className="reply-banner__close" onClick={() => setReplyTo(null)}>✕</button>
        </div>
      )}
      <div className="comment-input-row">
        <textarea
          ref={textareaRef}
          className={`comment-input ${isBlocked ? 'comment-input--blocked' : ''}`}
          placeholder={
            isBlocked
              ? `Подождите ${cooldown} сек…`
              : replyTo
                ? `Ответить ${replyTo.author_name}…`
                : 'Написать комментарий…'
          }
          value={text}
          onChange={(e) => { setText(e.target.value); autoResize(); }}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={2000}
          autoFocus
          disabled={isBlocked}
        />
        <button
          className={`send-btn ${btnDisabled ? 'send-btn--disabled' : ''} ${isBlocked ? 'send-btn--cooldown' : ''}`}
          onClick={handleSend}
          disabled={btnDisabled}
          title={isBlocked ? `Подождите ${cooldown} сек.` : undefined}
        >
          {sending ? '…' : isBlocked ? `${cooldown}` : '➤'}
        </button>
      </div>
    </div>
  );
}
