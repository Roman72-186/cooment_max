// Dashboard — главная страница владельца канала
import { useAppStore } from '../store/useAppStore';
import type { ChannelSummary } from '../api/backend';

export function DashboardPage() {
  const { user, setPage } = useAppStore();

  if (!user) return null;

  const isPro = user.plan === 'pro' &&
    (!user.plan_expires || new Date(user.plan_expires) > new Date());

  // Реферальная ссылка (бот пришлёт её через /start)
  const refLink = user.ref_code
    ? `https://max.ru/MaxCommentsBot?start=ref_${user.ref_code}`
    : null;

  return (
    <div className="page">
      <header className="page-header">
        <div className="dashboard-header">
          <div>
            <h1 className="page-title">Мои каналы</h1>
            <span className={`plan-badge plan-badge--${user.plan}`}>
              {isPro ? 'PRO' : 'FREE'}
            </span>
          </div>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setPage({ id: 'pricing' })}
          >
            {isPro ? 'Подписка' : '⬆ PRO'}
          </button>
        </div>
      </header>

      <main className="page-content">
        {user.channels.length === 0 ? (
          <div className="empty-state">
            <span>Нет подключённых каналов</span>
            <button
              className="btn btn--primary"
              onClick={() => setPage({ id: 'onboarding' })}
            >
              Подключить канал
            </button>
          </div>
        ) : (
          <div className="channel-list">
            {user.channels.map((ch) => (
              <ChannelCard
                key={ch.id}
                channel={ch}
                onAnalytics={() => setPage({ id: 'analytics', channelId: ch.id })}
                onSettings={() => setPage({ id: 'settings', channelId: ch.id })}
              />
            ))}
          </div>
        )}

        {/* Реферальная программа */}
        {refLink && (
          <div className="ref-card">
            <div className="ref-card__title">Реферальная программа</div>
            <div className="ref-card__desc">
              Пригласите владельца канала — получите <strong>+30 дней PRO</strong>
            </div>
            <div className="ref-card__link">{refLink}</div>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => navigator.clipboard.writeText(refLink)}
            >
              Скопировать ссылку
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Карточка одного канала ──────────────────────────────────────

interface ChannelCardProps {
  channel: ChannelSummary;
  onAnalytics: () => void;
  onSettings: () => void;
}

function ChannelCard({ channel, onAnalytics, onSettings }: ChannelCardProps) {
  return (
    <div className="channel-card">
      <div className="channel-card__header">
        <div className="channel-card__name">
          {channel.channel_name ?? channel.max_chat_id}
        </div>
        <div className={`channel-card__status ${channel.is_active ? '' : 'channel-card__status--off'}`}>
          {channel.is_active ? 'активен' : 'неактивен'}
        </div>
      </div>

      <div className="channel-card__stats">
        <div className="stat">
          <span className="stat__value">{channel.post_count}</span>
          <span className="stat__label">постов</span>
        </div>
        <div className="stat">
          <span className="stat__value">{channel.total_comments}</span>
          <span className="stat__label">комментариев</span>
        </div>
        <div className="stat">
          <span className="stat__value">{channel.comments_enabled ? 'вкл' : 'выкл'}</span>
          <span className="stat__label">комментарии</span>
        </div>
      </div>

      <div className="channel-card__actions">
        <button className="btn btn--secondary btn--sm" onClick={onAnalytics}>
          Аналитика
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onSettings}>
          Настройки
        </button>
      </div>
    </div>
  );
}
