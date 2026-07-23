// Панель администратора — доступна только пользователям с is_admin = true
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  adminGetUsers, adminGetChannels, adminGetPayments, adminGetPromoCodes,
  adminUpdateUser, adminDeleteUser,
  adminToggleChannel, adminDeleteChannel,
  adminGetSettings, adminUpdateSettings,
  adminCreatePromoCode, adminDeletePromoCode,
  adminGetReferralStats, adminAdjustReferralBalance,
  adminGetAcquisitionStats, adminGetEvents,
  type AdminUser, type AdminChannel, type AdminPayment, type PromoCode,
  type AdminReferralStats, type AdminReferralReferrer,
  type AdminAcquisitionStats, type AdminEventsStats,
} from '../api/backend';

type Tab = 'users' | 'channels' | 'payments' | 'referrals' | 'analytics' | 'settings';

const ACQUISITION_LABELS: Record<string, string> = {
  referral: 'Реферальная ссылка',
  channel:  'Кнопка под постом канала',
  utm:      'Внешняя реклама (UTM)',
  notify:   'Кнопка уведомления',
  direct:   'Прямой заход (/start или без метки)',
  unknown:  'Не определено',
};

const ADMIN_PAGE_SIZE = 10;

export function AdminPage() {
  const { setPage } = useAppStore();
  const addToast = useAppStore((s) => s.addToast);
  const requestConfirm = useAppStore((s) => s.requestConfirm);
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [referralStats, setReferralStats] = useState<AdminReferralStats | null>(null);
  const [acquisitionStats, setAcquisitionStats] = useState<AdminAcquisitionStats | null>(null);
  const [eventsStats, setEventsStats] = useState<AdminEventsStats | null>(null);
  const [eventsDays, setEventsDays] = useState<7 | 30 | 90>(30);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Блокировка повторного тапа для точечных действий (выдача/снятие PRO, вкл/выкл канала)
  const [pendingUserIds, setPendingUserIds] = useState<Set<number>>(new Set());
  const [pendingChannelIds, setPendingChannelIds] = useState<Set<number>>(new Set());

  // Настройки
  const [settings, setSettings] = useState<{ pro_price_rub: number; pro_days: number } | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [daysInput, setDaysInput] = useState('');

  // Фильтры
  const [userSearch, setUserSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<'all' | 'free' | 'pro'>('all');
  const [dialogFilter, setDialogFilter] = useState<'all' | 'has' | 'none'>('all');
  const [channelSearch, setChannelSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [referralSearch, setReferralSearch] = useState('');

  // Пагинация
  const [usersVisible, setUsersVisible] = useState(ADMIN_PAGE_SIZE);
  const [channelsVisible, setChannelsVisible] = useState(ADMIN_PAGE_SIZE);

  // Refs для IntersectionObserver
  const usersEndRef = useRef<HTMLDivElement>(null);
  const channelsEndRef = useRef<HTMLDivElement>(null);

  // Промо-коды — форма создания
  const [promoCode, setPromoCode] = useState('');
  const [promoDiscount, setPromoDiscount] = useState('20');
  const [promoMaxUses, setPromoMaxUses] = useState('');
  const [promoExpires, setPromoExpires] = useState('');
  const [promoCreating, setPromoCreating] = useState(false);

  // Реферальный баланс — ручные корректировки
  const [adjustingReferralId, setAdjustingReferralId] = useState<number | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [u, c, p, pc, s, r, a, e] = await Promise.all([
        adminGetUsers(),
        adminGetChannels(),
        adminGetPayments(),
        adminGetPromoCodes(),
        adminGetSettings(),
        adminGetReferralStats(),
        adminGetAcquisitionStats(),
        adminGetEvents(30),
      ]);
      setUsers(u);
      setChannels(c);
      setPayments(p);
      setPromoCodes(pc);
      setSettings(s);
      setReferralStats(r);
      setAcquisitionStats(a);
      setEventsStats(e);
      setPriceInput(String(s.pro_price_rub));
      setDaysInput(String(s.pro_days));
    } catch {
      addToast({ type: 'error', message: 'Не удалось загрузить данные' });
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Перезагружаем только события при смене периода (не дёргаем весь дашборд).
  // На первом монтировании дублирует запрос из load() — не критично, данные лёгкие.
  useEffect(() => {
    adminGetEvents(eventsDays).then(setEventsStats).catch(() => {});
  }, [eventsDays]);

  // Сбрасываем пагинацию при изменении фильтров пользователей
  useEffect(() => {
    setUsersVisible(ADMIN_PAGE_SIZE);
  }, [userSearch, planFilter]);

  // Сбрасываем пагинацию при изменении фильтров каналов
  useEffect(() => {
    setChannelsVisible(ADMIN_PAGE_SIZE);
  }, [channelSearch, channelFilter]);


  // ─── Настройки ───────────────────────────────────────────────────

  const saveSettings = async () => {
    const price = parseInt(priceInput, 10);
    const days  = parseInt(daysInput, 10);
    if (isNaN(price) || price < 1 || isNaN(days) || days < 1 || days > 365) {
      addToast({ type: 'error', message: 'Неверные значения' });
      return;
    }
    setSettingsSaving(true);
    try {
      await adminUpdateSettings({ pro_price_rub: price, pro_days: days });
      setSettings({ pro_price_rub: price, pro_days: days });
      addToast({ type: 'success', message: 'Настройки сохранены' });
    } catch {
      addToast({ type: 'error', message: 'Ошибка сохранения' });
    } finally {
      setSettingsSaving(false);
    }
  };

  // ─── Пользователи ────────────────────────────────────────────────

  // Оборачивает точечное действие над пользователем — блокирует повторный тап на время запроса
  const withPendingUser = async (userId: number, fn: () => Promise<void>) => {
    setPendingUserIds(prev => new Set(prev).add(userId));
    try {
      await fn();
    } finally {
      setPendingUserIds(prev => { const next = new Set(prev); next.delete(userId); return next; });
    }
  };

  const grantPro = (userId: number) => withPendingUser(userId, async () => {
    const d = settings?.pro_days ?? 30;
    try {
      await adminUpdateUser(userId, { plan: 'pro', days: d });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, plan: 'pro' } : u));
    } catch { addToast({ type: 'error', message: 'Ошибка при выдаче PRO' }); }
  });

  const removePro = (userId: number, name: string | null) => {
    requestConfirm({
      message: `Снять PRO у «${name ?? userId}»? Доступ к платным функциям пропадёт немедленно.`,
      variant: 'danger',
      confirmLabel: 'Снять PRO',
      onConfirm: () => withPendingUser(userId, async () => {
        try {
          await adminUpdateUser(userId, { plan: 'free' });
          setUsers(prev => prev.map(u => u.id === userId ? { ...u, plan: 'free', plan_expires: null } : u));
        } catch { addToast({ type: 'error', message: 'Ошибка при снятии PRO' }); }
      }),
    });
  };

  const deleteUser = (userId: number, name: string | null) => {
    requestConfirm({
      message: `Удалить пользователя «${name ?? userId}»? Все его каналы тоже удалятся.`,
      variant: 'danger',
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        try {
          await adminDeleteUser(userId);
          setUsers(prev => prev.filter(u => u.id !== userId));
        } catch { addToast({ type: 'error', message: 'Ошибка при удалении пользователя' }); }
      }
    });
  };

  // ─── Каналы ──────────────────────────────────────────────────────

  const toggleChannel = async (ch: AdminChannel) => {
    setPendingChannelIds(prev => new Set(prev).add(ch.id));
    try {
      await adminToggleChannel(ch.id, !ch.is_active);
      setChannels(prev => prev.map(c => c.id === ch.id ? { ...c, is_active: !c.is_active } : c));
    } catch {
      addToast({ type: 'error', message: 'Ошибка при изменении канала' });
    } finally {
      setPendingChannelIds(prev => { const next = new Set(prev); next.delete(ch.id); return next; });
    }
  };

  const deleteChannel = (channelId: number, name: string | null) => {
    requestConfirm({
      message: `Удалить канал «${name ?? channelId}»?`,
      variant: 'danger',
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        try {
          await adminDeleteChannel(channelId);
          setChannels(prev => prev.filter(c => c.id !== channelId));
        } catch { addToast({ type: 'error', message: 'Ошибка при удалении канала' }); }
      }
    });
  };

  // ─── Промо-коды ──────────────────────────────────────────────────

  const createPromo = async () => {
    const discount = parseInt(promoDiscount, 10);
    const maxUses  = promoMaxUses ? parseInt(promoMaxUses, 10) : null;
    if (!promoCode.trim()) { addToast({ type: 'error', message: 'Введите код' }); return; }
    if (isNaN(discount) || discount < 1 || discount > 100) { addToast({ type: 'error', message: 'Скидка 1–100%' }); return; }
    if (maxUses !== null && (isNaN(maxUses) || maxUses < 1)) { addToast({ type: 'error', message: 'Макс. использований > 0' }); return; }

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
      addToast({ type: 'success', message: 'Промо-код создан' });
    } catch (err: any) {
      addToast({ type: 'error', message: err?.response?.data?.error ?? 'Ошибка создания кода' });
    } finally {
      setPromoCreating(false);
    }
  };

  const deletePromo = (code: string) => {
    requestConfirm({
      message: `Удалить промо-код «${code}»?`,
      variant: 'danger',
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        try {
          await adminDeletePromoCode(code);
          setPromoCodes(prev => prev.filter(p => p.code !== code));
        } catch { addToast({ type: 'error', message: 'Ошибка удаления промо-кода' }); }
      }
    });
  };

  // ─── Рефералы ──────────────────────────────────────────────────

  const formatRub = (value: number) => value.toLocaleString('ru-RU', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

  const startAdjustReferral = (referrer: AdminReferralReferrer, mode: 'add' | 'subtract') => {
    setAdjustingReferralId(referrer.id);
    setAdjustAmount(mode === 'add' ? '' : '-');
    setAdjustReason('');
  };

  const cancelAdjustReferral = () => {
    setAdjustingReferralId(null);
    setAdjustAmount('');
    setAdjustReason('');
  };

  const saveReferralAdjustment = (referrerId: number, referrerName: string | null) => {
    const normalizedAmount = Number(adjustAmount.replace(',', '.'));
    if (!Number.isFinite(normalizedAmount) || normalizedAmount === 0) {
      addToast({ type: 'error', message: 'Введите сумму со знаком' });
      return;
    }
    if (!adjustReason.trim()) {
      addToast({ type: 'error', message: 'Укажите причину' });
      return;
    }

    const amount = normalizedAmount;
    const reason = adjustReason.trim();
    const isCredit = amount > 0;

    requestConfirm({
      message: `${isCredit ? 'Начислить' : 'Списать'} ${formatRub(Math.abs(amount))} ₽ ${isCredit ? 'на баланс' : 'с баланса'} «${referrerName ?? referrerId}»? Причина: ${reason}`,
      variant: isCredit ? 'default' : 'danger',
      confirmLabel: isCredit ? 'Начислить' : 'Списать',
      onConfirm: async () => {
        setAdjustSaving(true);
        try {
          await adminAdjustReferralBalance(referrerId, { amount_rub: amount, reason });
          const updated = await adminGetReferralStats();
          setReferralStats(updated);
          cancelAdjustReferral();
          addToast({ type: 'success', message: isCredit ? 'Баллы начислены' : 'Баллы списаны' });
        } catch (err: any) {
          addToast({ type: 'error', message: err?.response?.data?.error ?? 'Ошибка корректировки баланса' });
        } finally {
          setAdjustSaving(false);
        }
      },
    });
  };

  // ─── Вычисляемые значения ─────────────────────────────────────────

  const totalUsers    = users.length;
  const totalChannels = channels.length;
  const totalPro      = users.filter(u => u.plan === 'pro').length;
  const totalRevenue  = payments
    .filter(p => p.status === 'succeeded')
    .reduce((s, p) => s + Number(p.amount_rub), 0);

  const formatDateTime = (value: string | null | undefined) => {
    if (!value) return '—';
    return new Date(value).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const openAdminChannelLink = (url: string) => {
    const webApp = (window as any).WebApp;
    if (webApp && typeof webApp.openLink === 'function') {
      webApp.openLink(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase();
    return users
      .filter(u => {
        const matchSearch = !q ||
          (u.name ?? '').toLowerCase().includes(q) ||
          (u.username ?? '').toLowerCase().includes(q) ||
          String(u.max_user_id).includes(q);
        const matchPlan = planFilter === 'all' || u.plan === planFilter;
        const hasDialog = !!u.bot_dialog_started_at;
        const matchDialog = dialogFilter === 'all' || (dialogFilter === 'has' ? hasDialog : !hasDialog);
        return matchSearch && matchPlan && matchDialog;
      })
      // Сортировка: сначала PRO, потом FREE; внутри группы — сначала с открытым диалогом
      .sort((a, b) => {
        if (a.plan !== b.plan) return a.plan === 'pro' ? -1 : 1;
        const aDialog = !!a.bot_dialog_started_at;
        const bDialog = !!b.bot_dialog_started_at;
        if (aDialog !== bDialog) return aDialog ? -1 : 1;
        return 0;
      });
  }, [users, userSearch, planFilter, dialogFilter]);

  const filteredChannels = useMemo(() => {
    const q = channelSearch.toLowerCase();
    return channels.filter(ch => {
      const matchSearch = !q ||
        (ch.channel_name ?? '').toLowerCase().includes(q) ||
        (ch.owner_name ?? '').toLowerCase().includes(q) ||
        String(ch.max_chat_id).toLowerCase().includes(q) ||
        String(ch.owner_max_id ?? '').includes(q);
      const matchFilter =
        channelFilter === 'all' ||
        (channelFilter === 'active' && ch.is_active) ||
        (channelFilter === 'inactive' && !ch.is_active);
      return matchSearch && matchFilter;
    });
  }, [channels, channelSearch, channelFilter]);

  const filteredReferrals = useMemo(() => {
    const q = referralSearch.toLowerCase();
    return (referralStats?.referrers ?? []).filter((r) => {
      if (!q) return true;
      return (
        (r.name ?? '').toLowerCase().includes(q) ||
        (r.username ?? '').toLowerCase().includes(q) ||
        String(r.max_user_id).includes(q) ||
        (r.ref_code ?? '').toLowerCase().includes(q)
      );
    });
  }, [referralStats, referralSearch]);

  // IntersectionObserver для автозагрузки пользователей
  useEffect(() => {
    if (!usersEndRef.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && usersVisible < filteredUsers.length) {
          setUsersVisible((c) => c + ADMIN_PAGE_SIZE);
        }
      },
      { threshold: 0.1 }
    );
    obs.observe(usersEndRef.current);
    return () => obs.disconnect();
  }, [usersVisible, filteredUsers.length]);

  // IntersectionObserver для автозагрузки каналов
  useEffect(() => {
    if (!channelsEndRef.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && channelsVisible < filteredChannels.length) {
          setChannelsVisible((c) => c + ADMIN_PAGE_SIZE);
        }
      },
      { threshold: 0.1 }
    );
    obs.observe(channelsEndRef.current);
    return () => obs.disconnect();
  }, [channelsVisible, filteredChannels.length]);

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-row">
          <button className="btn-back" onClick={() => setPage({ id: 'dashboard' })}>← Назад</button>
          <h1 className="page-title">Администрирование</h1>
        </div>
        <div className="dashboard-header__actions">
          <button className="btn btn--ghost btn--sm" onClick={load} disabled={loading}>
            {loading ? '...' : 'Обновить'}
          </button>
        </div>
      </header>

      <main className="page-content">


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
          <button className={`admin-tab ${tab === 'referrals' ? 'admin-tab--active' : ''}`} onClick={() => setTab('referrals')}>
            Рефералы
          </button>
          <button className={`admin-tab ${tab === 'analytics' ? 'admin-tab--active' : ''}`} onClick={() => setTab('analytics')}>
            Аналитика
          </button>
          <button className={`admin-tab ${tab === 'settings' ? 'admin-tab--active' : ''}`} onClick={() => setTab('settings')}>
            Настройки
          </button>
        </div>

        {loading ? (
          <div className="skeleton-list">
            {[1, 2, 3].map(i => <div key={i} className="skeleton-item" />)}
          </div>

        ) : loadError ? (
          <div className="error-state" role="alert">
            <span>Не удалось загрузить данные</span>
            <button onClick={load}>Повторить</button>
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
                <option value="all">Все планы</option>
                <option value="free">FREE</option>
                <option value="pro">PRO</option>
              </select>
              <select className="admin-filter-select" value={dialogFilter} onChange={e => setDialogFilter(e.target.value as any)}>
                <option value="all">Все диалоги</option>
                <option value="has">Есть диалог</option>
                <option value="none">Нет диалога</option>
              </select>
            </div>
            <div className="admin-list">
              {filteredUsers.slice(0, usersVisible).map(u => (
                <div key={u.id} className="admin-card">
                  <div className="admin-card__main">
                    <div className="admin-card__name">
                      {u.name ?? `#${u.max_user_id}`}
                      {u.is_admin && <span className="admin-badge admin-badge--admin">АДМИН</span>}
                    </div>
                    <div className="admin-card__meta">
                      ID {u.max_user_id} · {u.channel_count} кан. ·{' '}
                      <span className={u.plan === 'pro' ? 'admin-pro' : 'admin-free'}>
                        {u.plan.toUpperCase()}
                      </span>
                      {u.plan_expires && (
                        <> до {new Date(u.plan_expires).toLocaleDateString('ru-RU')}</>
                      )}
                      {' '}
                      <span
                        className={`admin-badge ${u.bot_dialog_started_at ? 'admin-badge--on' : 'admin-badge--off'}`}
                        title={
                          u.bot_dialog_started_at
                            ? `Диалог с ботом открыт: ${formatDateTime(u.bot_dialog_started_at)} — доступен для DM-рассылки`
                            : 'Диалог с ботом не открыт (не нажимал /start) — DM недоступен, только Mini App'
                        }
                      >
                        {u.bot_dialog_started_at ? '💬 диалог открыт' : '💬 нет диалога'}
                      </span>
                    </div>
                    <div className="admin-card__meta admin-card__meta--secondary">
                      Присоединился: {formatDateTime(u.created_at)} · {ACQUISITION_LABELS[u.acquisition_source ?? 'unknown'] ?? u.acquisition_source}
                      {u.acquisition_detail && ` (${u.acquisition_detail})`}
                    </div>
                  </div>
                  <div className="admin-card__actions">
                    {u.plan === 'pro'
                      ? <button className="btn btn--ghost btn--xs" onClick={() => removePro(u.id, u.name)} disabled={pendingUserIds.has(u.id)}>
                          {pendingUserIds.has(u.id) ? '...' : 'Снять PRO'}
                        </button>
                      : <button className="btn btn--ghost btn--xs" onClick={() => grantPro(u.id)} disabled={pendingUserIds.has(u.id)}>
                          {pendingUserIds.has(u.id) ? '...' : `+${settings?.pro_days ?? 30} PRO`}
                        </button>
                    }
                    <button className="btn btn--xs admin-btn--danger" onClick={() => deleteUser(u.id, u.name)}>
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
              {usersVisible < filteredUsers.length && (
                <div ref={usersEndRef} style={{ height: 1 }} />
              )}
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
              {filteredChannels.slice(0, channelsVisible).map(ch => (
                <div key={ch.id} className="admin-card">
                  <div className="admin-card__main">
                    <div className="admin-card__name">
                      {ch.channel_name ?? ch.max_chat_id}
                      <span className={`admin-badge ${ch.is_active ? 'admin-badge--on' : 'admin-badge--off'}`}>
                        {ch.is_active ? 'активен' : 'выключен'}
                      </span>
                      {ch.channel_url && (
                        <button
                          type="button"
                          className="admin-channel-link"
                          onClick={() => openAdminChannelLink(ch.channel_url!)}
                        >
                          Открыть ↗
                        </button>
                      )}
                    </div>
                    <div className="admin-card__meta">
                      {ch.owner_name ?? `ID ${ch.owner_max_id}`} ·{' '}
                      {ch.post_count} постов · {ch.total_comments} комм.
                    </div>
                    <div className="admin-card__meta admin-card__meta--secondary">
                      Канал: {formatDateTime(ch.connected_at)} · Пользователь: {formatDateTime(ch.owner_created_at)}
                    </div>
                  </div>
                  <div className="admin-card__actions">
                    <button className="btn btn--ghost btn--xs" onClick={() => toggleChannel(ch)} disabled={pendingChannelIds.has(ch.id)}>
                      {pendingChannelIds.has(ch.id) ? '...' : ch.is_active ? 'Выключить' : 'Включить'}
                    </button>
                    <button className="btn btn--xs admin-btn--danger" onClick={() => deleteChannel(ch.id, ch.channel_name)}>
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
              {channelsVisible < filteredChannels.length && (
                <div ref={channelsEndRef} style={{ height: 1 }} />
              )}
              {filteredChannels.length === 0 && (
                <div className="empty-state"><span>Ничего не найдено</span></div>
              )}
            </div>
          </>

        ) : tab === 'payments' ? (
          <>
            <div className="admin-stats admin-stats--section">
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
              <div className="payment-table-wrap">
                <table className="payment-table">
                  <thead>
                    <tr>
                      <th className="payment-th payment-th--left">Пользователь</th>
                      <th className="payment-th payment-th--right">Сумма</th>
                      <th className="payment-th">Промо</th>
                      <th className="payment-th">Статус</th>
                      <th className="payment-th">Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id} className="payment-row">
                        <td className="payment-cell">
                          {p.user_name ?? `ID ${p.max_user_id}`}
                        </td>
                        <td className="payment-cell payment-cell--right">
                          {Number(p.amount_rub)} ₽
                          {p.discount_percent && (
                            <span className="payment-discount">-{p.discount_percent}%</span>
                          )}
                        </td>
                        <td className="payment-cell payment-cell--code">
                          {p.promo_code ?? '—'}
                        </td>
                        <td className="payment-cell">
                          <span className={`payment-status payment-status--${p.status}`}>
                            {p.status === 'succeeded' ? 'оплачен' : p.status === 'pending' ? 'ожидает' : 'отменён'}
                          </span>
                        </td>
                        <td className="payment-cell payment-cell--date">
                          {new Date(p.created_at).toLocaleDateString('ru-RU')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>

        ) : tab === 'referrals' ? (
          <>
            <div className="admin-stats admin-stats--referrals">
              <div className="admin-stat">
                <span className="admin-stat__val">{referralStats?.summary.invited ?? 0}</span>
                <span className="admin-stat__lbl">приглашено</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat__val">{referralStats?.summary.converted ?? 0}</span>
                <span className="admin-stat__lbl">купили PRO</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat__val">{formatRub(referralStats?.summary.commission_earned_rub ?? 0)} ₽</span>
                <span className="admin-stat__lbl">комиссий</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat__val">{formatRub(referralStats?.summary.balance_rub ?? 0)} ₽</span>
                <span className="admin-stat__lbl">баланс</span>
              </div>
            </div>

            <div className="admin-filter-row">
              <input
                className="admin-filter-input"
                placeholder="Поиск по имени, ID или реф-коду..."
                value={referralSearch}
                onChange={e => setReferralSearch(e.target.value)}
              />
            </div>

            <div className="admin-list">
              {filteredReferrals.map((r) => (
                <div key={r.id} className="admin-card admin-card--referral">
                  <div className="admin-card__main">
                    <div className="admin-card__name">
                      {r.name ?? `ID ${r.max_user_id}`}
                      <span className="admin-badge admin-badge--admin">{r.current_rate_percent}%</span>
                    </div>
                    <div className="admin-card__meta">
                      ID {r.max_user_id} · код {r.ref_code ?? '—'} · {r.invited} приглашено · {r.converted} оплатили · +{r.days_earned} дней PRO
                    </div>
                    <div className="referral-admin-metrics">
                      <span>Комиссии: {formatRub(r.commission_earned_rub)} ₽</span>
                      <span>Корректировки: {r.manual_adjustments_rub >= 0 ? '+' : ''}{formatRub(r.manual_adjustments_rub)} ₽</span>
                      <span className={r.balance_rub < 0 ? 'referral-balance referral-balance--negative' : 'referral-balance'}>
                        Баланс: {formatRub(r.balance_rub)} ₽
                      </span>
                    </div>
                    {adjustingReferralId === r.id && (
                      <div className="referral-adjust-form">
                        <input
                          className="admin-settings__input"
                          placeholder="Сумма, например 150 или -150"
                          aria-label="Сумма корректировки баланса, со знаком"
                          inputMode="decimal"
                          value={adjustAmount}
                          onChange={e => setAdjustAmount(e.target.value)}
                        />
                        <input
                          className="admin-settings__input"
                          placeholder="Причина"
                          aria-label="Причина корректировки баланса"
                          value={adjustReason}
                          onChange={e => setAdjustReason(e.target.value)}
                        />
                        <div className="referral-adjust-form__actions">
                          <button className="btn btn--ghost btn--xs" onClick={() => saveReferralAdjustment(r.id, r.name)} disabled={adjustSaving}>
                            {adjustSaving ? 'Сохраняю...' : 'Сохранить'}
                          </button>
                          <button className="btn btn--xs admin-btn--danger" onClick={cancelAdjustReferral}>
                            Отмена
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="admin-card__actions">
                    <button className="btn btn--ghost btn--xs" onClick={() => startAdjustReferral(r, 'add')}>
                      Начислить
                    </button>
                    <button className="btn btn--xs admin-btn--danger" onClick={() => startAdjustReferral(r, 'subtract')}>
                      Списать
                    </button>
                  </div>
                </div>
              ))}
              {filteredReferrals.length === 0 && (
                <div className="empty-state"><span>Реферальных начислений пока нет</span></div>
              )}
            </div>

            {(referralStats?.adjustments.length ?? 0) > 0 && (
              <div className="referral-adjustments-log">
                <div className="admin-settings__label">Последние ручные операции</div>
                {referralStats!.adjustments.map((a) => (
                  <div key={a.id} className="referral-adjustment-row">
                    <span className={a.amount_rub < 0 ? 'referral-balance referral-balance--negative' : 'referral-balance'}>
                      {a.amount_rub > 0 ? '+' : ''}{formatRub(a.amount_rub)} ₽
                    </span>
                    <span>{a.referrer_name ?? `ID ${a.referrer_max_user_id}`}</span>
                    <span>{a.reason}</span>
                    <span>{new Date(a.created_at).toLocaleDateString('ru-RU')}</span>
                  </div>
                ))}
              </div>
            )}
          </>

        ) : tab === 'analytics' ? (
          <>
            {/* Источники привлечения */}
            <div className="admin-settings-group">
              <div className="admin-settings__label admin-settings__label--section">
                Откуда пришли пользователи
              </div>
              {(acquisitionStats?.by_source.length ?? 0) === 0 ? (
                <div className="empty-state"><span>Пока нет данных</span></div>
              ) : (
                <div className="acquisition-bars">
                  {acquisitionStats!.by_source.map((s) => {
                    const pct = totalUsers > 0 ? Math.round((s.count / totalUsers) * 100) : 0;
                    return (
                      <div key={s.source} className="acquisition-bar-row">
                        <span className="acquisition-bar-row__label">
                          {ACQUISITION_LABELS[s.source] ?? s.source}
                        </span>
                        <div className="acquisition-bar-track">
                          <div className="acquisition-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="acquisition-bar-row__value">{s.count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Топ источников с деталями (реф-коды, каналы, UTM) */}
            {(acquisitionStats?.top_details.length ?? 0) > 0 && (
              <div className="admin-settings-group">
                <div className="admin-settings__label admin-settings__label--section">
                  Топ конкретных источников
                </div>
                <div className="admin-list">
                  {acquisitionStats!.top_details.map((d, i) => (
                    <div key={i} className="admin-card">
                      <div className="admin-card__main">
                        <div className="admin-card__name">{d.detail}</div>
                        <div className="admin-card__meta">{ACQUISITION_LABELS[d.source] ?? d.source} · {d.count} польз.</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Что нажимали в Mini App */}
            <div className="admin-settings-group">
              <div className="admin-settings__label admin-settings__label--section">
                Что нажимали в Mini App
              </div>
              <div className="admin-filter-row">
                <select
                  className="admin-filter-select"
                  value={eventsDays}
                  onChange={(e) => setEventsDays(Number(e.target.value) as 7 | 30 | 90)}
                >
                  <option value={7}>7 дней</option>
                  <option value={30}>30 дней</option>
                  <option value={90}>90 дней</option>
                </select>
              </div>

              {(eventsStats?.top_events.length ?? 0) === 0 ? (
                <div className="empty-state"><span>Событий пока нет</span></div>
              ) : (
                <div className="admin-list">
                  {eventsStats!.top_events.map((ev) => (
                    <div key={`${ev.event_type}:${ev.event_name}`} className="admin-card">
                      <div className="admin-card__main">
                        <div className="admin-card__name">{ev.event_name}</div>
                        <div className="admin-card__meta">
                          {ev.event_type === 'page_view' ? 'просмотр страницы' : 'клик'} · {ev.count} раз
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Живая лента последних событий */}
            {(eventsStats?.recent.length ?? 0) > 0 && (
              <div className="admin-settings-group">
                <div className="admin-settings__label admin-settings__label--section">
                  Последние события
                </div>
                <div className="admin-list">
                  {eventsStats!.recent.map((e) => (
                    <div key={e.id} className="admin-card">
                      <div className="admin-card__main">
                        <div className="admin-card__name">{e.event_name}</div>
                        <div className="admin-card__meta">
                          {e.user_name ?? `ID ${e.user_max_id}`} · {formatDateTime(e.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>

        ) : (
          // Settings tab
          <div className="admin-settings">
            {/* Цена и длительность */}
            <div className="admin-settings__row">
              <label className="admin-settings__label" htmlFor="admin-pro-price">Цена PRO (₽/мес)</label>
              <input
                id="admin-pro-price"
                className="admin-settings__input"
                type="number"
                min="1"
                value={priceInput}
                onChange={e => setPriceInput(e.target.value)}
              />
            </div>
            <div className="admin-settings__row">
              <label className="admin-settings__label" htmlFor="admin-pro-days">Длительность PRO (дней)</label>
              <input
                id="admin-pro-days"
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
            <div className="admin-settings-group">
              <div className="admin-settings__label admin-settings__label--section">
                Промо-коды
              </div>

              {/* Форма создания */}
              <div className="promo-form">
                <div className="promo-input-row">
                  <input
                    placeholder="Код (напр. SUMMER20)"
                    aria-label="Код промокода"
                    value={promoCode}
                    onChange={e => setPromoCode(e.target.value.toUpperCase())}
                    className="admin-settings__input promo-input--code"
                  />
                  <input
                    type="number"
                    min="1"
                    max="100"
                    placeholder="Скидка %"
                    aria-label="Скидка в процентах"
                    value={promoDiscount}
                    onChange={e => setPromoDiscount(e.target.value)}
                    className="admin-settings__input promo-input--short"
                  />
                </div>
                <div className="promo-input-row">
                  <input
                    type="number"
                    min="1"
                    placeholder="Макс. использований (пусто = ∞)"
                    aria-label="Максимум использований промокода"
                    value={promoMaxUses}
                    onChange={e => setPromoMaxUses(e.target.value)}
                    className="admin-settings__input promo-input--short"
                  />
                  <input
                    type="date"
                    aria-label="Дата истечения промокода"
                    value={promoExpires}
                    onChange={e => setPromoExpires(e.target.value)}
                    className="admin-settings__input promo-input--short"
                  />
                </div>
                <button className="btn btn--ghost" onClick={createPromo} disabled={promoCreating}>
                  {promoCreating ? 'Создаю...' : '+ Создать промо-код'}
                </button>
              </div>

              {/* Список кодов */}
              <div className="promo-list">
                {promoCodes.length === 0 && (
                  <div className="promo-empty">
                    Нет промо-кодов
                  </div>
                )}
                {promoCodes.map(p => (
                  <div key={p.code} className="promo-row">
                    <span className="promo-code-tag">{p.code}</span>
                    <span className="promo-discount">-{p.discount_percent}%</span>
                    <span className="promo-usage">
                      {p.used_count}/{p.max_uses ?? '∞'}
                    </span>
                    {p.expires_at && (
                      <span className="promo-expiry">
                        до {new Date(p.expires_at).toLocaleDateString('ru-RU')}
                      </span>
                    )}
                    <button
                      className="btn btn--xs admin-btn--danger"
                      onClick={() => deletePromo(p.code)}
                      aria-label={`Удалить промо-код ${p.code}`}
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
