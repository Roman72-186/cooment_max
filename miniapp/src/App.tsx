// Корневой компонент — маршрутизация по start_param и внутреннему состоянию
import React, { useEffect } from 'react';
import { getStartParam, notifyReady } from './bridge/maxBridge';
import { getUserMe } from './api/backend';
import { useAppStore } from './store/useAppStore';
import { CommentsPage } from './pages/CommentsPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { ReferralPage } from './pages/ReferralPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PricingPage } from './pages/PricingPage';
import { AdminPage } from './pages/AdminPage';
import { InboxPage } from './pages/InboxPage';
import { ToastContainer } from './components/Toast';
import { ConfirmDialog } from './components/ConfirmDialog';

const SUPPORT_URL = 'https://max.ru/join/Vp56M4Z2mlT-Z1TFeHl9rQyOQ1SAq9aet9g9C-92owY';

function openSupportLink() {
  const webApp = (window as any).WebApp;
  if (webApp?.openLink) {
    webApp.openLink(SUPPORT_URL);
    return;
  }
  window.open(SUPPORT_URL, '_blank', 'noopener,noreferrer');
}

export function App() {
  const { page, setPage, setUser } = useAppStore();

  useEffect(() => {
    notifyReady();

    const startParam = getStartParam();

    // Быстрый путь: открыт пост с комментариями.
    // Формат: post_<id> или post_<id>_c_<commentId> (deep link на конкретный комментарий)
    if (startParam?.startsWith('post_')) {
      const match = startParam.match(/^post_(\d+)(?:_c_(\d+))?$/);
      if (match) {
        const postId = parseInt(match[1], 10);
        const highlightCommentId = match[2] ? parseInt(match[2], 10) : undefined;
        setPage({ id: 'comments', postId, highlightCommentId });
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

        if (startParam === 'referrals') {
          setPage({ id: 'referrals' });
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

        // inbox → агрегатор комментариев
        if (startParam === 'inbox') {
          setPage({ id: 'inbox' });
          return;
        }

        // Администратор — сразу в панель управления
        if (user.is_admin) {
          setPage({ id: 'admin' });
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
        // Не удалось загрузить юзера — показываем экран ошибки с кнопкой retry
        // (онбординг НЕ показываем — это может быть временный сбой при перезапуске backend)
        setPage({ id: 'error' });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Рендер по текущей странице
  let content: React.ReactNode;
  let showFooter = true;

  switch (page.id) {
    case 'loading':
      content = (
        <div className="page page--center">
          <div className="skeleton-list">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton-item" />)}
          </div>
        </div>
      );
      showFooter = false;
      break;

    case 'error':
      content = (
        <div className="page page--center" style={{ gap: 16, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
            Не удалось загрузить данные.<br />Возможно, сервис временно недоступен.
          </p>
          <button
            className="btn btn--primary"
            onClick={() => window.location.reload()}
            style={{ marginTop: 8 }}
          >
            Попробовать снова
          </button>
        </div>
      );
      showFooter = false;
      break;

    case 'comments':
      content = <CommentsPage postId={page.postId} highlightCommentId={page.highlightCommentId} />;
      showFooter = false;
      break;

    case 'admin':       content = <AdminPage />;                            break;
    case 'inbox':       content = <InboxPage channelId={page.channelId} channelName={page.channelName} />; break;
    case 'onboarding':  content = <OnboardingPage />;                      break;
    case 'dashboard':   content = <DashboardPage />;                       break;
    case 'referrals':   content = <ReferralPage />;                        break;
    case 'analytics':   content = <AnalyticsPage channelId={page.channelId} />; break;
    case 'settings':    content = <SettingsPage channelId={page.channelId} />;  break;
    case 'pricing':     content = <PricingPage />;                         break;
  }

  return (
    <>
      {content}
      {showFooter && (
        <footer style={{ padding: '12px 16px 20px', textAlign: 'center', fontSize: '12px', color: '#aaa' }}>
          <span
            style={{ color: '#aaa', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => (window as any).WebApp?.openLink('https://sushi-house-39.online/legal/offer')}
          >
            Оферта
          </span>
          {' · '}
          <span
            style={{ color: '#aaa', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => (window as any).WebApp?.openLink('https://sushi-house-39.online/legal/privacy')}
          >
            Политика ПДн
          </span>
        </footer>
      )}
      {/* На странице комментариев (открывается по кнопке «Комментарии») FAB поддержки скрыт */}
      {page.id !== 'comments' && (
        <button
          type="button"
          className="support-fab"
          onClick={openSupportLink}
          aria-label="Открыть поддержку"
          title="Поддержка"
        >
          <span className="support-fab__icon" aria-hidden="true">?</span>
          <span className="support-fab__text">Поддержка</span>
        </button>
      )}
      <ToastContainer />
      <ConfirmDialog />
    </>
  );
}
