// Главная страница — список комментариев к посту
// Открывается когда start_param = "post_<ID>"
import { useEffect, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getComments } from '../api/backend';
import { CommentThread } from '../components/CommentThread';
import { CommentInput } from '../components/CommentInput';
import { expand } from '../bridge/maxBridge';

interface Props {
  postId: number;
}

export function CommentsPage({ postId }: Props) {
  const { comments, loading, error, setComments, setLoading, setError } = useAppStore();

  const loadComments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getComments(postId);
      setComments(data);
    } catch (err) {
      setError('Не удалось загрузить комментарии');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [postId, setComments, setLoading, setError]);

  useEffect(() => {
    expand();
    loadComments();

    // Обновляем каждые 15 секунд
    const timer = setInterval(loadComments, 15000);
    return () => clearInterval(timer);
  }, [loadComments]);

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Комментарии</h1>
        {!loading && (
          <span className="comment-count">{comments.length}</span>
        )}
      </header>

      <main className="page-content">
        {loading && comments.length === 0 ? (
          <div className="skeleton-list">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton-item" />
            ))}
          </div>
        ) : error ? (
          <div className="error-state">
            <span>{error}</span>
            <button onClick={loadComments}>Повторить</button>
          </div>
        ) : (
          <CommentThread comments={comments} />
        )}
      </main>

      <footer className="page-footer">
        <CommentInput postId={postId} onSent={loadComments} />
      </footer>
    </div>
  );
}
