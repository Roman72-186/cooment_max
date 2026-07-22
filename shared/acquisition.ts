// Разбор источника привлечения пользователя из startapp/start_param.
// Общий для бота (bot_started) и backend (X-Start-Param при открытии Mini App).

export interface Acquisition {
  source: string;         // 'referral' | 'channel' | 'utm' | 'notify' | 'direct'
  detail: string | null;  // ref-код, "post_<id>" (уточняется вызывающей стороной до канала), "utm_source:campaign" и т.д.
}

export function parseAcquisition(startParam: string | null | undefined): Acquisition {
  if (!startParam) return { source: 'direct', detail: null };

  const ref = startParam.match(/^ref_([A-Za-z0-9]+)$/);
  if (ref) return { source: 'referral', detail: ref[1] };

  // Формат для внешних кампаний/рекламы: utm_<source>_<campaign>
  const utm = startParam.match(/^utm_([a-z0-9]+)_(.+)$/i);
  if (utm) return { source: 'utm', detail: `${utm[1]}:${utm[2]}` };

  const post = startParam.match(/^post_(\d+)/);
  if (post) return { source: 'channel', detail: `post_${post[1]}` };

  if (startParam.startsWith('subscribe_') || startParam === 'notify') {
    return { source: 'notify', detail: startParam };
  }

  // Внутренние deep-link'и (pricing/referrals/inbox/analytics_X/settings_X) —
  // ими пользуется уже существующий пользователь, но на всякий случай сохраняем как есть.
  return { source: 'direct', detail: startParam };
}
