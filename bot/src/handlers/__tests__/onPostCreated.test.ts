import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мокируем внешние зависимости до импорта тестируемого модуля
vi.mock('../../api/maxClient.js', () => ({
  editMessage:        vi.fn().mockResolvedValue(undefined),
  buildPostKeyboard:  vi.fn().mockReturnValue(null),
  buildPollButtons:   vi.fn().mockReturnValue([]),
  getChatInfo:        vi.fn(),
  getChatAdmins:      vi.fn(),
}));

vi.mock('../../db/db.js', () => ({
  getChannelByMaxChatId: vi.fn(),
  createPost:            vi.fn(),
  initPostReactions:     vi.fn(),
  createPoll:            vi.fn(),
  upsertUser:            vi.fn(),
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/config.js', () => ({
  config: { maxBotUrl: 'https://max.ru/test_bot', maxApiRateLimit: 25 },
}));

import { onPostCreated } from '../onPostCreated.js';
import * as maxClient from '../../api/maxClient.js';
import * as db from '../../db/db.js';

// ─── Вспомогательные функции ─────────────────────────────────────

function makeUpdate(text = 'Привет', chatId = 'ch_1') {
  return {
    update_type: 'message_created' as const,
    update_id: 1,
    timestamp: Date.now(),
    message: {
      sender: { user_id: 1, name: 'Bot' },
      recipient: { chat_id: chatId, chat_type: 'channel' as const },
      body: { mid: 'msg_1', text, attachments: [] },
      timestamp: Date.now(),
    },
  };
}

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    max_chat_id: 'ch_1',
    is_active: true,
    comments_enabled: true,
    post_reactions: [] as string[],
    poll_enabled: false,
    poll_question: null,
    poll_options: null,
    ...overrides,
  };
}

function makePost(id = 42) {
  return {
    id,
    channel_id: 10,
    max_message_id: 'msg_1',
    post_reactions: [] as string[],
  };
}

// ─── Тесты ───────────────────────────────────────────────────────

describe('onPostCreated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.createPost).mockResolvedValue(makePost() as any);
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(makeChannel() as any);
    vi.mocked(db.createPoll).mockResolvedValue({ id: 1, post_id: 42 } as any);
    vi.mocked(maxClient.buildPostKeyboard).mockReturnValue(null);
    vi.mocked(maxClient.buildPollButtons).mockReturnValue([]);
  });

  it('игнорирует сообщения не из канала', async () => {
    const update = makeUpdate('текст');
    (update.message.recipient as any).chat_type = 'dialog';
    await onPostCreated(update);
    expect(db.getChannelByMaxChatId).not.toHaveBeenCalled();
  });

  it('игнорирует неактивный канал', async () => {
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(
      makeChannel({ is_active: false }) as any
    );
    await onPostCreated(makeUpdate());
    expect(db.createPost).not.toHaveBeenCalled();
  });

  it('пропускает дубль поста (createPost вернул undefined)', async () => {
    vi.mocked(db.createPost).mockResolvedValue(undefined);
    await onPostCreated(makeUpdate());
    expect(db.createPoll).not.toHaveBeenCalled();
    expect(maxClient.editMessage).not.toHaveBeenCalled();
  });

  it('НЕ создаёт опрос когда poll_enabled = false', async () => {
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(
      makeChannel({ poll_enabled: false }) as any
    );
    await onPostCreated(makeUpdate());
    expect(db.createPoll).not.toHaveBeenCalled();
  });

  it('НЕ создаёт опрос когда poll_enabled = true но question пустой', async () => {
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(
      makeChannel({
        poll_enabled: true,
        poll_question: null,
        poll_options: [{ text: 'А' }, { text: 'Б' }],
      }) as any
    );
    await onPostCreated(makeUpdate());
    expect(db.createPoll).not.toHaveBeenCalled();
  });

  it('НЕ создаёт опрос когда poll_enabled = true но options < 2', async () => {
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(
      makeChannel({
        poll_enabled: true,
        poll_question: 'Что выберешь?',
        poll_options: [{ text: 'Только один' }],
      }) as any
    );
    await onPostCreated(makeUpdate());
    expect(db.createPoll).not.toHaveBeenCalled();
  });

  it('создаёт опрос из настроек канала когда всё заполнено', async () => {
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(
      makeChannel({
        poll_enabled: true,
        poll_question: 'Лучший вариант?',
        poll_options: [{ text: 'А' }, { text: 'Б' }, { text: 'В' }],
      }) as any
    );
    vi.mocked(maxClient.buildPollButtons).mockReturnValue([['btn1'], ['btn2'], ['btn3']]);

    await onPostCreated(makeUpdate());

    expect(db.createPoll).toHaveBeenCalledWith(42, 'Лучший вариант?', ['А', 'Б', 'В']);
    expect(maxClient.buildPollButtons).toHaveBeenCalledWith(42, ['А', 'Б', 'В'], [0, 0, 0], undefined, 'Лучший вариант?');
  });

  it('передаёт poll_question/options в createPost как снапшот', async () => {
    const pollOptions = [{ text: 'А' }, { text: 'Б' }];
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(
      makeChannel({
        poll_enabled: true,
        poll_question: 'Снапшот?',
        poll_options: pollOptions,
      }) as any
    );

    await onPostCreated(makeUpdate());

    expect(db.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        poll_question: 'Снапшот?',
        poll_options: pollOptions,
      })
    );
  });

  it('сохраняет poll_question=null когда опрос выключен', async () => {
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(
      makeChannel({ poll_enabled: false }) as any
    );

    await onPostCreated(makeUpdate());

    expect(db.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ poll_question: null, poll_options: null })
    );
  });

  it('инициализирует счётчики реакций если они настроены', async () => {
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(
      makeChannel({ post_reactions: ['❤️', '👍'] }) as any
    );

    await onPostCreated(makeUpdate());

    expect(db.initPostReactions).toHaveBeenCalledWith(42, ['❤️', '👍']);
  });

  it('передаёт pollButtons в buildPostKeyboard', async () => {
    const mockButtons = [['row1'], ['row2']];
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(
      makeChannel({
        poll_enabled: true,
        poll_question: 'Вопрос?',
        poll_options: [{ text: 'А' }, { text: 'Б' }],
      }) as any
    );
    vi.mocked(maxClient.buildPollButtons).mockReturnValue(mockButtons as any);

    await onPostCreated(makeUpdate());

    expect(maxClient.buildPostKeyboard).toHaveBeenCalledWith(
      42, 0, [], true, undefined, mockButtons
    );
  });

  it('вызывает editMessage с медиа-вложениями без клавиатур', async () => {
    const update = makeUpdate('текст');
    (update.message.body as any).attachments = [
      { type: 'image', payload: { url: 'http://img' } },
      { type: 'inline_keyboard', buttons: [] }, // должен отфильтроваться
    ];

    await onPostCreated(update);

    const callArgs = vi.mocked(maxClient.editMessage).mock.calls[0];
    const attachments = callArgs[1].attachments as any[];
    expect(attachments.some((a: any) => a.type === 'inline_keyboard')).toBe(false);
    expect(attachments.some((a: any) => a.type === 'image')).toBe(true);
  });
});
