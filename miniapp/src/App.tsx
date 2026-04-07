// Корневой компонент — маршрутизация по start_param
import { useEffect } from 'react';
import { getStartParam, notifyReady } from './bridge/maxBridge';
import { CommentsPage } from './pages/CommentsPage';

export function App() {
  useEffect(() => {
    notifyReady();
  }, []);

  const startParam = getStartParam();

  // start_param = "post_42" → CommentsPage с postId=42
  if (startParam?.startsWith('post_')) {
    const postId = parseInt(startParam.replace('post_', ''), 10);
    if (!isNaN(postId)) {
      return <CommentsPage postId={postId} />;
    }
  }

  // Пользователь открыл бота напрямую — онбординг (пока заглушка)
  return (
    <div className="page page--center">
      <div className="onboarding-stub">
        <div className="onboarding-icon">💬</div>
        <h2>Комментарии для MAX</h2>
        <p>Добавьте бота в свой канал как администратора, и ваши подписчики смогут оставлять комментарии к постам.</p>
      </div>
    </div>
  );
}
