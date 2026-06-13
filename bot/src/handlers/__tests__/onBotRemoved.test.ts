import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/db.js', () => ({
  deactivateChannel: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { onBotRemoved } from '../onBotRemoved.js';
import * as db from '../../db/db.js';

describe('onBotRemoved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.deactivateChannel).mockResolvedValue(undefined);
  });

  it('деактивирует канал по top-level chat_id', async () => {
    await onBotRemoved({
      update_type: 'bot_removed',
      update_id: 1,
      chat_id: 'ch_123',
      chat_type: 'channel',
    } as any);

    expect(db.deactivateChannel).toHaveBeenCalledWith('ch_123');
  });

  it('деактивирует канал по message.recipient.chat_id', async () => {
    await onBotRemoved({
      update_type: 'bot_removed',
      update_id: 1,
      message: {
        recipient: { chat_id: 'ch_456', chat_type: 'channel' },
      },
    } as any);

    expect(db.deactivateChannel).toHaveBeenCalledWith('ch_456');
  });

  it('игнорирует не-каналы', async () => {
    await onBotRemoved({
      update_type: 'bot_removed',
      update_id: 1,
      chat_id: 'group_1',
      chat_type: 'group',
    } as any);

    expect(db.deactivateChannel).not.toHaveBeenCalled();
  });
});
