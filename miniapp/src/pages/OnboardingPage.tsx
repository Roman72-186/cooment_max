// Онбординг — мастер подключения канала для владельца
import { useState, useCallback } from 'react';
import { getUserMe, syncChannels } from '../api/backend';
import { useAppStore } from '../store/useAppStore';

type Step = 'welcome' | 'instruction' | 'checking' | 'success';

export function OnboardingPage() {
  const { setPage, setUser } = useAppStore();
  const [step, setStep] = useState<Step>('welcome');
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Проверяем — появился ли канал в БД (бот был добавлен как admin)
  const handleCheck = useCallback(async () => {
    setChecking(true);
    setNotFound(false);
    try {
      // Синхронизируем каналы с MAX API, потом проверяем
      await syncChannels();
      const user = await getUserMe();
      setUser(user);
      if (user.channels.length > 0) {
        setStep('success');
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setChecking(false);
    }
  }, [setUser]);

  const goToDashboard = useCallback(() => {
    setPage({ id: 'dashboard' });
  }, [setPage]);

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
              <li>Откройте бота и нажмите <strong>«Начать»</strong>:
                <div className="onboarding__bot-link">
                  <button
                    className="btn btn--ghost btn--xs"
                    onClick={() => (window as any).WebApp?.openLink('https://max.ru/id861708697380_2_bot')}
                  >
                    Открыть бота
                  </button>
                </div>
              </li>
              <li>Откройте настройки вашего канала → <strong>Администраторы</strong></li>
              <li>Добавьте бот как администратора</li>
              <li>Выдайте права: <em>читать, публиковать, редактировать</em></li>
              <li>Нажмите «Проверить» ниже</li>
            </ol>
            {notFound && (
              <div className="alert alert--error">
                Канал пока не найден. Убедитесь, что добавили бота как администратора.
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
