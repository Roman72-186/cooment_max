// Аналитика канала — графики, топ постов, engagement rate
import { useEffect, useState, useCallback } from 'react';
import { getChannelAnalytics, type AnalyticsSummary } from '../api/backend';
import { useAppStore } from '../store/useAppStore';

interface Props {
  channelId: number;
}

type Period = 7 | 30 | 90;

export function AnalyticsPage({ channelId }: Props) {
  const { user, setPage } = useAppStore();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [period, setPeriod] = useState<Period>(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const channel = user?.channels.find((c) => c.id === channelId);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getChannelAnalytics(channelId, period);
      setData(result);
    } catch {
      setError('Не удалось загрузить аналитику');
    } finally {
      setLoading(false);
    }
  }, [channelId, period]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-row">
          <button className="btn-back" onClick={() => setPage({ id: 'dashboard' })}>
            ← Назад
          </button>
          <h1 className="page-title">
            {channel?.channel_name ?? 'Аналитика'}
          </h1>
        </div>

        {/* Переключатель периода */}
        <div className="period-tabs">
          {([7, 30, 90] as Period[]).map((p) => (
            <button
              key={p}
              className={`period-tab ${period === p ? 'period-tab--active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {p} дн.
            </button>
          ))}
        </div>
      </header>

      <main className="page-content">
        {loading ? (
          <div className="skeleton-list">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton-item" />)}
          </div>
        ) : error ? (
          <div className="error-state">
            <span>{error}</span>
            <button onClick={load}>Повторить</button>
          </div>
        ) : data ? (
          <>
            {/* Сводные метрики */}
            <div className="metrics-grid">
              <MetricCard label="Просмотры"    value={data.total_views} />
              <MetricCard label="Комментарии"  value={data.total_comments} />
              <MetricCard label="Реакции"      value={data.total_reactions} />
              <MetricCard
                label="Вовлечённость"
                value={`${data.engagement_rate}%`}
              />
            </div>

            {/* График комментариев по дням */}
            <div className="chart-block">
              <div className="chart-block__title">Комментарии по дням</div>
              {data.days.length > 0 ? (
                <BarChart
                  data={data.days.map((d) => ({ label: formatDate(d.date), value: d.comments }))}
                />
              ) : (
                <div className="chart-empty">Нет данных за период</div>
              )}
            </div>

            {/* График просмотров */}
            {data.total_views > 0 && (
              <div className="chart-block">
                <div className="chart-block__title">Просмотры по дням</div>
                <BarChart
                  data={data.days.map((d) => ({ label: formatDate(d.date), value: d.views }))}
                  color="var(--accent-secondary)"
                />
              </div>
            )}

            {/* Топ-5 постов */}
            {data.top_posts.length > 0 && (
              <div className="chart-block">
                <div className="chart-block__title">Топ постов по комментариям</div>
                <div className="top-posts">
                  {data.top_posts.map((post, i) => (
                    <div key={post.id} className="top-post">
                      <span className="top-post__rank">#{i + 1}</span>
                      <span className="top-post__preview">
                        {post.text_preview?.slice(0, 60) ?? '(без текста)'}…
                      </span>
                      <span className="top-post__count">
                        💬 {post.comment_count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}

// ─── Компоненты ──────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric-card">
      <div className="metric-card__value">{value}</div>
      <div className="metric-card__label">{label}</div>
    </div>
  );
}

interface BarChartProps {
  data: { label: string; value: number }[];
  color?: string;
}

function BarChart({ data, color = 'var(--accent)' }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="bar-chart">
      {data.map((d, i) => (
        <div key={i} className="bar-chart__col">
          <div
            className="bar-chart__bar"
            style={{
              height: `${Math.max((d.value / max) * 100, d.value > 0 ? 4 : 0)}%`,
              background: color,
            }}
            title={`${d.label}: ${d.value}`}
          />
          <div className="bar-chart__label">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
