// Страница тарифов — FREE vs PRO, кнопка оплаты T-Bank
import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { createPayment, getPaymentConfig, trackEvent, validatePromoCode, type PromoValidation } from '../api/backend';

const FREE_FEATURES = [
  '1 канал',
  'Текстовые комментарии под постами',
  'Реакции на комментарии',
  'Удаление своих комментариев',
  'Базовая сводка по постам и комментариям',
];

const PRO_FEATURES = [
  'Всё из FREE',
  '2 и более каналов',
  'Фото и стикеры в комментариях',
  'Опросы и реакции под постами',
  'Уведомления владельцу о новых комментариях',
  'Аналитика просмотров и вовлечённости',
  'Топ постов по комментариям',
  'Стоп-слова и авто-модерация',
  'Реферальная программа и вывод на карту',
  'Приоритетная поддержка',
];

const PLAN_DIFFERENCES = [
  { label: 'Каналы', free: '1 канал', pro: '2 и более каналов' },
  { label: 'Комментарии', free: 'Только текст', pro: 'Текст, фото и стикеры' },
  { label: 'Вовлечение', free: 'Реакции на комментарии', pro: 'Опросы и реакции под постами' },
  { label: 'Модерация', free: 'Ручная', pro: 'Стоп-слова и авто-модерация' },
  { label: 'Аналитика', free: 'Базовая сводка', pro: 'Просмотры, вовлечённость и топ постов' },
  { label: 'Уведомления', free: 'Без уведомлений владельцу', pro: 'Уведомления о новых комментариях' },
  { label: 'Рефералка', free: 'Недоступна', pro: 'Доступна на активном PRO, вывод на карту' },
];

export function PricingPage() {
  const { user, setPage } = useAppStore();
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [proPrice, setProPrice] = useState(299);
  const [promoCode, setPromoCode] = useState('');
  const [promoResult, setPromoResult] = useState<PromoValidation | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);

  useEffect(() => {
    getPaymentConfig()
      .then(c => setProPrice(c.price))
      .catch(() => {});
  }, []);

  const handleApplyPromo = async () => {
    const code = promoCode.trim();
    if (!code) return;
    setPromoChecking(true);
    setPromoResult(null);
    try {
      const result = await validatePromoCode(code);
      setPromoResult(result);
    } catch {
      setPromoResult({ valid: false, error: 'Ошибка проверки кода' });
    } finally {
      setPromoChecking(false);
    }
  };

  const finalPrice = promoResult?.valid && promoResult.final_price != null
    ? promoResult.final_price
    : proPrice;

  const handlePay = async () => {
    setPaying(true);
    setPayError(null);
    try {
      const appliedCode = promoResult?.valid ? promoCode.trim() : undefined;
      trackEvent('pricing_pay_click', { price: finalPrice, promo_applied: Boolean(appliedCode) });
      const { payment_url } = await createPayment(appliedCode);
      // Открываем страницу T-Bank через MAX Bridge или браузер
      const tg = (window as any).WebApp;
      if (tg?.openLink) {
        tg.openLink(payment_url);
      } else {
        window.location.href = payment_url;
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Ошибка при создании платежа';
      setPayError(msg);
    } finally {
      setPaying(false);
    }
  };

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

        <div className="pricing-diff">
          <div className="pricing-diff__header">
            <div className="pricing-diff__eyebrow">Сравнение тарифов</div>
            <div className="pricing-diff__title">Чем PRO отличается от FREE</div>
          </div>
          <div className="pricing-diff__list">
            {PLAN_DIFFERENCES.map((item) => (
              <div className="pricing-diff__row" key={item.label}>
                <div className="pricing-diff__label">{item.label}</div>
                <div className="pricing-diff__plans">
                  <div className="pricing-diff__plan">
                    <span>FREE</span>
                    <strong>{item.free}</strong>
                  </div>
                  <div className="pricing-diff__plan pricing-diff__plan--pro">
                    <span>PRO</span>
                    <strong>{item.pro}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

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
              <div className="pricing-card__price">
                {promoResult?.valid ? (
                  <>
                    <span className="promo-price-original">{proPrice} ₽</span>{' '}
                    <span className="promo-price-final">{finalPrice} ₽</span>
                  </>
                ) : (
                  <>{proPrice} ₽</>
                )}
              </div>
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
              <>
                {/* Поле промо-кода */}
                <div className="promo-input-row">
                  <input
                    className="admin-settings__input promo-input--code"
                    placeholder="Промо-код"
                    value={promoCode}
                    onChange={e => {
                      setPromoCode(e.target.value.toUpperCase());
                      setPromoResult(null);
                    }}
                    onKeyDown={e => e.key === 'Enter' && handleApplyPromo()}
                  />
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={handleApplyPromo}
                    disabled={promoChecking || !promoCode.trim()}
                  >
                    {promoChecking ? '...' : 'Применить'}
                  </button>
                </div>
                {promoResult && (
                  promoResult.valid
                    ? <div className="promo-price-final promo-price-final--note">
                        Скидка {promoResult.discount_percent}% применена
                      </div>
                    : <div className="promo-error">{promoResult.error}</div>
                )}
                <button
                  className="btn btn--primary"
                  onClick={handlePay}
                  disabled={paying}
                >
                  {paying ? 'Открываю...' : `Оформить PRO — ${finalPrice} ₽`}
                </button>
                {payError && (
                  <div className="alert alert--error pricing-error">
                    {payError}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
