import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/maxClient.js', () => ({
  sendMessageToUser: vi.fn(),
}));

vi.mock('../../db/db.js', () => ({
  upsertUser: vi.fn(),
  pool: { query: vi.fn() },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/config.js', () => ({
  config: { maxBotUrl: 'https://max.ru/testbot' },
}));

import { onBotStarted } from '../onBotStarted.js';
import * as maxClient from '../../api/maxClient.js';
import * as db from '../../db/db.js';

// ─── Вспомогательные функции ─────────────────────────────────────

function makeBotStartedUpdate(userId = 42, name = 'Charlie', payload = '') {
  return {
    update_type: 'bot_started',
    update_id:   1,
    user_id:     userId,
    user:        { user_id: userId, name },
    payload,
  };
}

function makeMessageCreatedUpdate(userId = 55, name = 'Dana', text = '/start') {
  return {
    update_type: 'message_created',
    update_id:   2,
    message: {
      sender:    { user_id: userId, name, username: 'dana' },
      recipient: { chat_id: 'dialog_1', chat_type: 'dialog' },
      body:      { text },
    },
  };
}

// ─── Тесты ───────────────────────────────────────────────────────

describe('onBotStarted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.upsertUser).mockResolvedValue({ id: 1, referred_by: null } as any);
    vi.mocked(maxClient.sendMessageToUser).mockResolvedValue(undefined as any);
    vi.mocked(db.pool.query).mockResolvedValue({ rows: [] } as any);
  });

  // ─── Событие bot_started ────────────────────────────────────

  it('обрабатывает bot_started: берёт userId из update.user_id', async () => {
    await onBotStarted(makeBotStartedUpdate(42, 'Charlie') as any);
    expect(db.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ max_user_id: 42, name: 'Charlie' })
    );
  });

  it('обрабатывает bot_started: отправляет сообщение правильному userId', async () => {
    await onBotStarted(makeBotStartedUpdate(42) as any);
    expect(maxClient.sendMessageToUser).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.any(Array)
    );
  });

  it('не обрабатывает bot_started с userId = 0', async () => {
    await onBotStarted(makeBotStartedUpdate(0) as any);
    expect(db.upsertUser).not.toHaveBeenCalled();
    expect(maxClient.sendMessageToUser).not.toHaveBeenCalled();
  });

  // ─── Команда /start через message_created ───────────────────

  it('обрабатывает /start: берёт userId из message.sender', async () => {
    await onBotStarted(makeMessageCreatedUpdate(55, 'Dana') as any);
    expect(db.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ max_user_id: 55, name: 'Dana' })
    );
  });

  it('обрабатывает /start: отправляет сообщение правильному userId', async () => {
    await onBotStarted(makeMessageCreatedUpdate(55) as any);
    expect(maxClient.sendMessageToUser).toHaveBeenCalledWith(
      55,
      expect.any(String),
      expect.any(Array)
    );
  });

  // ─── Welcome message ────────────────────────────────────────

  it('welcome message содержит имя пользователя', async () => {
    await onBotStarted(makeBotStartedUpdate(1, 'Иван') as any);
    const text = vi.mocked(maxClient.sendMessageToUser).mock.calls[0][1];
    expect(text).toContain('Иван');
  });

  it('кнопка содержит open_app с правильным URL', async () => {
    await onBotStarted(makeBotStartedUpdate(1, 'X') as any);
    const attachments = vi.mocked(maxClient.sendMessageToUser).mock.calls[0][2] as any[];
    expect(attachments[0]).toMatchObject({
      type: 'inline_keyboard',
      payload: {
        buttons: [[expect.objectContaining({
          type:    'open_app',
          web_app: 'https://max.ru/testbot',
        })]],
      },
    });
  });

  // ─── Реферальная ссылка ─────────────────────────────────────

  it('игнорирует реферальный код если referred_by уже есть', async () => {
    vi.mocked(db.upsertUser).mockResolvedValue({ id: 1, referred_by: 99 } as any);
    await onBotStarted(makeBotStartedUpdate(1, 'X', 'ref_ABC123') as any);
    // pool.query на установку реферала не должен вызываться
    expect(db.pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET referred_by'),
      expect.anything()
    );
  });

  it('устанавливает реферальную связь если referred_by = null', async () => {
    vi.mocked(db.upsertUser).mockResolvedValue({ id: 5, referred_by: null } as any);
    // Симулируем что реферер найден
    vi.mocked(db.pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 10 }] } as any)  // SELECT referrer
      .mockResolvedValueOnce({ rows: [] } as any);             // UPDATE referred_by

    await onBotStarted(makeBotStartedUpdate(5, 'New', 'ref_ABC123') as any);

    expect(db.pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ref.ref_code = $1'),
      ['ABC123', 5]
    );
    expect(db.pool.query).toHaveBeenCalledWith(
      expect.stringContaining("p.status = 'succeeded'"),
      ['ABC123', 5]
    );
  });
});
