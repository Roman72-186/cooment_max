// Прозрачный реверс-прокси: workers.dev → sushi-house-39.online
// Все запросы (статика мини-аппа + /api/*) проксируются к VPS.
// Пользователь в России видит только workers.dev (не заблокирован РКН).

const ORIGIN = 'https://sushi-house-39.online';

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Init-Data, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Переписываем hostname на VPS, остальное (path, query, protocol) — без изменений
    const url = new URL(request.url);
    url.hostname = new URL(ORIGIN).hostname;
    url.protocol = 'https:';
    url.port = '';

    const proxiedRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
    });

    let response;
    try {
      response = await fetch(proxiedRequest);
    } catch (err) {
      return new Response('Proxy error: ' + String(err), { status: 502 });
    }

    // Копируем ответ, добавляем CORS-заголовки
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
