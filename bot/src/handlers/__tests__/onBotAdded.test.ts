import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мокируем внешние зависимости до импорта тестируемого модуля
vi.mock('../../api/maxClient.js', () => ({
  getChatInfo:        vi.fn(),
  getChatAdmins:      vi.fn(),
  createChat:         vi.fn(),
  sendMessageToUser:  vi.fn(),
}));

vi.mock('../../db/db.js', () => ({
  upsertUser:             vi.fn(),
  upsertChannel:          vi.fn(),
  getChannelByMaxChatId:  vi.fn(),
  pool: { query: vi.fn() },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { onBotAdded } from '../onBotAdded.js';
import * as maxClient from '../../api/maxClient.js';
import * as db from '../../db/db.js';

// ─── Вспомогательные функции ─────────────────────────────────────

function makeSender(userId = 100, name = 'Alice') {
  return { user_id: userId, name, username: 'alice' };
}

function makeUpdate(chatType = 'channel', chatId = 'ch_123', sender = makeSender()) {
  return {
    update_type: 'bot_added',
    update_id: 1,
    message: {
      sender,
      recipient: { chat_id: chatId, chat_type: chatType },
      body: {},
    },
  };
}

// ─── Тесты ───────────────────────────────────────────────────────

describe('onBotAdded', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Дефолтные значения моков
    vi.mocked(maxClient.getChatInfo).mockResolvedValue({
      chat_id: 'ch_123', title: 'Мой канал', type: 'channel',
    });
    vi.mocked(maxClient.getChatAdmins).mockResolvedValue({
      members: [
        { user_id: 200, name: 'Bob', username: 'bob', is_owner: true  },
        { user_id: 100, name: 'Alice', username: 'alice', is_owner: false },
      ],
    });
    vi.mocked(maxClient.createChat).mockResolvedValue({ chat_id: 'disc_456' });
    vi.mocked(maxClient.sendMessageToUser).mockResolvedValue(undefined as any);
    vi.mocked(db.upsertUser).mockResolvedValue({ id: 1, max_user_id: 200, name: 'Bob' } as any);
    vi.mocked(db.upsertChannel).mockResolvedValue({ id: 1 } as any);
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(null); // новый канал по умолчанию
    vi.mocked(db.pool.query).mockResolvedValue({ rows: [] } as any);
  });

  // ─── Фильтрация не-каналов ──────────────────────────────────

  it('игнорирует событие без поля message', async () => {
    await onBotAdded({ update_type: 'bot_added', update_id: 1 } as any);
    expect(maxClient.getChatInfo).not.toHaveBeenCalled();
  });

  it('игнорирует добавление в группу', async () => {
    await onBotAdded(makeUpdate('group') as any);
    expect(maxClient.getChatInfo).not.toHaveBeenCalled();
  });

  it('игнорирует добавление в личку', async () => {
    await onBotAdded(makeUpdate('dialog') as any);
    expect(maxClient.getChatInfo).not.toHaveBeenCalled();
  });

  // ─── Определение владельца ──────────────────────────────────

  it('определяет owner через getChatAdmins (is_owner=true), а не через sender', async () => {
    await onBotAdded(makeUpdate() as any); // sender = Alice (100), owner = Bob (200)
    expect(db.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ max_user_id: 200, name: 'Bob' })
    );
  });

  it('отправляет уведомление owner-у (200), не sender-у (100)', async () => {
    await onBotAdded(makeUpdate() as any);
    expect(maxClient.sendMessageToUser).toHaveBeenCalledWith(
      200,
      expect.stringContaining('Мой канал')
    );
  });

  it('fallback на sender если getChatAdmins упал', async () => {
    vi.mocked(maxClient.getChatAdmins).mockRejectedValue(new Error('API Error'));
    await onBotAdded(makeUpdate() as any);
    // sender = Alice (user_id: 100)
    expect(db.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ max_user_id: 100, name: 'Alice' })
    );
  });

  it('берёт первого в списке если нет is_owner=true', async () => {
    vi.mocked(maxClient.getChatAdmins).mockResolvedValue({
      members: [
        { user_id: 300, name: 'Carol', username: 'carol' }, // первый в списке, без is_owner
        { user_id: 100, name: 'Alice', username: 'alice' },
      ],
    });
    await onBotAdded(makeUpdate() as any);
    expect(db.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ max_user_id: 300, name: 'Carol' })
    );
  });

  // ─── Новый канал ────────────────────────────────────────────

  it('вызывает upsertChannel для нового канала (без createChat — MAX API не поддерживает)', async () => {
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(null);
    await onBotAdded(makeUpdate() as any);
    expect(db.upsertChannel).toHaveBeenCalled();
    expect(maxClient.createChat).not.toHaveBeenCalled();
  });

  it('сохраняет канал в БД без discussion_chat_id', async () => {
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue(null);
    await onBotAdded(makeUpdate() as any);
    expect(db.upsertChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        max_chat_id:  'ch_123',
        channel_name: 'Мой канал',
      })
    );
    const arg = vi.mocked(db.upsertChannel).mock.calls[0][0];
    expect(arg).not.toHaveProperty('discussion_chat_id');
  });

  it('сохраняет channel_name = null если title пустой', async () => {
    vi.mocked(maxClient.getChatInfo).mockResolvedValue({
      chat_id: 'ch_123', title: undefined as any, type: 'channel',
    });
    await onBotAdded(makeUpdate() as any);
    expect(db.upsertChannel).toHaveBeenCalledWith(
      expect.objectContaining({ channel_name: null })
    );
    expect(maxClient.createChat).not.toHaveBeenCalled();
  });

  // ─── Реактивация существующего канала ───────────────────────

  it('НЕ создаёт новый discussion chat для существующего канала', async () => {
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue({ id: 5, max_chat_id: 'ch_123' } as any);
    await onBotAdded(makeUpdate() as any);
    expect(maxClient.createChat).not.toHaveBeenCalled();
  });

  it('НЕ вызывает upsertChannel при реактивации', async () => {
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue({ id: 5, max_chat_id: 'ch_123' } as any);
    await onBotAdded(makeUpdate() as any);
    expect(db.upsertChannel).not.toHaveBeenCalled();
  });

  it('при реактивации ставит is_active = true через pool.query', async () => {
    vi.mocked(db.getChannelByMaxChatId).mockResolvedValue({ id: 5, max_chat_id: 'ch_123' } as any);
    await onBotAdded(makeUpdate() as any);
    expect(db.pool.query).toHaveBeenCalledWith(
      expect.stringContaining('is_active = true'),
      expect.arrayContaining(['ch_123'])
    );
  });
});
