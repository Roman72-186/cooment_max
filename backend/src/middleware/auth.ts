// Валидация MAX Bridge initData через HMAC-SHA256
// Каждый защищённый запрос должен содержать заголовок X-Init-Data
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export interface MaxUser {
  user_id: number;
  name: string;
  username?: string;
  is_bot: boolean;
}

// Расширяем Request чтобы прокинуть пользователя в роуты
declare global {
  namespace Express {
    interface Request {
      maxUser?: MaxUser;
    }
  }
}

// HMAC-секрет для валидации initData — кешируется по значению токена.
// MAX_BOT_TOKEN не меняется в рантайме, но кешируем по ключу на случай тестов,
// где env-переменная может подменяться между кейсами.
const _secretCache = new Map<string, Buffer>();
function getSecret(token: string): Buffer {
  let secret = _secretCache.get(token);
  if (!secret) {
    secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    _secretCache.set(token, secret);
  }
  return secret;
}

function validateInitData(initData: string, token: string): MaxUser | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');

    const checkStr = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secret = getSecret(token);
    const expected = crypto.createHmac('sha256', secret).update(checkStr).digest('hex');

    if (expected !== hash) return null;

    const userStr = params.get('user');
    if (!userStr) return null;

    // MAX initData использует поля id/first_name (как Telegram), не user_id/name
    const raw = JSON.parse(userStr);
    return {
      user_id:  raw.user_id  ?? raw.id,
      name:     raw.name     ?? raw.first_name ?? String(raw.id ?? ''),
      username: raw.username ?? undefined,
      is_bot:   raw.is_bot   ?? false,
    };
  } catch {
    return null;
  }
}

// Middleware: обязательная аутентификация
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const initData = req.headers['x-init-data'] as string | undefined;

  // В dev-режиме пропускаем проверку и используем тестового пользователя
  if (process.env.NODE_ENV !== 'production') {
    req.maxUser = { user_id: 1, name: 'Dev User', is_bot: false };
    next();
    return;
  }

  if (!initData) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', msg: 'requireAuth: нет X-Init-Data', path: req.path }));
    res.status(401).json({ error: 'Требуется аутентификация' });
    return;
  }

  const token = process.env.MAX_BOT_TOKEN ?? '';
  const user = validateInitData(initData, token);

  if (!user) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', msg: 'requireAuth: невалидный initData', path: req.path, initDataSnippet: initData.slice(0, 80) }));
    res.status(401).json({ error: 'Невалидный initData' });
    return;
  }

  req.maxUser = user;
  next();
}

// Middleware: опциональная аутентификация (не блокирует если нет заголовка)
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const initData = req.headers['x-init-data'] as string | undefined;

  if (process.env.NODE_ENV !== 'production') {
    req.maxUser = { user_id: 1, name: 'Dev User', is_bot: false };
    next();
    return;
  }

  if (initData) {
    const token = process.env.MAX_BOT_TOKEN ?? '';
    req.maxUser = validateInitData(initData, token) ?? undefined;
  }

  next();
}
