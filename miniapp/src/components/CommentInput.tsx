// Поле ввода нового комментария / ответа
// Защита от флуда: не более 5 сообщений за 15 секунд (sliding window)
import { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { postComment } from '../api/backend';
import type { Comment, CommentAttachment } from '../api/backend';

interface Props {
  postId: number;
  onSent: (comment: Comment) => void;
  mediaEnabled?: boolean;
}

const MAX_INPUT_HEIGHT    = 120;  // px — максимальная высота до скролла
const RATE_LIMIT_COUNT    = 5;    // максимум N сообщений…
const RATE_LIMIT_WINDOW   = 15_000; // …за M мс (15 секунд)
const MAX_ATTACHMENTS     = 4;
const IMAGE_MAX_SIDE      = 1280;
const IMAGE_QUALITY       = 0.78;
const IMAGE_MAX_DATA_URL  = 1_400_000;

const STICKERS: Array<{ id: string; emoji: string; label: string }> = [
  { id: 'ok', emoji: '👍', label: 'Ок' },
  { id: 'fire', emoji: '🔥', label: 'Огонь' },
  { id: 'laugh', emoji: '😂', label: 'Смешно' },
  { id: 'heart', emoji: '💜', label: 'Сердце' },
  { id: 'wow', emoji: '😮', label: 'Вау' },
  { id: 'party', emoji: '🎉', label: 'Праздник' },
  { id: 'thanks', emoji: '🙏', label: 'Спасибо' },
  { id: 'sad', emoji: '😢', label: 'Грустно' },
];

function getReplyPreview(comment: Comment): string {
  if (comment.text) {
    return `${comment.text.slice(0, 80)}${comment.text.length > 80 ? '…' : ''}`;
  }
  const firstAttachment = comment.attachments_json?.[0];
  if (firstAttachment?.type === 'image') return 'Фото';
  if (firstAttachment?.type === 'sticker') return `Стикер ${firstAttachment.emoji}`;
  return 'Комментарий';
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось прочитать фото'));
    image.src = src;
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file: File): Promise<CommentAttachment> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Можно прикреплять только изображения');
  }

  const sourceUrl = await fileToDataUrl(file);
  const image = await loadImage(sourceUrl);
  const ratio = Math.min(1, IMAGE_MAX_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Не удалось обработать фото');
  ctx.drawImage(image, 0, 0, width, height);

  const url = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
  if (url.length > IMAGE_MAX_DATA_URL) {
    throw new Error('Фото слишком большое');
  }

  return {
    type: 'image',
    url,
    width,
    height,
    mime_type: 'image/jpeg',
    filename: file.name,
    size: file.size,
  };
}

export function CommentInput({ postId, onSent, mediaEnabled = false }: Props) {
  const [text, setText]           = useState('');
  const [sending, setSending]     = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cooldown, setCooldown]   = useState(0); // секунды до снятия блокировки
  const [attachments, setAttachments] = useState<CommentAttachment[]>([]);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [processingPhoto, setProcessingPhoto] = useState(false);

  const textareaRef      = useRef<HTMLTextAreaElement>(null);
  const fileInputRef     = useRef<HTMLInputElement>(null);
  // Хранит timestamp каждого отправленного сообщения (только последние N)
  const sendTimestamps   = useRef<number[]>([]);
  const errorTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replyTo    = useAppStore((s) => s.replyTo);
  const setReplyTo = useAppStore((s) => s.setReplyTo);
  const addToast   = useAppStore((s) => s.addToast);

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
    if ((!trimmed && attachments.length === 0) || sending || cooldown > 0 || processingPhoto) return;

    setSending(true);
    setSendError(null);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);

    try {
      const comment = await postComment(postId, trimmed, replyTo?.id, attachments);

      // Фиксируем метку успешной отправки
      sendTimestamps.current.push(Date.now());

      setText('');
      setAttachments([]);
      setStickerOpen(false);
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
      } else if (typeof err?.response?.data?.error === 'string') {
        setSendError(err.response.data.error);
      } else {
        setSendError('Не удалось отправить');
      }
      errorTimerRef.current = setTimeout(() => setSendError(null), 4000);
    } finally {
      setSending(false);
    }
  }

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    if (!mediaEnabled) {
      addToast({ type: 'warning', message: 'Фото и стикеры доступны в PRO-каналах' });
      return;
    }

    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      addToast({ type: 'warning', message: `Максимум ${MAX_ATTACHMENTS} вложения` });
      return;
    }

    setProcessingPhoto(true);
    try {
      const next: CommentAttachment[] = [];
      for (const file of files.slice(0, remaining)) {
        next.push(await compressImage(file));
      }
      setAttachments((prev) => [...prev, ...next]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось добавить фото';
      setSendError(message);
      errorTimerRef.current = setTimeout(() => setSendError(null), 4000);
    } finally {
      setProcessingPhoto(false);
    }
  }

  function addSticker(sticker: { id: string; emoji: string; label: string }) {
    if (!mediaEnabled) {
      addToast({ type: 'warning', message: 'Стикеры доступны в PRO-каналах' });
      return;
    }
    if (attachments.length >= MAX_ATTACHMENTS) {
      addToast({ type: 'warning', message: `Максимум ${MAX_ATTACHMENTS} вложения` });
      return;
    }
    setAttachments((prev) => [
      ...prev,
      { type: 'sticker', sticker_id: sticker.id, emoji: sticker.emoji, label: sticker.label },
    ]);
    setStickerOpen(false);
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isBlocked   = cooldown > 0;
  const btnDisabled = sending || processingPhoto || (!text.trim() && attachments.length === 0) || isBlocked;

  return (
    <div className="comment-input-wrap">
      {sendError && (
        <div className="comment-input-error" role="alert" aria-live="assertive">{sendError}</div>
      )}
      {isBlocked && !sendError && (
        <div className="comment-input-cooldown" role="status" aria-live="polite">
          Не флудите — подождите {cooldown} сек.
        </div>
      )}
      {replyTo && (
        <div className="reply-banner">
          <div className="reply-banner__body">
            <span className="reply-banner__author">↩ {replyTo.author_name}</span>
            <span className="reply-banner__text">
              {getReplyPreview(replyTo)}
            </span>
          </div>
          <button
            className="reply-banner__close"
            onClick={() => setReplyTo(null)}
            aria-label="Отменить ответ"
          >✕</button>
        </div>
      )}

      {/* Character counter — показывается только когда close to limit */}
      {text.length > 1800 && (
        <div
          className={`input-counter ${
            text.length >= 2000
              ? 'input-counter--critical'
              : 'input-counter--warn'
          }`}
        >
          {text.length} / 2000
        </div>
      )}

      {attachments.length > 0 && (
        <div className="comment-attachment-preview" aria-label="Прикреплённые вложения">
          {attachments.map((attachment, index) => (
            <div
              key={`${attachment.type}-${index}`}
              className={`attachment-preview-item attachment-preview-item--${attachment.type}`}
            >
              {attachment.type === 'image' ? (
                <img src={attachment.url} alt="Фото к комментарию" />
              ) : (
                <span className="attachment-preview-sticker" aria-hidden="true">
                  {attachment.emoji}
                </span>
              )}
              <span className="attachment-preview-type">
                {attachment.type === 'image' ? 'Фото' : attachment.label ?? 'Стикер'}
              </span>
              <button
                type="button"
                className="attachment-preview-remove"
                onClick={() => removeAttachment(index)}
                aria-label="Убрать вложение"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {stickerOpen && mediaEnabled && (
        <div className="sticker-picker" aria-label="Выбор стикера">
          {STICKERS.map((sticker) => (
            <button
              key={sticker.id}
              type="button"
              className="sticker-picker__item"
              onClick={() => addSticker(sticker)}
              aria-label={`Добавить стикер ${sticker.label}`}
            >
              <span aria-hidden="true">{sticker.emoji}</span>
              <small>{sticker.label}</small>
            </button>
          ))}
        </div>
      )}

      <div className="comment-input-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="comment-file-input"
          onChange={handlePhotoSelected}
        />
        {mediaEnabled && (
          <>
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBlocked || sending || processingPhoto || attachments.length >= MAX_ATTACHMENTS}
              aria-label="Прикрепить фото"
            >
              {processingPhoto ? '…' : '📷'}
            </button>
            <button
              type="button"
              className={`attach-btn ${stickerOpen ? 'attach-btn--active' : ''}`}
              onClick={() => setStickerOpen((open) => !open)}
              disabled={isBlocked || sending || attachments.length >= MAX_ATTACHMENTS}
              aria-label="Добавить стикер"
              aria-pressed={stickerOpen}
            >
              😊
            </button>
          </>
        )}
        <textarea
          ref={textareaRef}
          className={`comment-input ${isBlocked ? 'comment-input--blocked' : ''}`}
          aria-label={replyTo ? `Ответить ${replyTo.author_name}` : 'Текст комментария'}
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
          aria-label={sending ? 'Отправка...' : isBlocked ? `Подождите ${cooldown} сек.` : 'Отправить комментарий'}
        >
          {sending ? '…' : isBlocked ? `${cooldown}` : '➤'}
        </button>
      </div>
    </div>
  );
}
