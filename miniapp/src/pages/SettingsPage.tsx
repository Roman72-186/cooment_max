// Настройки канала — каждый тоггл сохраняется мгновенно,
// стоп-слова и реакции — явной кнопкой «Сохранить»
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { deleteChannel, getUserMe, updateChannelSettings } from '../api/backend';
import { useAppStore } from '../store/useAppStore';
import { PollSettingsEditor, type PollTemplate } from '../components/PollSettingsEditor';

// Эмодзи для реакций под постами
const PRESET_EMOJIS = ['❤️', '👍', '🔥', '😂', '😮', '😢', '👏', '🎉', '💯', '🤔', '😍', '💪', '🙏', '👎', '🤯'];

// Категории стоп-слов для модерации
interface WordCategory { name: string; words: string[]; }

const PRESET_CATEGORIES: WordCategory[] = [
  {
    name: 'Реклама и продажи',
    words: ['реклама', 'спам', 'продам', 'куплю', 'услуги', 'дешево', 'акция',
            'скидка', 'распродажа', 'бесплатно', 'даром', 'предлагаю', 'продаю',
            'цена', 'стоимость', 'оптом', 'оптовые', 'доставка', 'заказ', 'прайс'],
  },
  {
    name: 'Призывы к действию',
    words: ['подписывайся', 'подпишись', 'переходи', 'жми', 'кликай', 'вступай',
            'регистрируйся', 'пиши', 'звони', 'срочно', 'успей', 'поторопись', 'сейчас'],
  },
  {
    name: 'Мошенничество и финансы',
    words: ['заработок', 'доход', 'инвестиции', 'крипта', 'криптовалюта', 'казино',
            'ставки', 'займ', 'кредит', 'быстрые деньги', 'пассивный доход',
            'финансовая свобода', 'выигрыш', 'розыгрыш', 'конкурс', 'выиграй', 'приз'],
  },
  {
    name: 'Нежелательный контент',
    words: ['эскорт', 'интим', 'знакомства', 'порно', '18+', 'взрослый', 'секс'],
  },
  {
    name: 'Раскрутка и накрутка',
    words: ['раскрутка', 'накрутка', 'подписчики', 'лайки', 'просмотры', 'телеграм',
            'вотсап', 'вконтакте', 'инстаграм', 'канал', 'группа', 'паблик', 'реферал'],
  },
  {
    name: 'Нецензурная лексика',
    words: ['бля', 'хуй', 'пизд', 'ебан', 'сука', 'пидор', 'мудак', 'ублюдок',
            'дебил', 'идиот', 'мразь', 'чёрт'],
  },
];

// Рекомендуемые = первые 3 безопасные категории (без нецензурной лексики)
const RECOMMENDED_WORDS = PRESET_CATEGORIES.slice(0, 3).flatMap((c) => c.words);

type SectionState = 'idle' | 'saving' | 'saved' | 'error';

// Вынесен за пределы компонента — не пересоздаётся на каждом рендере
function SectionBadge({ state, errorText = 'Ошибка' }: { state: SectionState; errorText?: string }) {
  if (state === 'saving') return <span className="settings-status settings-status--saving">Сохраняю…</span>;
  if (state === 'saved')  return <span className="settings-status settings-status--saved">✓ Сохранено</span>;
  if (state === 'error')  return <span className="settings-status settings-status--error">{errorText}</span>;
  return null;
}

interface Props { channelId: number; }

export function SettingsPage({ channelId }: Props) {
  const { user, setUser, setPage, updateChannel, addToast, requestConfirm } = useAppStore();
  const channel = user?.channels.find((c) => c.id === channelId);
  const isPro = user?.plan === 'pro' &&
    (!user.plan_expires || new Date(user.plan_expires) > new Date());
  const contentRef = useRef<HTMLElement>(null);
  const mainSettingsRef = useRef<HTMLDivElement>(null);
  const bannedSettingsRef = useRef<HTMLDivElement>(null);
  const pollSettingsRef = useRef<HTMLDivElement>(null);
  const dangerSettingsRef = useRef<HTMLDivElement>(null);

  // ── Значения полей ────────────────────────────────────────────
  const [commentsEnabled, setCommentsEnabled]         = useState(channel?.comments_enabled ?? true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(channel?.notifications_enabled ?? true);
  const [reactionsEnabled, setReactionsEnabled]       = useState((channel?.post_reactions?.length ?? 0) > 0);
  const [selectedReactions, setSelectedReactions]     = useState<string[]>(channel?.post_reactions ?? []);
  const [bannedInput, setBannedInput]                 = useState(channel?.banned_words?.join(', ') ?? '');

  // ── Статусы по секциям ────────────────────────────────────────
  // ── Опрос ─────────────────────────────────────────────────────
  const [pollTemplate, setPollTemplate] = useState<PollTemplate>({
    poll_enabled: (channel as any)?.poll_enabled ?? false,
    poll_question: (channel as any)?.poll_question ?? '',
    poll_options: (channel as any)?.poll_options ?? [{ text: '' }, { text: '' }],
  });
  const [stPoll, setStPoll] = useState<SectionState>('idle');
  const timerPoll = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Статусы по секциям ────────────────────────────────────────
  const [stComments, setStComments]             = useState<SectionState>('idle');
  const [stNotifications, setStNotifications]   = useState<SectionState>('idle');
  const [stReactions, setStReactions]           = useState<SectionState>('idle');
  const [stBanned, setStBanned]                 = useState<SectionState>('idle');

  // ── Dirty states для автосохранения ───────────────────────────
  const [reactionsDirty, setReactionsDirty] = useState(false);
  const [bannedDirty, setBannedDirty] = useState(false);
  const [pollDirty, setPollDirty] = useState(false);

  // Таймеры авто-сброса бейджа «Сохранено»
  const timerComments      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerNotifications = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerReactions     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerBanned        = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Таймеры для автосохранения
  const reactionsTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const bannedTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pollTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Очистка всех таймеров при размонтировании
  useEffect(() => {
    return () => {
      [timerComments, timerNotifications, timerReactions, timerBanned, timerPoll].forEach((t) => {
        if (t.current) clearTimeout(t.current);
      });
      [reactionsTimerRef, bannedTimerRef, pollTimerRef].forEach((t) => {
        if (t.current) clearTimeout(t.current);
      });
    };
  }, []);

  function autoReset(setter: (s: SectionState) => void, timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setter('idle'), 2500);
  }

  // ── Вычисляемые значения ──────────────────────────────────────
  const currentWords = useMemo(
    () => new Set(bannedInput.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean)),
    [bannedInput]
  );
  const wordCount = useMemo(
    () => bannedInput.split(',').filter((w) => w.trim().length > 0).length,
    [bannedInput]
  );

  // ── Авто-сохранение тоглов ────────────────────────────────────
  const handleCommentsToggle = async (enabled: boolean) => {
    setCommentsEnabled(enabled);
    setStComments('saving');
    try {
      const result = await updateChannelSettings(channelId, { comments_enabled: enabled });
      updateChannel({ id: channelId, comments_enabled: result.comments_enabled });
      setStComments('saved');
      autoReset(setStComments, timerComments);
    } catch {
      setCommentsEnabled(!enabled); // откат
      setStComments('error');
      autoReset(setStComments, timerComments);
    }
  };

  const handleNotificationsToggle = async (enabled: boolean) => {
    if (!isPro) {
      addToast({ type: 'info', message: 'Уведомления о новых комментариях доступны на PRO' });
      setPage({ id: 'pricing' });
      return;
    }
    setNotificationsEnabled(enabled);
    setStNotifications('saving');
    try {
      const result = await updateChannelSettings(channelId, { notifications_enabled: enabled });
      updateChannel({ id: channelId, notifications_enabled: result.notifications_enabled });
      setStNotifications('saved');
      autoReset(setStNotifications, timerNotifications);
    } catch {
      setNotificationsEnabled(!enabled); // откат
      setStNotifications('error');
      autoReset(setStNotifications, timerNotifications);
    }
  };

  // ── Сохранение реакций ────────────────────────────────────────
  const handleSaveReactions = async () => {
    if (!isPro) {
      addToast({ type: 'info', message: 'Реакции под постами доступны на PRO' });
      setPage({ id: 'pricing' });
      return;
    }
    const reactions = reactionsEnabled ? selectedReactions : [];
    setStReactions('saving');
    try {
      const result = await updateChannelSettings(channelId, { post_reactions: reactions });
      updateChannel({ id: channelId, post_reactions: result.post_reactions });
      // Синхронизируем локальное состояние с сервером
      setReactionsEnabled(result.post_reactions.length > 0);
      setSelectedReactions(result.post_reactions);
      setStReactions('saved');
      autoReset(setStReactions, timerReactions);
    } catch {
      setStReactions('error');
      autoReset(setStReactions, timerReactions);
    }
  };

  // ── Сохранение стоп-слов ──────────────────────────────────────
  const handleSaveBanned = async () => {
    if (!isPro) {
      addToast({ type: 'info', message: 'Стоп-слова доступны на PRO' });
      setPage({ id: 'pricing' });
      return;
    }
    const banned = bannedInput
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);

    if (banned.length > 100) {
      setStBanned('error');
      autoReset(setStBanned, timerBanned);
      return;
    }

    setStBanned('saving');
    try {
      const result = await updateChannelSettings(channelId, { banned_words: banned });
      updateChannel({ id: channelId, banned_words: result.banned_words });
      setBannedInput(result.banned_words.join(', '));
      setStBanned('saved');
      autoReset(setStBanned, timerBanned);
    } catch {
      setStBanned('error');
      autoReset(setStBanned, timerBanned);
    }
  };

  // Автосохранение стоп-слов
  const saveBannedAuto = async (nextInput = bannedInput) => {
    if (!isPro) return;
    const banned = nextInput
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);

    if (banned.length > 100) {
      addToast({ type: 'error', message: 'Максимум 100 слов' });
      return;
    }

    try {
      const result = await updateChannelSettings(channelId, { banned_words: banned });
      updateChannel({ id: channelId, banned_words: result.banned_words });
      setBannedInput(result.banned_words.join(', '));
      setBannedDirty(false);
      addToast({ type: 'success', message: 'Стоп-слова сохранены' });
    } catch {
      addToast({ type: 'error', message: 'Ошибка сохранения стоп-слов' });
    }
  };

  const handleBannedInputChange = (value: string) => {
    if (!isPro) {
      addToast({ type: 'info', message: 'Стоп-слова доступны на PRO' });
      setPage({ id: 'pricing' });
      return;
    }
    setBannedInput(value);
    setBannedDirty(true);
    clearTimeout(bannedTimerRef.current);
    bannedTimerRef.current = setTimeout(() => saveBannedAuto(value), 1200);
  };

  const handleBannedInputBlur = () => {
    if (bannedDirty) {
      clearTimeout(bannedTimerRef.current);
      saveBannedAuto(bannedInput);
    }
  };

  const toggleWord = useCallback((word: string) => {
    if (!isPro) {
      addToast({ type: 'info', message: 'Стоп-слова доступны на PRO' });
      setPage({ id: 'pricing' });
      return;
    }
    const words = bannedInput.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    const newValue = words.includes(word)
      ? words.filter((w) => w !== word).join(', ')
      : [...words, word].join(', ');
    setBannedInput(newValue);
    setBannedDirty(true);
    clearTimeout(bannedTimerRef.current);
    bannedTimerRef.current = setTimeout(() => saveBannedAuto(newValue), 1200);
  }, [addToast, bannedInput, isPro, setPage]);

  const addCategory = useCallback((categoryWords: string[]) => {
    if (!isPro) {
      addToast({ type: 'info', message: 'Стоп-слова доступны на PRO' });
      setPage({ id: 'pricing' });
      return;
    }
    const existing = new Set(bannedInput.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean));
    const toAdd = categoryWords.filter((w) => !existing.has(w));
    if (toAdd.length === 0) return;
    const newValue = [...existing, ...toAdd].join(', ');
    setBannedInput(newValue);
    setBannedDirty(true);
    clearTimeout(bannedTimerRef.current);
    bannedTimerRef.current = setTimeout(() => saveBannedAuto(newValue), 1200);
  }, [addToast, bannedInput, isPro, setPage]);

  const applyRecommended = useCallback(() => {
    addCategory(RECOMMENDED_WORDS);
  }, [addCategory]);

  // Автосохранение реакций
  const saveReactionsAuto = async (
    nextEnabled = reactionsEnabled,
    nextSelected = selectedReactions
  ) => {
    if (!isPro) return;
    const reactions = nextEnabled ? nextSelected : [];
    try {
      const result = await updateChannelSettings(channelId, { post_reactions: reactions });
      updateChannel({ id: channelId, post_reactions: result.post_reactions });
      setReactionsEnabled(result.post_reactions.length > 0);
      setSelectedReactions(result.post_reactions);
      setReactionsDirty(false);
      addToast({ type: 'success', message: 'Реакции сохранены' });
    } catch {
      addToast({ type: 'error', message: 'Ошибка сохранения реакций' });
    }
  };

  const handleReactionsEnabledChange = (enabled: boolean) => {
    if (!isPro) {
      addToast({ type: 'info', message: 'Реакции под постами доступны на PRO' });
      setPage({ id: 'pricing' });
      return;
    }
    const nextSelected = enabled
      ? (selectedReactions.length > 0 ? selectedReactions : [PRESET_EMOJIS[0]])
      : [];
    setReactionsEnabled(enabled);
    setSelectedReactions(nextSelected);
    setReactionsDirty(true);
    clearTimeout(reactionsTimerRef.current);
    reactionsTimerRef.current = setTimeout(() => saveReactionsAuto(enabled, nextSelected), 800);
  };

  const toggleEmoji = useCallback((emoji: string) => {
    if (!isPro) {
      addToast({ type: 'info', message: 'Реакции под постами доступны на PRO' });
      setPage({ id: 'pricing' });
      return;
    }
    const nextSelected = selectedReactions.includes(emoji)
      ? selectedReactions.filter(e => e !== emoji)
      : selectedReactions.length < 5 ? [...selectedReactions, emoji] : selectedReactions;
    setSelectedReactions(nextSelected);
    setReactionsDirty(true);
    clearTimeout(reactionsTimerRef.current);
    reactionsTimerRef.current = setTimeout(() => saveReactionsAuto(reactionsEnabled, nextSelected), 800);
  }, [addToast, isPro, reactionsEnabled, selectedReactions, setPage]);

  // ── Сохранение настроек опроса ────────────────────────────────
  const handleSavePoll = async () => {
    if (!isPro) {
      addToast({ type: 'info', message: 'Опросы под постами доступны на PRO' });
      setPage({ id: 'pricing' });
      return;
    }
    if (pollTemplate.poll_enabled) {
      if (!pollTemplate.poll_question.trim()) {
        setStPoll('error');
        autoReset(setStPoll, timerPoll);
        return;
      }
      const validOptions = pollTemplate.poll_options.filter(o => o.text.trim().length > 0);
      if (validOptions.length < 2) {
        setStPoll('error');
        autoReset(setStPoll, timerPoll);
        return;
      }
    }

    setStPoll('saving');
    try {
      const cleanOptions = pollTemplate.poll_options.map(o => ({ text: o.text.trim() }));
      const result = await updateChannelSettings(channelId, {
        poll_enabled: pollTemplate.poll_enabled,
        poll_question: pollTemplate.poll_question.trim() || null,
        poll_options: pollTemplate.poll_enabled ? cleanOptions : null,
      });
      updateChannel({
        id: channelId,
        ...(result as any),
      });
      setStPoll('saved');
      autoReset(setStPoll, timerPoll);
    } catch {
      setStPoll('error');
      autoReset(setStPoll, timerPoll);
    }
  };

  // Автосохранение опроса
  const savePollAuto = async (nextTemplate = pollTemplate) => {
    if (!isPro) return;
    if (nextTemplate.poll_enabled) {
      if (!nextTemplate.poll_question.trim()) {
        addToast({ type: 'error', message: 'Заполните вопрос опроса' });
        return;
      }
      const validOptions = nextTemplate.poll_options.filter(o => o.text.trim().length > 0);
      if (validOptions.length < 2) {
        addToast({ type: 'error', message: 'Нужно минимум 2 варианта ответа' });
        return;
      }
    }

    try {
      const cleanOptions = nextTemplate.poll_options.map(o => ({ text: o.text.trim() }));
      const result = await updateChannelSettings(channelId, {
        poll_enabled: nextTemplate.poll_enabled,
        poll_question: nextTemplate.poll_question.trim() || null,
        poll_options: nextTemplate.poll_enabled ? cleanOptions : null,
      });
      updateChannel({
        id: channelId,
        ...(result as any),
      });
      setPollDirty(false);
      addToast({ type: 'success', message: 'Настройки опроса сохранены' });
    } catch {
      addToast({ type: 'error', message: 'Ошибка сохранения настроек опроса' });
    }
  };

  const handlePollTemplateChange = (newTemplate: PollTemplate) => {
    if (!isPro) {
      addToast({ type: 'info', message: 'Опросы под постами доступны на PRO' });
      setPage({ id: 'pricing' });
      return;
    }
    setPollTemplate(newTemplate);
    setPollDirty(true);
    clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(() => savePollAuto(newTemplate), 1000);
  };

  const handlePollTemplateBlur = () => {
    if (pollDirty) {
      clearTimeout(pollTimerRef.current);
      savePollAuto(pollTemplate);
    }
  };

  const scrollToSection = (ref: React.RefObject<HTMLDivElement>) => {
    const container = contentRef.current;
    const target = ref.current;
    if (!container || !target) return;

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = Math.max(0, container.scrollTop + targetRect.top - containerRect.top - 12);
    container.scrollTo({ top, behavior: 'smooth' });
  };

  const handleDeleteChannel = () => {
    if (!channel) return;
    const channelName = channel.channel_name || channel.max_chat_id;
    requestConfirm({
      message: `Удалить канал «${channelName}» из панели? История постов и комментариев этого канала будет удалена из сервиса. Бота из администраторов MAX нужно убрать отдельно в настройках канала.`,
      confirmLabel: 'Удалить',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteChannel(channelId);
          const freshUser = await getUserMe();
          setUser(freshUser);
          addToast({ type: 'success', message: 'Канал удалён из панели' });
          setPage(freshUser.channels.length > 0 ? { id: 'dashboard' } : { id: 'onboarding' });
        } catch {
          addToast({ type: 'error', message: 'Не удалось удалить канал' });
        }
      },
    });
  };

  if (!channel) {
    return (
      <div className="page">
        <header className="page-header">
          <div className="page-header-row">
            <button className="btn-back" onClick={() => setPage({ id: 'dashboard' })}>
              ← Назад
            </button>
            <h1 className="page-title">Настройки</h1>
          </div>
        </header>
        <main className="page-content">
          <div className="error-state" role="alert">
            <span>Канал не найден или недоступен</span>
            <button onClick={() => setPage({ id: 'dashboard' })}>К списку каналов</button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-row">
          <button className="btn-back" onClick={() => setPage({ id: 'dashboard' })}>
            ← Назад
          </button>
          <h1 className="page-title">Настройки</h1>
        </div>
        <div className="page-subtitle">
          {channel.channel_name || channel.max_chat_id}
        </div>
      </header>

      <main ref={contentRef} className="page-content">
        <div className="settings-jump-nav" aria-label="Быстрые переходы по настройкам">
          <button type="button" onClick={() => scrollToSection(mainSettingsRef)}>Основное</button>
          {isPro && (
            <>
              <button type="button" onClick={() => scrollToSection(bannedSettingsRef)}>Стоп-слова</button>
              <button type="button" onClick={() => scrollToSection(pollSettingsRef)}>Опрос</button>
            </>
          )}
          <button type="button" onClick={() => scrollToSection(dangerSettingsRef)}>Опасная зона</button>
        </div>

        <div ref={mainSettingsRef} className="settings-grid settings-anchor">
          {/* ── Комментарии ───────────────────────────────────────── */}
          <div className="settings-section">
            <div className="settings-section__title-row">
              <h2 className="settings-section__title">Комментарии</h2>
              <SectionBadge state={stComments} />
            </div>
            <label className={`toggle-row ${stComments === 'saving' ? 'toggle-row--disabled' : ''}`}>
              <div className="toggle-row__info">
                <span className="toggle-row__label">Кнопка «💬» под постами</span>
                <span className={`toggle-state ${commentsEnabled ? 'toggle-state--on' : 'toggle-state--off'}`}>
                  {commentsEnabled ? 'Включено' : 'Выключено'}
                </span>
              </div>
              <input
                type="checkbox"
                className="toggle"
                checked={commentsEnabled}
                disabled={stComments === 'saving'}
                onChange={(e) => handleCommentsToggle(e.target.checked)}
              />
            </label>
            <p className="settings-section__hint">
              При отключении кнопка «💬» перестанет добавляться к новым постам.
              Уже опубликованные кнопки останутся.
            </p>
          </div>

          {isPro && (
            <>
              {/* ── Уведомления ───────────────────────────────────────── */}
              <div className="settings-section">
                <div className="settings-section__title-row">
                  <h2 className="settings-section__title">Уведомления</h2>
                  <SectionBadge state={stNotifications} />
                </div>
                <label className={`toggle-row ${stNotifications === 'saving' ? 'toggle-row--disabled' : ''}`}>
                  <div className="toggle-row__info">
                    <span className="toggle-row__label">Сообщения о новых комментариях</span>
                    <span className={`toggle-state ${notificationsEnabled ? 'toggle-state--on' : 'toggle-state--off'}`}>
                      {notificationsEnabled ? 'Включено' : 'Выключено'}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle"
                    checked={notificationsEnabled}
                    disabled={stNotifications === 'saving'}
                    onChange={(e) => handleNotificationsToggle(e.target.checked)}
                  />
                </label>
                <p className="settings-section__hint">
                  Бот пришлёт вам личное сообщение при появлении новых комментариев под постами.
                </p>
              </div>

              {/* ── Реакции под постами ────────────────────────────────── */}
              <div className={`settings-section${reactionsDirty ? ' settings-section--dirty' : ''}`}>
                <div className="settings-section__title-row">
                  <h2 className="settings-section__title">Реакции под постами</h2>
                  <SectionBadge state={stReactions} />
                </div>
                <label className="toggle-row">
                  <div className="toggle-row__info">
                    <span className="toggle-row__label">Кнопки эмодзи под постами</span>
                    <span className={`toggle-state ${reactionsEnabled ? 'toggle-state--on' : 'toggle-state--off'}`}>
                      {reactionsEnabled ? 'Включено' : 'Выключено'}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle"
                    checked={reactionsEnabled}
                    onChange={(e) => handleReactionsEnabledChange(e.target.checked)}
                  />
                </label>

                {reactionsEnabled && (
                  <>
                    <p className="settings-section__hint">
                      Выберите до 5 эмодзи — они появятся как кнопки под новыми постами.
                    </p>
                    <div className="preset-words__chips">
                      {PRESET_EMOJIS.map((emoji) => {
                        const isSelected = selectedReactions.includes(emoji);
                        return (
                          <button
                            key={emoji}
                            type="button"
                            className={`preset-chip emoji-chip${isSelected ? ' preset-chip--active' : ''}`}
                            onClick={() => toggleEmoji(emoji)}
                            disabled={!isSelected && selectedReactions.length >= 5}
                            aria-pressed={isSelected}
                            aria-label={`${emoji}${isSelected ? ' (выбрано)' : ''}`}
                          >
                            {emoji}
                          </button>
                        );
                      })}
                    </div>
                    <div className="settings-section__hint">
                      Выбрано: {selectedReactions.length} / 5
                      {selectedReactions.length === 0 && (
                        <span className="settings-hint--warn"> — выберите хотя бы один</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Стоп-слова ─────────────────────────────────────────── */}
        {isPro && <div ref={bannedSettingsRef} className={`settings-section settings-anchor${bannedDirty ? ' settings-section--dirty' : ''}`}>
          <div className="settings-section__title-row">
            <h2 className="settings-section__title">Стоп-слова</h2>
            <SectionBadge state={stBanned} errorText="Максимум 100 слов" />
          </div>
          <p className="settings-section__hint">
            Комментарии с этими словами будут автоматически скрыты.
            Вводите через запятую, максимум 100 слов.
          </p>
          <textarea
            className="settings-textarea"
            aria-label="Список стоп-слов через запятую"
            placeholder="спам, реклама, ненормативная лексика..."
            value={bannedInput}
            onChange={(e) => handleBannedInputChange(e.target.value)}
            onBlur={handleBannedInputBlur}
            rows={4}
            disabled={!isPro}
          />
          <div className={`settings-section__hint${wordCount >= 100 ? ' settings-hint--critical' : wordCount >= 80 ? ' settings-hint--warn' : ''}`}>
            {wordCount} / 100 слов{wordCount >= 80 && wordCount < 100 ? ' — приближается лимит' : ''}
          </div>
          {/* Кнопка быстрого старта. Блок целиком рендерится только при isPro — веток для FREE тут нет */}
          <button type="button" className="btn btn--recommended" onClick={applyRecommended}>
            🛡 Добавить рекомендуемые ({RECOMMENDED_WORDS.length})
          </button>

          {/* Категории стоп-слов */}
          <div className="preset-categories">
            {PRESET_CATEGORIES.map((cat) => {
              const allActive = cat.words.every((w) => currentWords.has(w));
              return (
                <div key={cat.name} className="preset-category">
                  <div className="preset-category__header">
                    <span className="preset-category__name">{cat.name}</span>
                    <button
                      type="button"
                      className={`preset-category__btn${allActive ? ' preset-category__btn--done' : ''}`}
                      onClick={() => addCategory(cat.words)}
                      disabled={!isPro || allActive}
                    >
                      {allActive ? '✓ Все добавлены' : `+ Все (${cat.words.length})`}
                    </button>
                  </div>
                  <div className="preset-words__chips">
                    {cat.words.map((word) => {
                      const isActive = currentWords.has(word);
                      return (
                        <button
                          key={word}
                          type="button"
                          className={`preset-chip${isActive ? ' preset-chip--active' : ''}`}
                          onClick={() => toggleWord(word)}
                          aria-pressed={isActive}
                        >
                          {word}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>}

        {/* ── Опрос под постами ─────────────────────────────────── */}
        {isPro && <div ref={pollSettingsRef} className={`settings-section settings-anchor${pollDirty ? ' settings-section--dirty' : ''}`}>
          <div className="settings-section__title-row">
            <h2 className="settings-section__title">Опрос</h2>
            <SectionBadge state={stPoll} errorText="Заполните вопрос и 2+ варианта" />
          </div>
          <p className="settings-section__hint">
            Каждый новый пост канала автоматически получит кнопки с вариантами ответа.
          </p>
          <div onBlur={handlePollTemplateBlur}>
            <PollSettingsEditor value={pollTemplate} onChange={handlePollTemplateChange} />
          </div>
        </div>}

        {/* ── Опасная зона ───────────────────────────────────────── */}
        <div ref={dangerSettingsRef} className="settings-section settings-section--danger settings-anchor">
          <h2 className="settings-section__title">Опасная зона</h2>
          <p className="settings-section__hint">
            Чтобы просто остановить новые комментарии, удалите бота из администраторов канала в MAX.
            Если канал больше не нужен в панели, удалите его ниже.
          </p>
          <button className="btn btn--danger" onClick={handleDeleteChannel}>
            Удалить канал из панели
          </button>
        </div>

      </main>
    </div>
  );
}
