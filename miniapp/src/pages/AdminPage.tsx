// Панель администратора — доступна только пользователям с is_admin = true
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  adminGetUsers, adminGetChannels, adminGetPayments, adminGetPromoCodes,
  adminUpdateUser, adminDeleteUser,
  adminToggleChannel, adminDeleteChannel,
  adminGetSettings, adminUpdateSettings,
  adminCreatePromoCode, adminDeletePromoCode,
  type AdminUser, type AdminChannel, type AdminPayment, type PromoCode,
} from '../api/backend';

type Tab = 'users' | 'channels' | 'payments' | 'settings';

interface ConfirmState {
  message: string;
  onConfirm: () => void;
}

export function AdminPage() {
  const { setPage } = useAppStore();
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // Настройки
  const [settings, setSettings] = useState<{ pro_price_rub: number; pro_days: number } | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [daysInput, setDaysInput] = useState('');

  // Фильтры
  const [userSearch, setUserSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<'all' | 'free' | 'pro'>('all');
  const [channelSearch, setChannelSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Промо-коды — форма создания
  const [promoCode, setPromoCode] = useState('');
  const [promoDiscount, setPromoDiscount] = useState('20');
  const [promoMaxUses, setPromoMaxUses] = useState('');
  const [promoExpires, setPromoExpires] = useState('');
  const [promoCreating, setPromoCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, c, p, pc, s] = await Promise.all([
        adminGetUsers(),
        adminGetChannels(),
        adminGetPayments(),
        adminGetPromoCodes(),
        adminGetSettings(),
      ]);
      setUsers(u);
      setChannels(c);
      setPayments(p);
      setPromoCodes(pc);
      setSettings(s);
      setPriceInput(String(s.pro_price_rub));
      setDaysInput(String(s.pro_days));
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

  // ─── Настройки ───────────────────────────────────────────────────

  const saveSettings = async () => {
    const price = parseInt(priceInput, 10);
    const days  = parseInt(daysInput, 10);
    if (isNaN(price) || price < 1 || isNaN(days) || days < 1 || days > 365) {
      setActionError('Неверные значения');
      return;
    }
    setSettingsSaving(true);
    try {
      await adminUpdateSettings({ pro_price_rub: price, pro_days: days });
      setSettings({ pro_price_rub: price, pro_days: days });
    } catch {
      setActionError('Ошибка сохранения');
    } finally {
      setSettingsSaving(false);
    }
  };

  // ─── Пользователи ────────────────────────────────────────────────

  const grantPro = async (userId: number) => {
    const d = settings?.pro_days ?? 30;
    try {
      await adminUpdateUser(userId, { plan: 'pro', days: d });
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

  // ─── Каналы ──────────────────────────────────────────────────────

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

  // ─── Промо-коды ──────────────────────────────────────────────────

  const createPromo = async () => {
    const discount = parseInt(promoDiscount, 10);
    const maxUses  = promoMaxUses ? parseInt(promoMaxUses, 10) : null;
    if (!promoCode.trim()) { setActionError('Введите код'); return; }
    if (isNaN(discount) || discount < 1 || discount > 100) { setActionError('Скидка 1–100%'); return; }
    if (maxUses !== null && (isNaN(maxUses) || maxUses < 1)) { setActionError('Макс. использований > 0'); return; }

    setPromoCreating(true);
    try {
      const created = await adminCreatePromoCode({
        code: promoCode.trim(),
        discount_percent: discount,
        max_uses: maxUses,
        expires_at: promoExpires || null,
      });
      setPromoCodes(prev => [created, ...prev]);
      setPromoCode('');
      setPromoDiscount('20');
      setPromoMaxUses('');
      setPromoExpires('');
    } catch (err: any) {
      setActionError(err?.response?.data?.error ?? 'Ошибка создания кода');
    } finally {
      setPromoCreating(false);
    }
  };

  const deletePromo = (code: string) => {
    askConfirm(`Удалить промо-код «${code}»?`, async () => {
      try {
        await adminDeletePromoCode(code);
        setPromoCodes(prev => prev.filter(p => p.code !== code));
      } catch { setActionError('Ошибка удаления промо-кода'); }
    });
  };

  // ─── Вычисляемые значения ─────────────────────────────────────────

  const totalUsers    = users.length;
  const totalChannels = channels.length;
  const totalPro      = users.filter(u => u.plan === 'pro').length;
  const totalRevenue  = payments
    .filter(p => p.status === 'succeeded')
    .reduce((s, p) => s + Number(p.amount_rub), 0);

  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase();
    return users.filter(u => {
      const matchSearch = !q ||
        (u.name ?? '').toLowerCase().includes(q) ||
        String(u.max_user_id).includes(q);
      const matchPlan = planFilter === 'all' || u.plan === planFilter;
      return matchSearch && matchPlan;
    });
  }, [users, userSearch, planFilter]);

  const filteredChannels = useMemo(() => {
    const q = channelSearch.toLowerCase();
    return channels.filter(ch => {
      const matchSearch = !q ||
        (ch.channel_name ?? '').toLowerCase().includes(q) ||
        (ch.owner_name ?? '').toLowerCase().includes(q);
      const matchFilter =
        channelFilter === 'all' ||
        (channelFilter === 'active' && ch.is_active) ||
        (channelFilter === 'inactive' && !ch.is_active);
      return matchSearch && matchFilter;
    });
  }, [channels, channelSearch, channelFilter]);

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
            <span className="admin-stat__val">{totalRevenue} ₽</span>
            <span className="admin-stat__lbl">выручка</span>
          </div>
        </div>

        {actionError && (
          <div className="alert alert--error" onClick={() => setActionError(null)}>
            {actionError}
          </div>
        )}

        {/* Табы */}
        <div className="admin-tabs">
          <button className={`admin-tab ${tab === 'users' ? 'admin-tab--active' : ''}`} onClick={() => setTab('users')}>
            Пользователи ({totalUsers})
          </button>
          <button className={`admin-tab ${tab === 'channels' ? 'admin-tab--active' : ''}`} onClick={() => setTab('channels')}>
            Каналы ({totalChannels})
          </button>
          <button className={`admin-tab ${tab === 'payments' ? 'admin-tab--active' : ''}`} onClick={() => setTab('payments')}>
            Платежи
          </button>
          <button className={`admin-tab ${tab === 'settings' ? 'admin-tab--active' : ''}`} onClick={() => setTab('settings')}>
            Настройки
          </button>
        </div>

        {loading ? (
          <div className="skeleton-list">
            {[1, 2, 3].map(i => <div key={i} className="skeleton-item" />)}
          </div>

        ) : tab === 'users' ? (
          <>
            <div className="admin-filter-row">
              <input
                className="admin-filter-input"
                placeholder="Поиск по имени или ID..."
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
              />
              <select className="admin-filter-select" value={planFilter} onChange={e => setPlanFilter(e.target.value as any)}>
                <option value="all">Все</option>
                <option value="free">FREE</option>
                <option value="pro">PRO</option>
              </select>
            </div>
            <div className="admin-list">
              {filteredUsers.map(u => (
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
                      : <button className="btn btn--ghost btn--xs" onClick={() => grantPro(u.id)}>+{settings?.pro_days ?? 30} PRO</button>
                    }
                    <button className="btn btn--xs admin-btn--danger" onClick={() => deleteUser(u.id, u.name)}>
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
              {filteredUsers.length === 0 && (
                <div className="empty-state"><span>Ничего не найдено</span></div>
              )}
            </div>
          </>

        ) : tab === 'channels' ? (
          <>
            <div className="admin-filter-row">
              <input
                className="admin-filter-input"
                placeholder="Поиск по названию или владельцу..."
                value={channelSearch}
                onChange={e => setChannelSearch(e.target.value)}
              />
              <select className="admin-filter-select" value={channelFilter} onChange={e => setChannelFilter(e.target.value as any)}>
                <option value="all">Все</option>
                <option value="active">Активные</option>
                <option value="inactive">Выключенные</option>
              </select>
            </div>
            <div className="admin-list">
              {filteredChannels.map(ch => (
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
                    <button className="btn btn--ghost btn--xs" onClick={() => toggleChannel(ch)}>
                      {ch.is_active ? 'Выключить' : 'Включить'}
                    </button>
                    <button className="btn btn--xs admin-btn--danger" onClick={() => deleteChannel(ch.id, ch.channel_name)}>
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
              {filteredChannels.length === 0 && (
                <div className="empty-state"><span>Ничего не найдено</span></div>
              )}
            </div>
          </>

        ) : tab === 'payments' ? (
          <>
            <div className="admin-stats" style={{ marginBottom: 16 }}>
              <div className="admin-stat">
                <span className="admin-stat__val">{payments.filter(p => p.status === 'succeeded').length}</span>
                <span className="admin-stat__lbl">оплачено</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat__val">{totalRevenue} ₽</span>
                <span className="admin-stat__lbl">выручка</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat__val">{payments.filter(p => p.status === 'pending').length}</span>
                <span className="admin-stat__lbl">ожидают</span>
              </div>
            </div>
            {payments.length === 0 ? (
              <div className="empty-state"><span>Нет платежей</span></div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="payment-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: 12 }}>Пользователь</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: 12 }}>Сумма</th>
                      <th style={{ padding: '8px 6px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: 12 }}>Промо</th>
                      <th style={{ padding: '8px 6px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: 12 }}>Статус</th>
                      <th style={{ padding: '8px 6px', color: 'var(--text-secondary)', fontWeight: 500, fontSize: 12 }}>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id} className="payment-row">
                        <td style={{ padding: '10px 6px', fontSize: 13 }}>
                          {p.user_name ?? `ID ${p.max_user_id}`}
                        </td>
                        <td style={{ padding: '10px 6px', fontSize: 13, textAlign: 'right' }}>
                          {Number(p.amount_rub)} ₽
                          {p.discount_percent && (
                            <span style={{ color: '#4ade80', fontSize: 11, marginLeft: 4 }}>-{p.discount_percent}%</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 6px', fontSize: 12, fontFamily: 'monospace' }}>
                          {p.promo_code ?? '—'}
                        </td>
                        <td style={{ padding: '10px 6px' }}>
                          <span className={`payment-status--${p.status}`} style={{ fontSize: 12 }}>
                            {p.status === 'succeeded' ? 'оплачен' : p.status === 'pending' ? 'ожидает' : 'отменён'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 6px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {new Date(p.created_at).toLocaleDateString('ru-RU')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>

        ) : (
          // Settings tab
          <div className="admin-settings">
            {/* Цена и длительность */}
            <div className="admin-settings__row">
              <label className="admin-settings__label">Цена PRO (₽/мес)</label>
              <input
                className="admin-settings__input"
                type="number"
                min="1"
                value={priceInput}
                onChange={e => setPriceInput(e.target.value)}
              />
            </div>
            <div className="admin-settings__row">
              <label className="admin-settings__label">Длительность PRO (дней)</label>
              <input
                className="admin-settings__input"
                type="number"
                min="1"
                max="365"
                value={daysInput}
                onChange={e => setDaysInput(e.target.value)}
              />
            </div>
            <button className="btn btn--primary" onClick={saveSettings} disabled={settingsSaving}>
              {settingsSaving ? 'Сохраняю...' : 'Сохранить'}
            </button>
            {settings && (
              <div className="admin-settings__hint">
                Текущие: {settings.pro_price_rub} ₽ / {settings.pro_days} дней
              </div>
            )}

            {/* Промо-коды */}
            <div style={{ marginTop: 24, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 20 }}>
              <div className="admin-settings__label" style={{ fontSize: 14, marginBottom: 12, color: 'var(--text-primary)' }}>
                Промо-коды
              </div>

              {/* Форма создания */}
              <div className="promo-form">
                <div className="promo-input-row">
                  <input
                    className="admin-settings__input"
                    placeholder="Код (напр. SUMMER20)"
                    value={promoCode}
                    onChange={e => setPromoCode(e.target.value.toUpperCase())}
                    style={{ flex: 2 }}
                  />
                  <input
                    className="admin-settings__input"
                    type="number"
                    min="1"
                    max="100"
                    placeholder="Скидка %"
                    value={promoDiscount}
                    onChange={e => setPromoDiscount(e.target.value)}
                    style={{ flex: 1 }}
                  />
                </div>
                <div className="promo-input-row">
                  <input
                    className="admin-settings__input"
                    type="number"
                    min="1"
                    placeholder="Макс. использований (пусто = ∞)"
                    value={promoMaxUses}
                    onChange={e => setPromoMaxUses(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <input
                    className="admin-settings__input"
                    type="date"
                    placeholder="Действует до"
                    value={promoExpires}
                    onChange={e => setPromoExpires(e.target.value)}
                    style={{ flex: 1 }}
                  />
                </div>
                <button className="btn btn--ghost" onClick={createPromo} disabled={promoCreating}>
                  {promoCreating ? 'Создаю...' : '+ Создать промо-код'}
                </button>
              </div>

              {/* Список кодов */}
              <div className="promo-list">
                {promoCodes.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>
                    Нет промо-кодов
                  </div>
                )}
                {promoCodes.map(p => (
                  <div key={p.code} className="promo-row">
                    <span className="promo-code-tag">{p.code}</span>
                    <span style={{ fontSize: 12, color: '#4ade80' }}>-{p.discount_percent}%</span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {p.used_count}/{p.max_uses ?? '∞'}
                    </span>
                    {p.expires_at && (
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        до {new Date(p.expires_at).toLocaleDateString('ru-RU')}
                      </span>
                    )}
                    <button
                      className="btn btn--xs admin-btn--danger"
                      onClick={() => deletePromo(p.code)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
