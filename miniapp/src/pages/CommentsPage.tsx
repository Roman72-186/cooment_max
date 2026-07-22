// Главная страница — список комментариев к посту
// Открывается когда start_param = "post_<ID>"
import { useEffect, useCallback, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getComments, recordView, getUserMe, updateReplyNotifications, refreshPostCounter, getPost } from '../api/backend';
import type { Comment } from '../api/backend';
import { CommentThread } from '../components/CommentThread';
import { CommentInput } from '../components/CommentInput';
import { PollWidget } from '../components/PollWidget';
import { expand } from '../bridge/maxBridge';

const BOT_URL = 'https://max.ru/id861708697380_2_bot';
const NOTIFY_BANNER_KEY = 'notify_prompt_dismissed';

interface Props {
  postId: number;
  highlightCommentId?: number;
  from?: 'inbox';
  inboxChannelId?: number;
  inboxChannelName?: string;
}

export function CommentsPage({ postId, highlightCommentId, from, inboxChannelId, inboxChannelName }: Props) {
  const { comments, loading, error, setComments, addComment, removeComment, setLoading, setError, user, setUser, setPage } = useAppStore();
  const contentRef      = useRef<HTMLDivElement>(null);
  const prevCountRef    = useRef(0);      // отслеживаем рост числа комментариев
  const shouldScroll    = useRef(false);  // флаг: нужен скролл после следующего рендера
  const didHighlightRef = useRef(false);  // защита от повторного скролла при поллинге
  const isNearBottomRef = useRef(true);   // пользователь около нижнего края
  const [newCount, setNewCount] = useState(0); // счётчик новых комментариев (ARIA + бейдж)
  const [mediaCommentsEnabled, setMediaCommentsEnabled] = useState(false);

  // Загружаем пользователя если открыты напрямую (fast-path, без App.tsx загрузки)
  useEffect(() => {
    if (!user) {
      getUserMe().then(setUser).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Баннер «Включить уведомления» — один раз, только если ещё не включено
  const [showNotifyBanner, setShowNotifyBanner] = useState(
    () => !localStorage.getItem(NOTIFY_BANNER_KEY)
  );
  // Флаг загрузки кнопки-колокольчика
  const [toggling, setToggling] = useState(false);

  const dismissBanner = useCallback(() => {
    localStorage.setItem(NOTIFY_BANNER_KEY, '1');
    setShowNotifyBanner(false);
  }, []);

  // «Включить» в баннере: сохраняет в API + открывает бота + скрывает баннер
  const enableNotifications = useCallback(async () => {
    (window as any).WebApp?.openLink(`${BOT_URL}?start=notify`);
    dismissBanner();
    if (user && !user.reply_notifications_enabled) {
      setUser({ ...user, reply_notifications_enabled: true });
      await updateReplyNotifications(true).catch(() => {});
    }
  }, [dismissBanner, user, setUser]);

  // Переключить DM-уведомления об ответах (оптимистичное обновление + loading-флаг)
  const toggleReplyNotifications = useCallback(async () => {
    if (!user || toggling) return;
    setToggling(true);
    const newValue = !user.reply_notifications_enabled;
    setUser({ ...user, reply_notifications_enabled: newValue });

    // При включении открываем бота — нужно чтобы DM работали
    if (newValue) {
      (window as any).WebApp?.openLink(`${BOT_URL}?start=notify`);
    }

    try {
      await updateReplyNotifications(newValue);
    } catch {
      // Откат при ошибке сети
      setUser({ ...user, reply_notifications_enabled: !newValue });
    } finally {
      setToggling(false);
    }
  }, [user, setUser, toggling]);

  // Скролл вниз — вызывается после загрузки/отправки
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
      }
    });
  }, []);

  // Следим за позицией скролла: обновляем isNearBottomRef, прячем бейдж при достижении низа
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      isNearBottomRef.current = nearBottom;
      if (nearBottom) setNewCount(0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []); // contentRef стабилен — пустой депс OK

  // Инициируем обновление кнопки и сразу закрываем — не ждём ответа сервера.
  // Только для fast-path входа (deep link из канала MAX) — здесь корректно закрыть весь Mini App.
  const handleClose = useCallback(() => {
    refreshPostCounter(postId); // fire-and-forget, ошибки поглощены внутри
    window.WebApp?.close();
  }, [postId]);

  // Возврат во «Входящие» — сюда попадают открыв пост изнутри Mini App, а не по deep link,
  // поэтому закрывать всё приложение (WebApp.close) было бы неверно — просто уходим на предыдущий экран.
  const handleBackToInbox = useCallback(() => {
    refreshPostCounter(postId);
    setPage({ id: 'inbox', channelId: inboxChannelId, channelName: inboxChannelName });
  }, [postId, setPage, inboxChannelId, inboxChannelName]);

  // Удалить комментарий из локального стейта (оптимистично, без перезагрузки)
  const handleDeleted = useCallback((id: number) => {
    removeComment(id);
  }, [removeComment]);

  // Восстановить комментарий при ошибке удаления/бана (откат)
  const handleRestoreComment = useCallback((comment: Comment) => {
    setComments(
      [...useAppStore.getState().comments, comment].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
    );
  }, [setComments]);

  const loadComments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getComments(postId);
      setComments(data);
    } catch (err) {
      setError('Не удалось загрузить комментарии');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [postId, setComments, setLoading, setError]);

  const loadNewComments = useCallback(async () => {
    const current = useAppStore.getState().comments;
    const lastId = current.reduce((max, comment) => Math.max(max, comment.id), 0);

    if (lastId === 0) {
      await loadComments();
      return;
    }

    try {
      const data = await getComments(postId, { afterId: lastId });
      if (data.length === 0) return;

      const existingIds = new Set(current.map((comment) => comment.id));
      const merged = [
        ...current,
        ...data.filter((comment) => !existingIds.has(comment.id)),
      ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      setComments(merged);
    } catch (err) {
      console.warn('Failed to load new comments:', err);
    }
  }, [postId, loadComments, setComments]);

  // При отправке комментария — добавляем локально и скроллим вниз (без перезагрузки)
  const handleSent = useCallback((comment: Comment) => {
    shouldScroll.current = true;
    addComment(comment);
  }, [addComment]);

  // Скроллим вниз или показываем бейдж при появлении новых комментариев
  useEffect(() => {
    const hasHighlight = highlightCommentId && !didHighlightRef.current;

    if (shouldScroll.current) {
      // Пользователь сам отправил комментарий → всегда скроллим вниз
      if (!hasHighlight) scrollToBottom();
      shouldScroll.current = false;
    } else if (comments.length > prevCountRef.current) {
      if (prevCountRef.current === 0) {
        // Первая загрузка страницы
        if (!hasHighlight) scrollToBottom();
      } else if (isNearBottomRef.current && !hasHighlight) {
        // Пользователь уже внизу → тихо подскроллить
        scrollToBottom();
      } else {
        // Читает старые комментарии → не трогать скролл, показать бейдж
        setNewCount((prev) => prev + (comments.length - prevCountRef.current));
      }
    }

    prevCountRef.current = comments.length;
  }, [comments.length, scrollToBottom, highlightCommentId]);

  // После загрузки комментариев — прокрутить к выделенному и вспыхнуть
  useEffect(() => {
    if (!loading && highlightCommentId && comments.length > 0 && !didHighlightRef.current) {
      const el = document.getElementById(`comment-${highlightCommentId}`);
      if (el) {
        didHighlightRef.current = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('comment-card--deeplink');
        setTimeout(() => el.classList.remove('comment-card--deeplink'), 3200);
      }
    }
  }, [loading, highlightCommentId, comments.length]);

  useEffect(() => {
    expand();
    recordView(postId); // фиксируем просмотр один раз при открытии
    getPost(postId).then(post => {
      setMediaCommentsEnabled(Boolean(post?.media_comments_enabled));
    }).catch(() => setMediaCommentsEnabled(false));
    loadComments();

    // Обновляем каждые 15 секунд только новые комментарии.
    const timer = setInterval(loadNewComments, 15_000);
    return () => clearInterval(timer);
  }, [postId, loadComments, loadNewComments]);

  return (
    <div className="page">
      {/* ARIA live region для новых комментариев */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {newCount > 0 ? `${newCount} новых комментариев` : ''}
      </div>

      <header className="page-header">
        <div className="page-header-row">
          {from === 'inbox' ? (
            <button className="btn-back" onClick={handleBackToInbox}>
              ← Входящие
            </button>
          ) : (
            <button className="btn-close" onClick={handleClose} aria-label="Закрыть комментарии">
              ✕
            </button>
          )}
          <h1 className="page-title">Комментарии</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="comment-count">{comments.length}</span>
          {user && (
            <button
              className={`notify-toggle${user.reply_notifications_enabled ? ' notify-toggle--on' : ' notify-toggle--off'}`}
              onClick={toggleReplyNotifications}
              disabled={toggling}
              aria-label={user.reply_notifications_enabled ? 'Уведомления включены, нажмите чтобы отключить' : 'Уведомления отключены, нажмите чтобы включить'}
            >
              🔔
            </button>
          )}
        </div>
      </header>

      {showNotifyBanner && user !== null && !user.reply_notifications_enabled && (
        <div className="notify-banner">
          <span className="notify-banner__text">
            🔔 Получайте уведомления когда вам ответят
          </span>
          <div className="notify-banner__actions">
            <button className="notify-banner__btn notify-banner__btn--primary" onClick={enableNotifications}>
              Включить
            </button>
            <button className="notify-banner__btn notify-banner__btn--dismiss" onClick={dismissBanner}>
              ✕
            </button>
          </div>
        </div>
      )}

      <main ref={contentRef} className="page-content">
        <PollWidget postId={postId} />
        {loading && comments.length === 0 ? (
          <div className="skeleton-list">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton-item" />
            ))}
          </div>
        ) : error ? (
          <div className="error-state" role="alert">
            <span>{error}</span>
            <button onClick={loadComments}>Повторить</button>
          </div>
        ) : (
          <CommentThread comments={comments} onDeleted={handleDeleted} onRestoreComment={handleRestoreComment} />
        )}
      </main>

      {newCount > 0 && (
        <button
          className="new-comments-badge"
          onClick={() => { scrollToBottom(); setNewCount(0); }}
          aria-label={`Прокрутить к ${newCount} новым комментариям`}
        >
          ↓ {newCount} {newCount === 1 ? 'новый' : 'новых'}
        </button>
      )}

      <footer className="page-footer">
        <CommentInput
          postId={postId}
          onSent={handleSent}
          mediaEnabled={mediaCommentsEnabled}
        />
      </footer>
    </div>
  );
}
