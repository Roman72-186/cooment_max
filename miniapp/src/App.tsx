// Корневой компонент — маршрутизация по start_param и внутреннему состоянию
import { useEffect } from 'react';
import { getStartParam, notifyReady } from './bridge/maxBridge';
import { getUserMe } from './api/backend';
import { useAppStore } from './store/useAppStore';
import { CommentsPage } from './pages/CommentsPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PricingPage } from './pages/PricingPage';

export function App() {
  const { page, setPage, setUser } = useAppStore();

  useEffect(() => {
    notifyReady();

    const startParam = getStartParam();

    // Быстрый путь: открыт пост с комментариями — не нужно грузить юзера
    if (startParam?.startsWith('post_')) {
      const postId = parseInt(startParam.replace('post_', ''), 10);
      if (!isNaN(postId)) {
        setPage({ id: 'comments', postId });
        return;
      }
    }

    // Все остальные случаи — грузим пользователя и решаем что показать
    getUserMe()
      .then((user) => {
        setUser(user);

        if (startParam === 'pricing') {
          setPage({ id: 'pricing' });
          return;
        }

        // analytics_<channelId> → страница аналитики
        const analyticsMatch = startParam?.match(/^analytics_(\d+)$/);
        if (analyticsMatch) {
          setPage({ id: 'analytics', channelId: parseInt(analyticsMatch[1], 10) });
          return;
        }

        // settings_<channelId> → настройки канала
        const settingsMatch = startParam?.match(/^settings_(\d+)$/);
        if (settingsMatch) {
          setPage({ id: 'settings', channelId: parseInt(settingsMatch[1], 10) });
          return;
        }

        // Нет каналов — онбординг; есть — дашборд
        if (user.channels.length === 0) {
          setPage({ id: 'onboarding' });
        } else {
          setPage({ id: 'dashboard' });
        }
      })
      .catch(() => {
        // Не удалось загрузить юзера — показываем онбординг
        setPage({ id: 'onboarding' });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Рендер по текущей странице
  switch (page.id) {
    case 'loading':
      return (
        <div className="page page--center">
          <div className="skeleton-list">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton-item" />)}
          </div>
        </div>
      );

    case 'comments':
      return <CommentsPage postId={page.postId} />;

    case 'onboarding':
      return <OnboardingPage />;

    case 'dashboard':
      return <DashboardPage />;

    case 'analytics':
      return <AnalyticsPage channelId={page.channelId} />;

    case 'settings':
      return <SettingsPage channelId={page.channelId} />;

    case 'pricing':
      return <PricingPage />;
  }
}
