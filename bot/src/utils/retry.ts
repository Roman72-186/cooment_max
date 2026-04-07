// Обёртка для повторных попыток при ошибках API

import { logger } from './logger.js';

interface RetryOptions {
  attempts?: number;      // максимальное число попыток (по умолчанию 3)
  delayMs?: number;       // задержка между попытками в мс (по умолчанию 1000)
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { attempts = 3, delayMs = 1000 } = options;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === attempts) {
        // Все попытки исчерпаны — пробрасываем ошибку
        throw err;
      }
      logger.warn(`Попытка ${attempt}/${attempts} не удалась, повтор через ${delayMs}мс`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Никогда не достигается, но TypeScript требует
  throw new Error('withRetry: неожиданное завершение');
}
