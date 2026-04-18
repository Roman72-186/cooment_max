// Карточка комментария — мессенджер-стиль
// Долгий тап → контекстное меню (реакции + ответить + удалить)
// Свайп влево → цитирование (как в Telegram)
import { useState, useRef, useEffect } from 'react';

// Быстрые эмодзи для выбора реакции
const QUICK_EMOJIS = ['❤️', '👍', '👎', '😂', '🔥', '😮', '😢', '🎉'];
import type { Comment, EmojiReaction } from '../api/backend';
import { deleteComment, toggleReaction, banUser } from '../api/backend';
import { useAppStore } from '../store/useAppStore';
import { getBridgeUser } from '../bridge/maxBridge';


// ── Цветовая палитра авторов — только синие и зелёные градации ───
// Каждый author_max_id детерминированно получает свой цвет.
const AUTHOR_PALETTE = [
  { avatar: '#0288d1', bubble: 'rgba(2,136,209,0.32)',   name: '#38bdf8' },  // синий
  { avatar: '#00897b', bubble: 'rgba(0,137,123,0.30)',   name: '#34d399' },  // бирюзовый
  { avatar: '#1565c0', bubble: 'rgba(21,101,192,0.32)',  name: '#60a5fa' },  // тёмно-синий
  { avatar: '#43a047', bubble: 'rgba(67,160,71,0.30)',   name: '#4ade80' },  // зелёный
  { avatar: '#0097a7', bubble: 'rgba(0,151,167,0.30)',   name: '#22d3ee' },  // циан
  { avatar: '#2e7d32', bubble: 'rgba(46,125,50,0.30)',   name: '#86efac' },  // тёмно-зелёный
  { avatar: '#01579b', bubble: 'rgba(1,87,155,0.32)',    name: '#7dd3fc' },  // морской
  { avatar: '#00695c', bubble: 'rgba(0,105,92,0.30)',    name: '#5eead4' },  // тёмная бирюза
  { avatar: '#1976d2', bubble: 'rgba(25,118,210,0.32)',  name: '#93c5fd' },  // яркий синий
  { avatar: '#388e3c', bubble: 'rgba(56,142,60,0.30)',   name: '#6ee7b7' },  // средний зелёный
];

function getAuthorPalette(authorMaxId?: number) {
  const idx = (authorMaxId ?? 0) % AUTHOR_PALETTE.length;
  return AUTHOR_PALETTE[idx];
}

interface Props {
  comment: Comment;
  parentComment?: Comment;   // родительский комментарий для показа цитаты
  onDeleted?: (id: number) => void;
  onRestoreComment?: (comment: Comment) => void;  // откат при ошибке удаления/бана
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  // Сегодня — показываем HH:MM, иначе — дд мес
  if (sameDay) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function renderTextWithLinks(text: string): React.ReactNode {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const url = match[0];
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="comment-link"
        onClick={(e) => {
          e.preventDefault();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).WebApp?.openLink(url);
        }}
      >
        {url}
      </a>
    );
    lastIndex = match.index + url.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? <>{parts}</> : text;
}

// Порог и максимальный сдвиг свайпа (px)
const SWIPE_THRESHOLD = 56;
const SWIPE_MAX      = 72;

export function CommentCard({ comment, parentComment, onDeleted, onRestoreComment }: Props) {
  const setReplyTo = useAppStore((s) => s.setReplyTo);

  const [emojiReactions, setEmojiReactions] = useState<EmojiReaction[]>(
    comment.emoji_reactions ?? []
  );
  const [reacting, setReacting] = useState(false);
  // Ref для отслеживания активного оптимистичного обновления (избегаем race condition)
  const reactingRef = useRef(false);

  // Синхронизируем реакции с сервером при каждом поллинге (если не в процессе своей реакции)
  useEffect(() => {
    if (!reactingRef.current) {
      setEmojiReactions(comment.emoji_reactions ?? []);
    }
  }, [comment.emoji_reactions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Очистка longPressTimer при размонтировании (предотвращает setState на unmounted компоненте)
  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) {
        clearTimeout(longPressTimer.current);
      }
    };
  }, []);
  const [contextOpen, setContextOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 100, left: 42 });
  const [deleting, setDeleting] = useState(false);
  const [banning, setBanning] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const longPressTimer = useRef<number | null>(null);

  // Свайп влево для ответа
  const cardInnerRef  = useRef<HTMLDivElement>(null);
  const replyIconRef  = useRef<HTMLDivElement>(null);
  const swipeStartX   = useRef(0);
  const swipeStartY   = useRef(0);
  const swipeDelta    = useRef(0);
  const swipeDecided  = useRef(false);       // направление определено
  const swipeHoriz    = useRef(false);       // true — горизонтальный свайп

  const bridgeUser = getBridgeUser();
  const currentMaxId = bridgeUser?.id ?? bridgeUser?.user_id;

  const isOwner = comment.author_max_id != null &&
    comment.author_max_id === comment.channel_owner_max_id;

  const palette = getAuthorPalette(comment.author_max_id);

  const canDelete = Boolean(
    currentMaxId &&
    (currentMaxId === comment.author_max_id ||
     currentMaxId === comment.channel_owner_max_id)
  );
  const canBan = Boolean(
    currentMaxId &&
    currentMaxId === comment.channel_owner_max_id &&
    currentMaxId !== comment.author_max_id &&
    comment.channel_id
  );

  if (comment.is_hidden) return null;

  // ── Возврат карточки в исходное положение ─────────────────────
  function snapBack() {
    if (cardInnerRef.current) {
      cardInnerRef.current.style.transition = 'transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94)';
      cardInnerRef.current.style.transform  = 'translateX(0)';
      // Снимаем подсветку пузыря
      const body = cardInnerRef.current.querySelector('.comment-body') as HTMLElement | null;
      if (body) {
        body.style.transition = 'outline 0.15s ease, box-shadow 0.15s ease';
        body.style.outline    = '';
        body.style.boxShadow  = '';
      }
    }
    if (replyIconRef.current) {
      replyIconRef.current.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
      replyIconRef.current.style.opacity    = '0';
      replyIconRef.current.style.transform  = 'translateY(-50%) scale(0.5)';
    }
    swipeHoriz.current   = false;
    swipeDecided.current = false;
    swipeDelta.current   = 0;
  }

  // ── Вычислить позицию контекстного меню (fixed, ниже/выше карточки) ──
  function computeMenuPos(): { top: number; left: number } {
    const card = document.getElementById(`comment-${comment.id}`);
    const MENU_H = 300; // приблизительная высота меню (эмодзи + действия)
    const MENU_W = 240;
    const GAP    = 6;
    const EDGE   = 8;

    if (!card) return { top: 100, left: EDGE };

    const rect = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Предпочтительно — ниже комментария
    let top = rect.bottom + GAP;
    if (top + MENU_H > vh - EDGE) {
      // Не влезает снизу — показываем выше
      top = Math.max(EDGE, rect.top - MENU_H - GAP);
    }

    // Горизонтальное выравнивание: начиная от аватара
    let left = 42;
    if (left + MENU_W > vw - EDGE) left = vw - MENU_W - EDGE;
    if (left < EDGE) left = EDGE;

    return { top, left };
  }

  // ── Обработчики касаний ────────────────────────────────────────
  function handleTouchStart(e: React.TouchEvent) {
    swipeStartX.current  = e.touches[0].clientX;
    swipeStartY.current  = e.touches[0].clientY;
    swipeDelta.current   = 0;
    swipeDecided.current = false;
    swipeHoriz.current   = false;

    // Долгое нажатие (500 мс) → открываем контекстное меню
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      setMenuPos(computeMenuPos());
      setContextOpen(true);
      navigator.vibrate?.(30);
    }, 500);
  }

  function handleTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = e.touches[0].clientY - swipeStartY.current;

    // Если палец сдвинулся — отменяем долгое нажатие
    if ((Math.abs(dx) > 8 || Math.abs(dy) > 8) && longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    // Определяем направление по первому значимому движению
    if (!swipeDecided.current) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // Только свайп влево (dx < 0) и горизонталь доминирует
      swipeHoriz.current   = dx < 0 && Math.abs(dx) > Math.abs(dy);
      swipeDecided.current = true;
    }

    if (!swipeHoriz.current) return;

    // Смещение: от 0 до -SWIPE_MAX
    const offset = Math.max(dx, -SWIPE_MAX);
    if (offset >= 0) return;
    swipeDelta.current = offset;

    const progress         = Math.min(1, Math.abs(offset) / SWIPE_THRESHOLD);
    const thresholdReached = Math.abs(offset) >= SWIPE_THRESHOLD;

    // Анимируем напрямую через DOM — без ре-рендера React
    if (cardInnerRef.current) {
      cardInnerRef.current.style.transition = 'none';
      cardInnerRef.current.style.transform  = `translateX(${offset}px)`;

      // Подсвечиваем пузырь когда порог свайпа достигнут
      const body = cardInnerRef.current.querySelector('.comment-body') as HTMLElement | null;
      if (body) {
        body.style.transition = 'none';
        if (thresholdReached) {
          body.style.outline   = '2px solid rgba(124,77,255,0.75)';
          body.style.boxShadow = '0 4px 20px rgba(124,77,255,0.25), 0 1px 4px rgba(0,0,0,0.15)';
        } else {
          body.style.outline   = '';
          body.style.boxShadow = '';
        }
      }
    }
    if (replyIconRef.current) {
      replyIconRef.current.style.transition = 'none';
      replyIconRef.current.style.opacity    = String(progress);
      // При достижении порога — иконка «защёлкивается» в полный размер
      const scale = thresholdReached ? 1.15 : 0.5 + 0.5 * progress;
      replyIconRef.current.style.transform  = `translateY(-50%) scale(${scale})`;
    }
  }

  function handleTouchEnd() {
    // Отменяем долгое нажатие если ещё не сработало
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    const isSwipe = swipeHoriz.current && swipeDelta.current <= -SWIPE_THRESHOLD;
    snapBack();

    if (isSwipe) {
      setReplyTo(comment);
      navigator.vibrate?.(30);
    }
  }

  // Правый клик на десктопе
  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenuPos(computeMenuPos());
    setContextOpen(true);
  }

  // ── Реакция ───────────────────────────────────────────────────
  async function handleReact(emoji: string) {
    if (reactingRef.current) return;
    reactingRef.current = true;
    setReacting(true);
    setContextOpen(false);

    // Оптимистичный апдейт: один пользователь — одна реакция
    setEmojiReactions((prev) => {
      // Находим текущую реакцию пользователя (если есть)
      const myReaction = prev.find((r) => r.reacted_by_me);

      // Нажали тот же эмодзи → снимаем (toggle off)
      if (myReaction?.emoji === emoji) {
        const updated = { ...myReaction, count: myReaction.count - 1, reacted_by_me: false };
        return updated.count <= 0
          ? prev.filter((r) => r.emoji !== emoji)
          : prev.map((r) => r.emoji === emoji ? updated : r);
      }

      // Снимаем предыдущую реакцию (если была другая)
      let next = prev;
      if (myReaction) {
        const dec = { ...myReaction, count: myReaction.count - 1, reacted_by_me: false };
        next = dec.count <= 0
          ? prev.filter((r) => r.emoji !== myReaction.emoji)
          : prev.map((r) => r.emoji === myReaction.emoji ? dec : r);
      }

      // Добавляем новую реакцию
      const target = next.find((r) => r.emoji === emoji);
      if (target) {
        return next.map((r) => r.emoji === emoji ? { ...r, count: r.count + 1, reacted_by_me: true } : r);
      }
      return [...next, { emoji, count: 1, reacted_by_me: true }];
    });

    try {
      const result = await toggleReaction(comment.id, emoji);
      setEmojiReactions(result.reactions);
    } catch {
      setEmojiReactions(comment.emoji_reactions ?? []);
    } finally {
      reactingRef.current = false;
      setReacting(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(comment.text);
    } catch {
      // Clipboard API недоступен — игнорируем
    }
    setContextOpen(false);
  }

  async function handleCopyLink() {
    const link = `${window.location.origin}/c/${comment.id}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {}
    setContextOpen(false);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setContextOpen(false);
    onDeleted?.(comment.id); // оптимистично убираем сразу
    try {
      await deleteComment(comment.id);
    } catch {
      onRestoreComment?.(comment); // откат при ошибке сети
      setDeleting(false);
    }
  }

  async function handleBan() {
    if (banning || !comment.channel_id || !comment.author_max_id) return;
    setBanning(true);
    setContextOpen(false);
    onDeleted?.(comment.id); // оптимистично убираем сразу
    try {
      await banUser(comment.channel_id, comment.author_max_id);
    } catch {
      onRestoreComment?.(comment); // откат при ошибке сети
      setBanning(false);
    }
  }

  return (
    <>
      {/* Оверлей для закрытия контекстного меню при тапе вне */}
      {contextOpen && (
        <div className="context-overlay" onClick={() => setContextOpen(false)} />
      )}

      <div
        id={`comment-${comment.id}`}
        className={`comment-card ${isOwner ? 'comment-card--owner' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onContextMenu={handleContextMenu}
      >
        {/* Иконка ответа — появляется при свайпе влево */}
        <div ref={replyIconRef} className="comment-swipe-icon" aria-hidden="true">↩</div>

        {/* Скользящий контент (аватар + пузырь) */}
        <div ref={cardInnerRef} className="comment-card-inner">
          {/* Аватар с цветом автора */}
          <div
            className="comment-avatar"
            style={{ background: isOwner ? '#8b5cf6' : palette.avatar }}
          >
            {getInitials(comment.author_name)}
          </div>

          {/* Тело сообщения — единый фон из CSS, автор различается по цвету имени */}
          <div className="comment-body">
            <div className="comment-header">
              <span
                className="comment-author"
                style={{ color: isOwner ? '#a78bfa' : palette.name }}
              >
                {comment.author_name}
              </span>
              {isOwner && <span className="comment-admin-badge">Админ</span>}
              <span className="comment-time">{formatTime(comment.created_at)}</span>
            </div>

            {/* Цитата — клик скроллит к оригинальному комментарию */}
            {parentComment && (
              <button
                className="comment-quote"
                aria-label={`Перейти к комментарию ${parentComment.author_name}`}
                onClick={() => {
                  const el = document.getElementById(`comment-${parentComment.id}`);
                  if (!el) return;
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el.classList.add('comment-card--highlight');
                  setTimeout(() => el.classList.remove('comment-card--highlight'), 1200);
                }}
              >
                <span className="comment-quote__author">{parentComment.author_name}</span>
                <span className="comment-quote__text">
                  {parentComment.text.slice(0, 100)}
                  {parentComment.text.length > 100 ? '…' : ''}
                </span>
              </button>
            )}

            <p className="comment-text">{renderTextWithLinks(comment.text)}</p>

            {/* Реакции — пилюли по каждому эмодзи (один пользователь — одна) */}
            {emojiReactions.length > 0 && (
              <div className="comment-reactions">
                {emojiReactions.map((r) => (
                  <button
                    key={r.emoji}
                    className={`reaction-pill ${r.reacted_by_me ? 'reaction-pill--active' : ''}`}
                    onClick={() => handleReact(r.emoji)}
                    disabled={reacting}
                    aria-label={`${r.emoji} ${r.count}. ${r.reacted_by_me ? 'Убрать реакцию' : 'Добавить реакцию'}`}
                    aria-pressed={r.reacted_by_me}
                  >
                    {r.emoji} <span className="reaction-count" aria-hidden="true">{r.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Тост: ссылка скопирована */}
        {linkCopied && (
          <div className="comment-link-copied">🔗 Ссылка скопирована</div>
        )}

        {/* Контекстное меню (тап по комментарию) */}
        {contextOpen && (
          <div className="comment-context-menu" style={{ top: menuPos.top, left: menuPos.left }}>
            {/* Быстрые реакции */}
            <div className="context-emojis">
              {QUICK_EMOJIS.map((emoji) => {
                const isActive = emojiReactions.some((r) => r.emoji === emoji && r.reacted_by_me);
                return (
                  <button
                    key={emoji}
                    className={`context-emoji-btn ${isActive ? 'context-emoji-btn--active' : ''}`}
                    onClick={() => handleReact(emoji)}
                    disabled={reacting}
                    aria-label={`${isActive ? 'Убрать' : 'Добавить'} реакцию ${emoji}`}
                    aria-pressed={isActive}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
            {/* Действия */}
            <div className="context-actions">
              <button
                className="context-action-btn"
                onClick={() => { setReplyTo(comment); setContextOpen(false); }}
              >
                ↩ Ответить
              </button>
              <button
                className="context-action-btn"
                onClick={handleCopy}
              >
                ⎘ Копировать
              </button>
              <button
                className="context-action-btn"
                onClick={handleCopyLink}
              >
                🔗 Ссылка на комментарий
              </button>
              {canDelete && (
                <button
                  className="context-action-btn context-action-btn--danger"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Удаление…' : '✕ Удалить'}
                </button>
              )}
              {canBan && (
                <button
                  className="context-action-btn context-action-btn--danger"
                  onClick={handleBan}
                  disabled={banning}
                >
                  {banning ? 'Блокировка…' : '🚫 Заблокировать'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
