// E2E тест: создание комментария -> счётчик -> удаление -> декремент
const http = require('http');

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port: 3001,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function pass(label) { console.log('[PASS] ' + label); }
function fail(label) { console.log('[FAIL] ' + label); }
function info(label) { console.log('       ' + label); }

async function main() {
  let r, comment, before, after, after2;

  // 1. Создаём тестовый комментарий
  r = await req('POST', '/api/comments', { post_id: 1, text: 'TEST E2E delete counter' });
  info('POST /api/comments -> HTTP ' + r.status);
  if (r.status !== 201) {
    fail('Ожидали 201, получили ' + r.status + ' body=' + r.body);
    return;
  }
  comment = JSON.parse(r.body);
  info('comment.id=' + comment.id + ' post_id=' + comment.post_id);
  pass('Комментарий создан');

  // 2. comment_count ДО удаления
  r = await req('GET', '/api/posts/1');
  before = r.status === 200 ? JSON.parse(r.body).comment_count : null;
  info('comment_count BEFORE delete: ' + before);

  // 3. Удаляем комментарий
  r = await req('DELETE', '/api/comments/' + comment.id);
  info('DELETE /api/comments/' + comment.id + ' -> HTTP ' + r.status);
  if (r.status === 204) {
    pass('DELETE вернул 204 No Content');
  } else {
    fail('Ожидали 204, получили ' + r.status);
  }

  // 4. comment_count ПОСЛЕ удаления
  r = await req('GET', '/api/posts/1');
  after = r.status === 200 ? JSON.parse(r.body).comment_count : null;
  info('comment_count AFTER delete: ' + after);
  if (before !== null && after !== null) {
    if (before - after === 1) {
      pass('Счётчик уменьшился на 1 (' + before + ' -> ' + after + ')');
    } else {
      fail('Счётчик: было=' + before + ' стало=' + after + ' (ожидали -1)');
    }
  }

  // 5. Повторный DELETE — идемпотентность (счётчик не двигается)
  r = await req('DELETE', '/api/comments/' + comment.id);
  info('Повторный DELETE -> HTTP ' + r.status);
  r = await req('GET', '/api/posts/1');
  after2 = r.status === 200 ? JSON.parse(r.body).comment_count : null;
  if (after2 === after) {
    pass('Идемпотентность: счётчик не изменился (' + after2 + ')');
  } else {
    fail('Двойной декремент! after=' + after + ' after2=' + after2);
  }

  // 6. DELETE несуществующего ID
  r = await req('DELETE', '/api/comments/999999999');
  info('DELETE несущ. id=999999999 -> HTTP ' + r.status);
  if (r.status === 404) {
    pass('Несуществующий комментарий -> 404');
  } else {
    fail('Ожидали 404, получили ' + r.status);
  }

  // 7. Удалённый не появляется в GET
  r = await req('GET', '/api/comments?post_id=1');
  const visible = JSON.parse(r.body).filter((c) => c.id === comment.id);
  if (visible.length === 0) {
    pass('Удалённый комментарий скрыт в GET (is_hidden=true работает)');
  } else {
    fail('Удалённый комментарий всё ещё виден!');
  }

  // 8. POST с пустым текстом — валидация
  r = await req('POST', '/api/comments', { post_id: 1, text: '   ' });
  info('POST пустой текст -> HTTP ' + r.status);
  if (r.status === 400) {
    pass('Пустой текст -> 400 Bad Request');
  } else {
    fail('Ожидали 400, получили ' + r.status);
  }

  // 9. POST со слишком длинным текстом
  r = await req('POST', '/api/comments', { post_id: 1, text: 'x'.repeat(2001) });
  info('POST текст 2001 символ -> HTTP ' + r.status);
  if (r.status === 400) {
    pass('Слишком длинный текст -> 400 Bad Request');
  } else {
    fail('Ожидали 400, получили ' + r.status);
  }
}

main().catch((e) => console.log('[ERROR] ' + e.message));
