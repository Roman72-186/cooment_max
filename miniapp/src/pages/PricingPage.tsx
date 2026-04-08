// Страница тарифов — FREE vs PRO, кнопка оплаты (архитектура готова)
import { useAppStore } from '../store/useAppStore';

const FREE_FEATURES = [
  'Комментарии на каналах',
  'Реакции ❤️ на комментарии',
  'Удаление своих комментариев',
  'До 3 каналов',
];

const PRO_FEATURES = [
  'Всё из FREE',
  'Неограниченное число каналов',
  'Аналитика (просмотры, вовлечённость)',
  'Топ постов по комментариям',
  'Стоп-слова (автомодерация)',
  'Приоритетная поддержка',
];

export function PricingPage() {
  const { user, setPage } = useAppStore();

  const isPro = user?.plan === 'pro' &&
    (!user.plan_expires || new Date(user.plan_expires) > new Date());

  const planExpiresStr = user?.plan_expires
    ? new Date(user.plan_expires).toLocaleDateString('ru-RU')
    : null;

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-row">
          <button className="btn-back" onClick={() => setPage({ id: 'dashboard' })}>
            ← Назад
          </button>
          <h1 className="page-title">Тарифы</h1>
        </div>
      </header>

      <main className="page-content">
        {/* Статус текущей подписки */}
        {isPro && (
          <div className="alert alert--success">
            У вас активна PRO подписка
            {planExpiresStr && ` до ${planExpiresStr}`}
          </div>
        )}

        <div className="pricing-grid">
          {/* FREE план */}
          <div className="pricing-card">
            <div className="pricing-card__header">
              <div className="pricing-card__name">FREE</div>
              <div className="pricing-card__price">0 ₽</div>
              <div className="pricing-card__period">навсегда</div>
            </div>
            <ul className="pricing-card__features">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="pricing-card__feature">✓ {f}</li>
              ))}
            </ul>
            {!isPro && (
              <div className="pricing-card__badge">Текущий план</div>
            )}
          </div>

          {/* PRO план */}
          <div className="pricing-card pricing-card--pro">
            <div className="pricing-card__header">
              <div className="pricing-card__name">PRO</div>
              <div className="pricing-card__price">299 ₽</div>
              <div className="pricing-card__period">в месяц</div>
            </div>
            <ul className="pricing-card__features">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="pricing-card__feature">✓ {f}</li>
              ))}
            </ul>
            {isPro ? (
              <div className="pricing-card__badge pricing-card__badge--active">
                Активна
                {planExpiresStr && ` до ${planExpiresStr}`}
              </div>
            ) : (
              <button
                className="btn btn--primary"
                onClick={() => {
                  // TODO: подключить ЮКасса — POST /api/payments/create
                  alert('Оплата откроется в ближайшее время');
                }}
              >
                Оформить PRO
              </button>
            )}
          </div>
        </div>

        {/* Реферальная программа */}
        <div className="ref-card">
          <div className="ref-card__title">🎁 Приведи друга — получи PRO</div>
          <div className="ref-card__desc">
            За каждого владельца канала, который оформит PRO по вашей ссылке,
            вы получаете <strong>+30 дней PRO бесплатно</strong>.
          </div>
          {user?.ref_code && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                const link = `https://max.ru/MaxCommentsBot?start=ref_${user.ref_code}`;
                navigator.clipboard.writeText(link);
              }}
            >
              Скопировать реферальную ссылку
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
