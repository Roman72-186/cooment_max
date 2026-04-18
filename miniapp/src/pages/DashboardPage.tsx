// Dashboard — главная страница владельца канала
import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getReferralStats } from '../api/backend';
import type { ChannelSummary } from '../api/backend';

export function DashboardPage() {
  const { user, setPage } = useAppStore();
  const [refStats, setRefStats] = useState<{
    invited: number; converted: number; days_earned: number; ref_link: string | null;
  } | null>(null);

  useEffect(() => {
    getReferralStats().then(setRefStats).catch(() => {});
  }, []);

  if (!user) return null;

  const isPro = user.plan === 'pro' &&
    (!user.plan_expires || new Date(user.plan_expires) > new Date());

  const refLink = refStats?.ref_link
    ?? (user.ref_code ? `https://max.ru/id861708697380_2_bot?start=ref_${user.ref_code}` : null);

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
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setPage({ id: 'pricing' })}
            >
              {isPro ? 'Подписка' : '⬆ PRO'}
            </button>
          </div>
        </div>
      </header>

      <main className="page-content">
        {user.channels.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon">📡</span>
            <span className="empty-state__text">Нет подключённых каналов</span>
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
                onInbox={() => setPage({ id: 'inbox', channelId: ch.id, channelName: ch.channel_name ?? ch.max_chat_id })}
              />
            ))}
          </div>
        )}

        {/* Реферальная программа */}
        {refLink && (
          <div className="ref-card">
            <div className="ref-card__title">🔗 Реферальная программа</div>
            <div className="ref-card__desc">
              Пригласите владельца канала — он получит <strong>+7 дней PRO</strong> бесплатно,
              вы получите <strong>+30 дней PRO</strong> когда он оформит подписку.
            </div>
            {refStats && (
              <div className="ref-stats">
                <div className="ref-stat">
                  <span className="ref-stat__val">{refStats.invited}</span>
                  <span className="ref-stat__lbl">приглашено</span>
                </div>
                <div className="ref-stat">
                  <span className="ref-stat__val">{refStats.converted}</span>
                  <span className="ref-stat__lbl">купили PRO</span>
                </div>
                <div className="ref-stat">
                  <span className="ref-stat__val">{refStats.days_earned}</span>
                  <span className="ref-stat__lbl">дней заработано</span>
                </div>
              </div>
            )}
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
  onInbox: () => void;
}

function openChannelInMax(chatId: string) {
  const url = `https://max.ru/id${chatId}`;
  if (window.WebApp && typeof window.WebApp.openLink === 'function') {
    window.WebApp.openLink(url);
  } else {
    window.open(url, '_blank');
  }
}

function ChannelCard({ channel, onAnalytics, onSettings, onInbox }: ChannelCardProps) {
  return (
    <div className="channel-card">
      <div className="channel-card__header">
        <button
          className="channel-card__name channel-card__name--link"
          onClick={() => openChannelInMax(channel.max_chat_id)}
          title="Открыть канал в MAX"
        >
          {channel.channel_name || channel.max_chat_id} ↗
        </button>
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
        <button className="btn btn--ghost btn--sm" onClick={onInbox}>
          📥 Входящие
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onAnalytics}>
          📊 Аналитика
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onSettings}>
          ⚙️ Настройки
        </button>
      </div>
    </div>
  );
}
