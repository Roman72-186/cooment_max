// Dashboard — главная страница владельца канала
import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getReferralStats, getUserMe, syncChannels } from '../api/backend';
import type { ChannelSummary, ReferralStats } from '../api/backend';

export function DashboardPage() {
  const { user, setUser, setPage, addToast } = useAppStore();
  const [refStats, setRefStats] = useState<ReferralStats | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    getReferralStats().then(setRefStats).catch(() => {});
  }, []);

  if (!user) return null;

  const handleSyncChannels = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const syncResult = await syncChannels();
      const freshUser = await getUserMe();
      setUser(freshUser);
      if (syncResult.requires_pro) {
        addToast({ type: 'warning', message: 'Для 2 и более каналов нужен PRO' });
      } else {
        addToast({ type: 'success', message: 'Каналы обновлены' });
      }
    } catch {
      addToast({ type: 'error', message: 'Не удалось обновить каналы' });
    } finally {
      setSyncing(false);
    }
  };

  const isPro = user.plan === 'pro' &&
    (!user.plan_expires || new Date(user.plan_expires) > new Date());

  const totalPosts = user.channels.reduce((sum, ch) => sum + ch.post_count, 0);
  const totalComments = user.channels.reduce((sum, ch) => sum + ch.total_comments, 0);
  const activeChannels = user.channels.filter((ch) => ch.is_active).length;
  const referralBalance = refStats
    ? refStats.balance_rub.toLocaleString('ru-RU', {
        minimumFractionDigits: refStats.balance_rub % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      })
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
          <div className="dashboard-header__actions">
            <button
              className="btn btn--ghost btn--sm"
              onClick={handleSyncChannels}
              disabled={syncing}
            >
              {syncing ? '...' : 'Обновить'}
            </button>
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
        {user.channels.length > 0 && (
          <div className="dashboard-overview" aria-label="Сводка по каналам">
            <div className="dashboard-overview__item">
              <span className="dashboard-overview__value">{user.channels.length}</span>
              <span className="dashboard-overview__label">каналов</span>
            </div>
            <div className="dashboard-overview__item">
              <span className="dashboard-overview__value">{activeChannels}</span>
              <span className="dashboard-overview__label">активных</span>
            </div>
            <div className="dashboard-overview__item">
              <span className="dashboard-overview__value">{totalPosts}</span>
              <span className="dashboard-overview__label">постов</span>
            </div>
            <div className="dashboard-overview__item">
              <span className="dashboard-overview__value">{totalComments}</span>
              <span className="dashboard-overview__label">комментариев</span>
            </div>
          </div>
        )}

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
                isPro={isPro}
                onAnalytics={() => setPage({ id: 'analytics', channelId: ch.id })}
                onSettings={() => setPage({ id: 'settings', channelId: ch.id })}
                onInbox={() => setPage({ id: 'inbox', channelId: ch.id, channelName: ch.channel_name ?? ch.max_chat_id })}
              />
            ))}
          </div>
        )}

        {/* Реферальная программа */}
        {isPro && (refStats || user.ref_code) && (
          <div className="ref-card">
            <div className="ref-card__title">🔗 Реферальная программа</div>
            <div className="ref-card__desc">
              Доступна на активном PRO. Внутри — ссылка для отправки, команда до 5 линии,
              баланс и информация по выводу денег на карту.
            </div>
            {refStats && (
              <>
                <div className="ref-stats">
                  <div className="ref-stat">
                    <span className="ref-stat__val">{refStats.team_total?.invited ?? refStats.invited}</span>
                    <span className="ref-stat__lbl">в команде</span>
                  </div>
                  <div className="ref-stat">
                    <span className="ref-stat__val">{refStats.team_total?.converted ?? refStats.converted}</span>
                    <span className="ref-stat__lbl">купили PRO</span>
                  </div>
                  <div className="ref-stat">
                    <span className="ref-stat__val">{referralBalance} ₽</span>
                    <span className="ref-stat__lbl">баланс</span>
                  </div>
                  <div className="ref-stat">
                    <span className="ref-stat__val">{refStats.current_rate_percent}%</span>
                    <span className="ref-stat__lbl">текущий уровень</span>
                  </div>
                </div>
                <div className="ref-tier-note">
                  {refStats.referral_available
                    ? 'Реферальная ссылка активна. Баланс можно будет вывести на карту.'
                    : 'Нужен активный PRO. После включения тарифа здесь появится ссылка.'}
                </div>
              </>
            )}
            <button
              className="btn btn--primary btn--sm"
              onClick={() => setPage({ id: 'referrals' })}
            >
              Открыть реферальный кабинет
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
  isPro: boolean;
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

function ChannelCard({ channel, isPro, onAnalytics, onSettings, onInbox }: ChannelCardProps) {
  const commentsState = channel.comments_enabled ? 'Комментарии включены' : 'Комментарии выключены';

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

      <div className="channel-card__actions channel-card__actions--tiles">
        <button className="dashboard-action" onClick={onInbox}>
          <span className="dashboard-action__icon">📥</span>
          <span className="dashboard-action__body">
            <span className="dashboard-action__title">Входящие</span>
            <span className="dashboard-action__hint">Новые комментарии</span>
          </span>
          <span className="dashboard-action__arrow">→</span>
        </button>
        {isPro && (
          <button className="dashboard-action" onClick={onAnalytics}>
            <span className="dashboard-action__icon">📊</span>
            <span className="dashboard-action__body">
              <span className="dashboard-action__title">Аналитика</span>
              <span className="dashboard-action__hint">Посты и реакции</span>
            </span>
            <span className="dashboard-action__arrow">→</span>
          </button>
        )}
        <button className="dashboard-action dashboard-action--primary" onClick={onSettings}>
          <span className="dashboard-action__icon">⚙️</span>
          <span className="dashboard-action__body">
            <span className="dashboard-action__title">Настройки</span>
            <span className="dashboard-action__hint">{commentsState}</span>
          </span>
          <span className="dashboard-action__arrow">→</span>
        </button>
      </div>
    </div>
  );
}
