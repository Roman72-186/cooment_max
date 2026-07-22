import { useEffect, useMemo, useState } from 'react';
import { getReferralStats, trackEvent, type ReferralStats } from '../api/backend';
import { shareReferralLink, showAlert } from '../bridge/maxBridge';
import { useAppStore } from '../store/useAppStore';

function formatRub(value: number): string {
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function ReferralPage() {
  const { setPage } = useAppStore();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getReferralStats()
      .then((data) => {
        if (!mounted) return;
        setStats(data);
      })
      .catch(() => {
        if (!mounted) return;
        setError('Не удалось загрузить реферальную статистику');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, []);

  const shareText = useMemo(
    () => 'Подключи комментарии к постам в MAX. По моей ссылке дадут +7 дней PRO после входа.',
    []
  );

  const handleShare = async () => {
    if (!stats?.ref_link || !stats.referral_available) return;
    trackEvent('referral_share_click');

    try {
      const result = await shareReferralLink(stats.ref_link, shareText);
      if (result === 'copied') showAlert('Ссылка скопирована. Можно отправить её пользователю.');
    } catch {
      showAlert('Не удалось открыть отправку. Скопируй ссылку вручную.');
    }
  };

  const handleCopy = async () => {
    if (!stats?.ref_link || !stats.referral_available) return;
    trackEvent('referral_copy_click');

    try {
      await navigator.clipboard.writeText(stats.ref_link);
      showAlert('Реферальная ссылка скопирована');
    } catch {
      showAlert('Не удалось скопировать ссылку');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-row">
          <button className="btn-back" onClick={() => setPage({ id: 'dashboard' })}>← Назад</button>
          <div>
            <h1 className="page-title">Рефералы</h1>
            <p className="page-subtitle">Ссылка, команда до 5 линии и баланс выплат</p>
          </div>
        </div>
      </header>

      <main className="page-content">
        {loading && (
          <div className="skeleton-list">
            <div className="skeleton-item" />
            <div className="skeleton-item" />
          </div>
        )}

        {!loading && error && (
          <div className="empty-state">
            <span className="empty-state__text">{error}</span>
            <button className="btn btn--primary" onClick={() => window.location.reload()}>
              Повторить
            </button>
          </div>
        )}

        {!loading && stats && !stats.referral_available && (
          <section className="referral-lock">
            <div className="referral-lock__badge">PRO</div>
            <h2>Реферальная программа доступна на PRO</h2>
            <p>
              Включи PRO, и здесь появятся ссылка для отправки, статистика команды и баланс.
              Накопленные деньги можно будет вывести на карту.
            </p>
            <button className="btn btn--primary" onClick={() => setPage({ id: 'pricing' })}>
              Купить PRO
            </button>
          </section>
        )}

        {!loading && stats?.referral_available && (
          <>
            <section className="referral-hero">
              <div>
                <span className="referral-hero__eyebrow">твоя ссылка</span>
                <h2>Приглашай владельцев каналов</h2>
                <p>
                  Приглашённый получает +7 дней PRO. За первую оплату ты получаешь +30 дней PRO,
                  за повторные оплаты начисляется комиссия.
                </p>
              </div>
              <div className="referral-hero__balance">
                <span>{formatRub(stats.balance_rub)} ₽</span>
                <small>можно вывести на карту</small>
              </div>
            </section>

            <section className="referral-link-panel">
              <span className="referral-link-panel__label">Ссылка для приглашения</span>
              <div className="referral-link-panel__value">{stats.ref_link}</div>
              <div className="referral-link-panel__actions">
                <button className="btn btn--primary" onClick={handleShare}>Отправить</button>
                <button className="btn btn--ghost" onClick={handleCopy}>Скопировать</button>
              </div>
            </section>

            <section className="referral-metrics-grid">
              <div className="ref-stat">
                <span className="ref-stat__val">{stats.invited}</span>
                <span className="ref-stat__lbl">прямых приглашений</span>
              </div>
              <div className="ref-stat">
                <span className="ref-stat__val">{stats.converted}</span>
                <span className="ref-stat__lbl">купили PRO</span>
              </div>
              <div className="ref-stat">
                <span className="ref-stat__val">{stats.days_earned}</span>
                <span className="ref-stat__lbl">дней PRO</span>
              </div>
              <div className="ref-stat">
                <span className="ref-stat__val">{stats.current_rate_percent}%</span>
                <span className="ref-stat__lbl">текущий уровень</span>
              </div>
            </section>

            <section className="referral-team">
              <div className="referral-team__header">
                <div>
                  <h2>Команда до 5 линии</h2>
                  <p>{stats.team_total.invited} участников, {stats.team_total.converted} оплатили PRO</p>
                </div>
                <strong>{formatRub(stats.team_total.earned_rub)} ₽</strong>
              </div>

              <div className="referral-team__levels">
                {stats.team_levels.map((level) => (
                  <div className="referral-team-row" key={level.level}>
                    <span className="referral-team-row__level">{level.level} линия</span>
                    <span>{level.invited} чел.</span>
                    <span>{level.converted} PRO</span>
                    <strong>{formatRub(level.earned_rub)} ₽</strong>
                  </div>
                ))}
              </div>
            </section>

            <details className="ref-guide referral-guide-page" open>
              <summary>Правила начислений</summary>
              <ol className="ref-guide__steps">
                <li>Реферальная ссылка активна только на PRO.</li>
                <li>За первую оплату приглашённого начисляется +30 дней PRO один раз.</li>
                <li>За повторные оплаты начисляется комиссия: 10%, 13%, 15% или 20%.</li>
                <li>Накопленные деньги можно вывести на карту после обработки заявки.</li>
              </ol>
              <div className="ref-guide__tiers">
                <span>10% до 5 платящих</span>
                <span>13% до 10</span>
                <span>15% до 20</span>
                <span>20% с 21-го</span>
              </div>
            </details>
          </>
        )}
      </main>
    </div>
  );
}
