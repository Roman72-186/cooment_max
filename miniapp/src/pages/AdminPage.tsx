// Панель администратора — доступна только пользователям с is_admin = true
import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  adminGetUsers, adminGetChannels,
  adminUpdateUser, adminDeleteUser,
  adminToggleChannel, adminDeleteChannel,
  type AdminUser, type AdminChannel,
} from '../api/backend';

type Tab = 'users' | 'channels';

interface ConfirmState {
  message: string;
  onConfirm: () => void;
}

export function AdminPage() {
  const { setPage } = useAppStore();
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, c] = await Promise.all([adminGetUsers(), adminGetChannels()]);
      setUsers(u);
      setChannels(c);
    } catch {
      setActionError('Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const askConfirm = (message: string, onConfirm: () => void) => {
    setConfirm({ message, onConfirm });
  };

  const grantPro = async (userId: number) => {
    try {
      await adminUpdateUser(userId, { plan: 'pro', days: 30 });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, plan: 'pro' } : u));
    } catch { setActionError('Ошибка при выдаче PRO'); }
  };

  const removePro = async (userId: number) => {
    try {
      await adminUpdateUser(userId, { plan: 'free' });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, plan: 'free', plan_expires: null } : u));
    } catch { setActionError('Ошибка при снятии PRO'); }
  };

  const deleteUser = (userId: number, name: string | null) => {
    askConfirm(
      `Удалить пользователя «${name ?? userId}»? Все его каналы тоже удалятся.`,
      async () => {
        try {
          await adminDeleteUser(userId);
          setUsers(prev => prev.filter(u => u.id !== userId));
        } catch { setActionError('Ошибка при удалении пользователя'); }
      }
    );
  };

  const toggleChannel = async (ch: AdminChannel) => {
    try {
      await adminToggleChannel(ch.id, !ch.is_active);
      setChannels(prev => prev.map(c => c.id === ch.id ? { ...c, is_active: !c.is_active } : c));
    } catch { setActionError('Ошибка при изменении канала'); }
  };

  const deleteChannel = (channelId: number, name: string | null) => {
    askConfirm(
      `Удалить канал «${name ?? channelId}»?`,
      async () => {
        try {
          await adminDeleteChannel(channelId);
          setChannels(prev => prev.filter(c => c.id !== channelId));
        } catch { setActionError('Ошибка при удалении канала'); }
      }
    );
  };

  const totalUsers    = users.length;
  const totalChannels = channels.length;
  const totalPro      = users.filter(u => u.plan === 'pro').length;
  const totalComments = channels.reduce((s, c) => s + c.total_comments, 0);

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-row">
          <button className="btn-back" onClick={() => setPage({ id: 'dashboard' })}>← Назад</button>
          <h1 className="page-title">Администрирование</h1>
        </div>
      </header>

      <main className="page-content">

        {/* Диалог подтверждения */}
        {confirm && (
          <div className="confirm-overlay">
            <div className="confirm-dialog">
              <p className="confirm-dialog__msg">{confirm.message}</p>
              <div className="confirm-dialog__btns">
                <button
                  className="btn btn--primary"
                  style={{ background: 'var(--error)' }}
                  onClick={() => { confirm.onConfirm(); setConfirm(null); }}
                >
                  Удалить
                </button>
                <button className="btn btn--ghost" onClick={() => setConfirm(null)}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Глобальная статистика */}
        <div className="admin-stats">
          <div className="admin-stat">
            <span className="admin-stat__val">{totalUsers}</span>
            <span className="admin-stat__lbl">пользователей</span>
          </div>
          <div className="admin-stat">
            <span className="admin-stat__val">{totalChannels}</span>
            <span className="admin-stat__lbl">каналов</span>
          </div>
          <div className="admin-stat">
            <span className="admin-stat__val">{totalPro}</span>
            <span className="admin-stat__lbl">PRO</span>
          </div>
          <div className="admin-stat">
            <span className="admin-stat__val">{totalComments}</span>
            <span className="admin-stat__lbl">комментариев</span>
          </div>
        </div>

        {actionError && (
          <div className="alert alert--error" onClick={() => setActionError(null)}>
            {actionError}
          </div>
        )}

        {/* Табы */}
        <div className="admin-tabs">
          <button
            className={`admin-tab ${tab === 'users' ? 'admin-tab--active' : ''}`}
            onClick={() => setTab('users')}
          >
            Пользователи ({totalUsers})
          </button>
          <button
            className={`admin-tab ${tab === 'channels' ? 'admin-tab--active' : ''}`}
            onClick={() => setTab('channels')}
          >
            Каналы ({totalChannels})
          </button>
        </div>

        {loading ? (
          <div className="skeleton-list">
            {[1, 2, 3].map(i => <div key={i} className="skeleton-item" />)}
          </div>
        ) : tab === 'users' ? (
          <div className="admin-list">
            {users.map(u => (
              <div key={u.id} className="admin-card">
                <div className="admin-card__main">
                  <div className="admin-card__name">
                    {u.name ?? `#${u.max_user_id}`}
                    {u.is_admin && <span className="admin-badge admin-badge--admin">ADMIN</span>}
                  </div>
                  <div className="admin-card__meta">
                    ID {u.max_user_id} · {u.channel_count} кан. ·{' '}
                    <span className={u.plan === 'pro' ? 'admin-pro' : 'admin-free'}>
                      {u.plan.toUpperCase()}
                    </span>
                    {u.plan_expires && (
                      <> до {new Date(u.plan_expires).toLocaleDateString('ru-RU')}</>
                    )}
                  </div>
                </div>
                <div className="admin-card__actions">
                  {u.plan === 'pro'
                    ? <button className="btn btn--ghost btn--xs" onClick={() => removePro(u.id)}>Снять PRO</button>
                    : <button className="btn btn--ghost btn--xs" onClick={() => grantPro(u.id)}>+30 PRO</button>
                  }
                  <button
                    className="btn btn--xs admin-btn--danger"
                    onClick={() => deleteUser(u.id, u.name)}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-list">
            {channels.map(ch => (
              <div key={ch.id} className="admin-card">
                <div className="admin-card__main">
                  <div className="admin-card__name">
                    {ch.channel_name ?? ch.max_chat_id}
                    <span className={`admin-badge ${ch.is_active ? 'admin-badge--on' : 'admin-badge--off'}`}>
                      {ch.is_active ? 'активен' : 'выключен'}
                    </span>
                  </div>
                  <div className="admin-card__meta">
                    {ch.owner_name ?? `ID ${ch.owner_max_id}`} ·{' '}
                    {ch.post_count} постов · {ch.total_comments} комм.
                  </div>
                </div>
                <div className="admin-card__actions">
                  <button
                    className="btn btn--ghost btn--xs"
                    onClick={() => toggleChannel(ch)}
                  >
                    {ch.is_active ? 'Выключить' : 'Включить'}
                  </button>
                  <button
                    className="btn btn--xs admin-btn--danger"
                    onClick={() => deleteChannel(ch.id, ch.channel_name)}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
