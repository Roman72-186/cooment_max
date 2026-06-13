// Онбординг — мастер подключения канала для владельца
import { useState, useCallback } from 'react';
import { getUserMe, syncChannels } from '../api/backend';
import { useAppStore } from '../store/useAppStore';

type Step = 'welcome' | 'instruction' | 'checking' | 'success';
const BOT_ID = 'id861708697380_2_bot';

export function OnboardingPage() {
  const { setPage, setUser, addToast } = useAppStore();
  const [step, setStep] = useState<Step>('welcome');
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [requiresPro, setRequiresPro] = useState(false);

  // Проверяем — появился ли канал в БД (бот был добавлен как admin)
  const handleCheck = useCallback(async () => {
    setChecking(true);
    setNotFound(false);
    setRequiresPro(false);
    try {
      // Синхронизируем каналы с MAX API, потом проверяем
      const syncResult = await syncChannels();
      const user = await getUserMe();
      setUser(user);
      if (user.channels.length > 0) {
        if (syncResult.requires_pro) {
          addToast({ type: 'warning', message: 'Первый канал подключён. Для 2 и более каналов нужен PRO' });
        }
        setStep('success');
      } else if (syncResult.requires_pro) {
        setRequiresPro(true);
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setChecking(false);
    }
  }, [addToast, setUser]);

  const goToDashboard = useCallback(() => {
    setPage({ id: 'dashboard' });
  }, [setPage]);

  const copyBotId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(BOT_ID);
      addToast({ type: 'success', message: 'ID бота скопирован' });
    } catch {
      addToast({ type: 'error', message: 'Не удалось скопировать ID' });
    }
  }, [addToast]);

  return (
    <div className="page page--center">
      <div className="onboarding">

        {step === 'welcome' && (
          <>
            <div className="onboarding__icon">💬</div>
            <h2 className="onboarding__title">Комментарии для MAX</h2>
            <p className="onboarding__text">
              Добавьте бота в свой канал — и каждый пост получит кнопку
              «Комментарии». Подписчики смогут общаться прямо в MAX.
            </p>
            <div className="onboarding__features">
              <div className="onboarding__feature">✓ Комментарии и ответы</div>
              <div className="onboarding__feature">✓ Реакции ❤️</div>
              <div className="onboarding__feature">✓ Модерация</div>
              <div className="onboarding__feature">✓ Аналитика</div>
            </div>
            <button className="btn btn--primary" onClick={() => setStep('instruction')}>
              Подключить канал
            </button>
            <div className="onboarding__legal">
              <span onClick={() => (window as any).WebApp?.openLink('https://sushi-house-39.online/legal/offer')}>
                Оферта
              </span>
              {' · '}
              <span onClick={() => (window as any).WebApp?.openLink('https://sushi-house-39.online/legal/privacy')}>
                Политика ПДн
              </span>
            </div>
          </>
        )}

        {step === 'instruction' && (
          <>
            <div className="onboarding__icon">📋</div>
            <h2 className="onboarding__title">Как подключить</h2>
            <ol className="onboarding__steps">
              <li>Скопируйте ID бота:
                <div className="onboarding__bot-link">
                  <span className="onboarding__bot-url">{BOT_ID}</span>
                  <button
                    className="btn btn--ghost btn--xs"
                    onClick={copyBotId}
                  >
                    Скопировать
                  </button>
                </div>
              </li>
              <li>Откройте ваш канал → <strong>Подписчики</strong> → добавьте бота по ID</li>
              <li>После этого откройте настройки канала → <strong>Администраторы</strong></li>
              <li>Добавьте этого бота как администратора</li>
              <li>Выдайте права: <em>читать, публиковать, редактировать</em></li>
              <li>Нажмите «Проверить» ниже</li>
            </ol>
            {notFound && (
              <div className="alert alert--error">
                Канал пока не найден. Убедитесь, что добавили бота как администратора.
              </div>
            )}
            {requiresPro && (
              <div className="alert alert--error">
                На бесплатном тарифе можно подключить 1 канал. Для подключения 2 и более каналов нужен активный тариф PRO.
              </div>
            )}
            <div className="onboarding__actions">
              <button
                className="btn btn--primary"
                onClick={handleCheck}
                disabled={checking}
              >
                {checking ? 'Проверяю...' : 'Проверить'}
              </button>
              <button className="btn btn--ghost" onClick={() => setStep('welcome')}>
                Назад
              </button>
              {requiresPro && (
                <button className="btn btn--ghost" onClick={() => setPage({ id: 'pricing' })}>
                  Оформить PRO
                </button>
              )}
            </div>
          </>
        )}

        {step === 'success' && (
          <>
            <div className="onboarding__icon">🎉</div>
            <h2 className="onboarding__title">Канал подключён!</h2>
            <p className="onboarding__text">
              Бот активирован. Теперь каждый новый пост в вашем канале
              получит кнопку «💬 Комментарии».
            </p>
            <button className="btn btn--primary" onClick={goToDashboard}>
              Перейти в панель управления
            </button>
          </>
        )}

      </div>
    </div>
  );
}
