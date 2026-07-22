// Агрегатор комментариев — лента последних 50 комментариев по всем каналам владельца
import { useEffect, useState, useCallback } from 'react';
import { getFeed } from '../api/backend';
import type { FeedItem } from '../api/backend';
import { useAppStore } from '../store/useAppStore';

const PAGE_SIZE = 20;

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return 'сейчас';
  if (diff < 3600)  return `${Math.floor(diff / 60)} мин`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч`;
  return `${Math.floor(diff / 86400)} дн`;
}

interface InboxPageProps {
  channelId?: number;
  channelName?: string;
}

function getFeedPreview(item: FeedItem): string {
  if (item.text) return item.text;
  const firstAttachment = item.attachments_json?.[0];
  if (firstAttachment?.type === 'image') return 'Фото';
  if (firstAttachment?.type === 'sticker') return `Стикер ${firstAttachment.emoji}`;
  return 'Комментарий без текста';
}

export function InboxPage({ channelId, channelName }: InboxPageProps) {
  const { setPage } = useAppStore();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFeed(channelId);
      setItems(data);
      setVisibleCount(PAGE_SIZE); // сбрасываем пагинацию при свежей загрузке
    } catch {
      setError('Не удалось загрузить комментарии');
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { load(); }, [load]);

  const subtitle = channelId && channelName
    ? `Комментарии канала «${channelName}»`
    : 'Последние комментарии по всем каналам';

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-row">
          <button className="btn-back" onClick={() => setPage({ id: 'dashboard' })}>
            ← Назад
          </button>
          <h1 className="page-title">Входящие</h1>
          <button className="btn btn--ghost btn--sm" onClick={load} disabled={loading}>
            {loading ? '...' : 'Обновить'}
          </button>
        </div>
        <div className="page-subtitle">{subtitle}</div>
      </header>

      <main className="page-content">
        {loading && items.length === 0 && (
          <div className="skeleton-list">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton-item" />)}
          </div>
        )}

        {error && <div className="alert alert--error" role="alert">{error}</div>}

        {!loading && items.length === 0 && !error && (
          <div className="empty-state">
            <span className="empty-state__icon">📭</span>
            <span className="empty-state__text">Комментариев пока нет</span>
          </div>
        )}

        {items.length > 0 && (
          <>
            <div className="inbox-list">
              {items.slice(0, visibleCount).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="inbox-card"
                  onClick={() => setPage({
                    id: 'comments',
                    postId: item.post_id,
                    from: 'inbox',
                    inboxChannelId: channelId,
                    inboxChannelName: channelName,
                  })}
                >
                  <div className="inbox-card__header">
                    <div className="inbox-card__source">
                      <span className="inbox-channel-name">
                        {item.channel_name ?? item.max_chat_id}
                      </span>
                      {item.post_preview && (
                        <span className="inbox-post-preview">
                          {item.post_preview.slice(0, 50)}{item.post_preview.length > 50 ? '…' : ''}
                        </span>
                      )}
                    </div>
                    <span className="inbox-card__time">{timeAgo(item.created_at)}</span>
                  </div>
                  <div className="inbox-card__author">{item.author_name}</div>
                  <p className="inbox-card__text">{getFeedPreview(item)}</p>
                </button>
              ))}
            </div>
            {visibleCount < items.length && (
              <div className="inbox-load-more">
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                >
                  Показать ещё ({items.length - visibleCount})
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
