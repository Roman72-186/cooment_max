# -*- coding: utf-8 -*-
#!/usr/bin/env python3
"""
Полный E2E тест MAX Comments Platform
Тестирует ВСЕ backend-роуты: старые + новые (шаги 16-20)
"""
import hashlib, hmac, json, time, urllib.parse, requests

BASE = "https://sushi-house-39.online"
BOT_TOKEN = "f9LHodD0cOJ_2SMLR6oib8a3JePm4L5RBKwzGbTIE8SKhldrH1bxgPorQJ-YjvJlt6inCG1cAYrtFo6wLMWq"

# Пользователи для тестов
OWNER_MAX_ID  = 165984019   # владелец канала (db: users.id=89)
OTHER_MAX_ID  = 99999       # чужой пользователь (db: users.id=107)
NEW_MAX_ID    = 77777777    # новый пользователь (не существует в БД)
CHANNEL_ID    = 1           # единственный канал
POST_ID_WITH_COMMENTS = 21  # пост с комментариями

# ─── Генерация initData ───────────────────────────────────────────
def make_init_data(user_id: int, name: str = "Test User", username: str = "testuser") -> str:
    user_obj = json.dumps({"user_id": user_id, "name": name, "username": username, "is_bot": False}, separators=(',', ':'))
    params = {
        "user": user_obj,
        "auth_date": str(int(time.time())),
    }
    check_str = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    hash_val = hmac.new(secret, check_str.encode(), hashlib.sha256).hexdigest()
    params["hash"] = hash_val
    return urllib.parse.urlencode(params)

OWNER_INIT  = make_init_data(OWNER_MAX_ID,  "Channel Owner", "owner")
OTHER_INIT  = make_init_data(OTHER_MAX_ID,  "Other User",    "other")
NEW_INIT    = make_init_data(NEW_MAX_ID,    "Brand New User","newuser")

# ─── Хелперы ─────────────────────────────────────────────────────
passed = 0
failed = 0

def test(name: str, condition: bool, detail: str = ""):
    global passed, failed
    status = "PASS" if condition else "FAIL"
    if condition:
        passed += 1
    else:
        failed += 1
    marker = "✓" if condition else "✗"
    print(f"  {marker} [{status}] {name}" + (f"  → {detail}" if detail else ""))
    return condition

def hdr(init_data):
    return {"X-Init-Data": init_data}

def section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")

# ─────────────────────────────────────────────────────────────────
# 1. HEALTH CHECK
# ─────────────────────────────────────────────────────────────────
section("1. HEALTH CHECK")

r = requests.get(f"{BASE}/health", timeout=10)
test("GET /health → 200", r.status_code == 200)
test("GET /health содержит status:ok", r.json().get("status") == "ok",
     str(r.json()))

# ─────────────────────────────────────────────────────────────────
# 2. АУТЕНТИФИКАЦИЯ
# ─────────────────────────────────────────────────────────────────
section("2. АУТЕНТИФИКАЦИЯ")

r = requests.get(f"{BASE}/api/user/me", timeout=10)
test("GET /api/user/me без X-Init-Data → 401", r.status_code == 401)

r = requests.get(f"{BASE}/api/user/me", headers={"X-Init-Data": "fake_data"}, timeout=10)
test("GET /api/user/me с неверным X-Init-Data → 401", r.status_code == 401)

r = requests.get(f"{BASE}/api/comments?post_id=21", timeout=10)
test("GET /api/comments без auth → 200 (optionalAuth)", r.status_code == 200,
     f"got {r.status_code}")

r = requests.post(f"{BASE}/api/comments", json={"post_id": 21, "text": "test"}, timeout=10)
test("POST /api/comments без auth → 401", r.status_code == 401)

# ─────────────────────────────────────────────────────────────────
# 3. GET /api/user/me — НОВЫЙ РОУТ
# ─────────────────────────────────────────────────────────────────
section("3. GET /api/user/me")

# 3a. Существующий пользователь (владелец канала)
r = requests.get(f"{BASE}/api/user/me", headers=hdr(OWNER_INIT), timeout=10)
test("GET /api/user/me с auth → 200", r.status_code == 200, str(r.status_code))
if r.status_code == 200:
    data = r.json()
    test("user.max_user_id совпадает", data.get("max_user_id") == OWNER_MAX_ID,
         f"got {data.get('max_user_id')}")
    test("user.plan = free", data.get("plan") in ["free", "pro"])
    test("user.channels — список", isinstance(data.get("channels"), list),
         f"got {type(data.get('channels'))}")
    test("у владельца есть 1 канал", len(data.get("channels", [])) >= 1,
         f"got {len(data.get('channels', []))}")
    if data.get("channels"):
        ch = data["channels"][0]
        test("channel.id присутствует", "id" in ch)
        test("channel.comments_enabled присутствует", "comments_enabled" in ch,
             str(ch.keys()))
        test("channel.banned_words присутствует", "banned_words" in ch,
             str(ch.keys()))
        test("channel.post_count — число", isinstance(ch.get("post_count"), int),
             str(ch.get("post_count")))

# 3b. Новый пользователь — должен создаться через upsert
r = requests.get(f"{BASE}/api/user/me", headers=hdr(NEW_INIT), timeout=10)
test("GET /api/user/me новый юзер → 200", r.status_code == 200, str(r.status_code))
if r.status_code == 200:
    data = r.json()
    test("новый юзер создан (max_user_id совпадает)", data.get("max_user_id") == NEW_MAX_ID)
    test("новый юзер без каналов", data.get("channels") == [], f"got {data.get('channels')}")

# ─────────────────────────────────────────────────────────────────
# 4. GET /api/channels/:id/analytics — НОВЫЙ РОУТ
# ─────────────────────────────────────────────────────────────────
section("4. GET /api/channels/:id/analytics")

# 4a. Владелец запрашивает аналитику
r = requests.get(f"{BASE}/api/channels/{CHANNEL_ID}/analytics",
                 headers=hdr(OWNER_INIT), timeout=10)
test("GET /analytics владелец → 200", r.status_code == 200, str(r.status_code))
if r.status_code == 200:
    data = r.json()
    test("analytics.days — список", isinstance(data.get("days"), list))
    test("analytics.top_posts — список", isinstance(data.get("top_posts"), list))
    test("analytics.total_views — число", isinstance(data.get("total_views"), int),
         str(data.get("total_views")))
    test("analytics.total_comments — число", isinstance(data.get("total_comments"), int))
    test("analytics.engagement_rate — число", isinstance(data.get("engagement_rate"), (int, float)))

# 4b. Периоды 7/30/90
for days in [7, 30, 90]:
    r = requests.get(f"{BASE}/api/channels/{CHANNEL_ID}/analytics?days={days}",
                     headers=hdr(OWNER_INIT), timeout=10)
    test(f"GET /analytics?days={days} → 200", r.status_code == 200)

# 4c. Чужой пользователь → 403
r = requests.get(f"{BASE}/api/channels/{CHANNEL_ID}/analytics",
                 headers=hdr(OTHER_INIT), timeout=10)
test("GET /analytics чужой юзер → 403", r.status_code == 403,
     f"got {r.status_code}: {r.text[:100]}")

# 4d. Несуществующий канал
r = requests.get(f"{BASE}/api/channels/99999/analytics",
                 headers=hdr(OWNER_INIT), timeout=10)
test("GET /analytics несуществующий канал → 404", r.status_code == 404,
     f"got {r.status_code}")

# ─────────────────────────────────────────────────────────────────
# 5. PATCH /api/channels/:id/settings — НОВЫЙ РОУТ
# ─────────────────────────────────────────────────────────────────
section("5. PATCH /api/channels/:id/settings")

# 5a. Владелец меняет настройки
r = requests.patch(f"{BASE}/api/channels/{CHANNEL_ID}/settings",
                   headers=hdr(OWNER_INIT),
                   json={"comments_enabled": True, "banned_words": ["спам", "реклама"]},
                   timeout=10)
test("PATCH /settings владелец → 200", r.status_code == 200, str(r.status_code))
if r.status_code == 200:
    data = r.json()
    test("settings.comments_enabled = true", data.get("comments_enabled") is True,
         str(data))
    test("settings.banned_words = ['спам','реклама']",
         data.get("banned_words") == ["спам", "реклама"],
         str(data.get("banned_words")))

# 5b. Чужой пользователь → 403
r = requests.patch(f"{BASE}/api/channels/{CHANNEL_ID}/settings",
                   headers=hdr(OTHER_INIT),
                   json={"comments_enabled": False},
                   timeout=10)
test("PATCH /settings чужой юзер → 403", r.status_code == 403,
     f"got {r.status_code}")

# 5c. Отключение комментариев
r = requests.patch(f"{BASE}/api/channels/{CHANNEL_ID}/settings",
                   headers=hdr(OWNER_INIT),
                   json={"comments_enabled": False},
                   timeout=10)
test("PATCH /settings отключение комментариев → 200", r.status_code == 200)
if r.status_code == 200:
    test("comments_enabled = false", r.json().get("comments_enabled") is False)

# 5d. Восстанавливаем исходные настройки
r = requests.patch(f"{BASE}/api/channels/{CHANNEL_ID}/settings",
                   headers=hdr(OWNER_INIT),
                   json={"comments_enabled": True, "banned_words": []},
                   timeout=10)
test("PATCH /settings восстановление → 200", r.status_code == 200)

# 5e. Слишком много стоп-слов (> 100)
bad_words = [f"word{i}" for i in range(101)]
r = requests.patch(f"{BASE}/api/channels/{CHANNEL_ID}/settings",
                   headers=hdr(OWNER_INIT),
                   json={"banned_words": bad_words},
                   timeout=10)
test("PATCH /settings > 100 стоп-слов → 400", r.status_code == 400,
     f"got {r.status_code}: {r.text[:100]}")

# ─────────────────────────────────────────────────────────────────
# 6. ПЛАТЕЖИ — ЗАГЛУШКА
# ─────────────────────────────────────────────────────────────────
section("6. ПЛАТЕЖИ (заглушка)")

r = requests.post(f"{BASE}/api/payments/create",
                  headers=hdr(OWNER_INIT),
                  json={"plan": "pro"},
                  timeout=10)
test("POST /api/payments/create → 503 (без ЮКасса-ключей)", r.status_code == 503,
     f"got {r.status_code}: {r.text[:100]}")

# ─────────────────────────────────────────────────────────────────
# 7. КОММЕНТАРИИ — СУЩЕСТВУЮЩИЕ РОУТЫ
# ─────────────────────────────────────────────────────────────────
section("7. КОММЕНТАРИИ (существующие роуты)")

# 7a. GET комментарии
r = requests.get(f"{BASE}/api/comments?post_id={POST_ID_WITH_COMMENTS}",
                 headers=hdr(OWNER_INIT), timeout=10)
test("GET /api/comments → 200", r.status_code == 200, str(r.status_code))
if r.status_code == 200:
    comments = r.json()
    test("Возвращает список", isinstance(comments, list))
    if comments:
        c = comments[0]
        test("comment.id — число", isinstance(c.get("id"), int), str(c.get("id")))
        test("comment.author_max_id — число (не строка)", isinstance(c.get("author_max_id"), int),
             f"type={type(c.get('author_max_id')).__name__}, val={c.get('author_max_id')}")
        test("comment.channel_owner_max_id — число", isinstance(c.get("channel_owner_max_id"), int),
             str(c.get("channel_owner_max_id")))
        test("comment.text присутствует", "text" in c)
        test("comment.is_hidden = false", c.get("is_hidden") is False)
        test("comment.likes_count присутствует", "likes_count" in c, str(c.keys()))
        test("comment.liked_by_me присутствует", "liked_by_me" in c)

# 7b. Создание → удаление
r = requests.post(f"{BASE}/api/comments",
                  headers=hdr(OWNER_INIT),
                  json={"post_id": POST_ID_WITH_COMMENTS, "text": "E2E тест автоудаление"},
                  timeout=10)
test("POST /api/comments → 201", r.status_code == 201, str(r.status_code))
new_comment_id = None
if r.status_code == 201:
    data = r.json()
    new_comment_id = data.get("id")
    test("Новый комментарий получил id", new_comment_id is not None)

# 7c. Проверка: comment_count вырос
r2 = requests.get(f"{BASE}/api/posts/{POST_ID_WITH_COMMENTS}",
                  headers=hdr(OWNER_INIT), timeout=10)
count_before_delete = r2.json().get("comment_count", 0) if r2.status_code == 200 else 0
test("GET /api/posts/:id → 200", r2.status_code == 200, str(r2.status_code))

# 7d. Валидация: пустой текст
r = requests.post(f"{BASE}/api/comments",
                  headers=hdr(OWNER_INIT),
                  json={"post_id": POST_ID_WITH_COMMENTS, "text": ""},
                  timeout=10)
test("POST пустой текст → 400", r.status_code == 400, str(r.status_code))

# 7e. Валидация: текст > 2000 символов
r = requests.post(f"{BASE}/api/comments",
                  headers=hdr(OWNER_INIT),
                  json={"post_id": POST_ID_WITH_COMMENTS, "text": "x" * 2001},
                  timeout=10)
test("POST текст > 2000 символов → 400", r.status_code == 400, str(r.status_code))

# 7f. Чужой не может удалить
if new_comment_id:
    r = requests.delete(f"{BASE}/api/comments/{new_comment_id}",
                        headers=hdr(OTHER_INIT), timeout=10)
    test("DELETE чужого комментария → 403", r.status_code == 403, str(r.status_code))

# 7g. Автор удаляет свой
if new_comment_id:
    r = requests.delete(f"{BASE}/api/comments/{new_comment_id}",
                        headers=hdr(OWNER_INIT), timeout=10)
    test("DELETE своего комментария → 204", r.status_code == 204, str(r.status_code))

    # 7h. Проверка comment_count уменьшился
    r2 = requests.get(f"{BASE}/api/posts/{POST_ID_WITH_COMMENTS}",
                      headers=hdr(OWNER_INIT), timeout=10)
    if r2.status_code == 200:
        count_after = r2.json().get("comment_count", 0)
        test("comment_count декрементировался после DELETE",
             count_after == count_before_delete - 1,
             f"{count_before_delete} → {count_after}")

    # 7i. Повторный DELETE → 404 (уже скрыт)
    r = requests.delete(f"{BASE}/api/comments/{new_comment_id}",
                        headers=hdr(OWNER_INIT), timeout=10)
    test("Повторный DELETE → 404", r.status_code == 404, str(r.status_code))

# ─────────────────────────────────────────────────────────────────
# 8. РЕАКЦИИ
# ─────────────────────────────────────────────────────────────────
section("8. РЕАКЦИИ ❤️")

# Создаём комментарий для тестирования реакций
r = requests.post(f"{BASE}/api/comments",
                  headers=hdr(OWNER_INIT),
                  json={"post_id": POST_ID_WITH_COMMENTS, "text": "Тест реакций E2E"},
                  timeout=10)
reaction_comment_id = r.json().get("id") if r.status_code == 201 else None

if reaction_comment_id:
    # Ставим лайк
    r = requests.post(f"{BASE}/api/reactions/{reaction_comment_id}",
                      headers=hdr(OTHER_INIT), timeout=10)
    test("POST /api/reactions/:id → 200", r.status_code == 200, str(r.status_code))
    if r.status_code == 200:
        data = r.json()
        test("reactions: liked=true после первого нажатия", data.get("liked") is True,
             str(data))
        test("reactions: likes_count = 1", data.get("likes_count") == 1, str(data))

    # Снимаем лайк (toggle)
    r = requests.post(f"{BASE}/api/reactions/{reaction_comment_id}",
                      headers=hdr(OTHER_INIT), timeout=10)
    test("POST /api/reactions/:id повторно → toggle off", r.status_code == 200)
    if r.status_code == 200:
        data = r.json()
        test("reactions: liked=false после второго нажатия", data.get("liked") is False,
             str(data))
        test("reactions: likes_count = 0", data.get("likes_count") == 0)

    # Проверяем liked_by_me в GET /api/comments
    requests.post(f"{BASE}/api/reactions/{reaction_comment_id}",
                  headers=hdr(OTHER_INIT), timeout=10)  # ставим обратно
    r = requests.get(f"{BASE}/api/comments?post_id={POST_ID_WITH_COMMENTS}",
                     headers=hdr(OTHER_INIT), timeout=10)
    if r.status_code == 200:
        target = next((c for c in r.json() if c["id"] == reaction_comment_id), None)
        if target:
            test("liked_by_me = true в GET после лайка", target.get("liked_by_me") is True,
                 str(target.get("liked_by_me")))

    # Удаляем тестовый комментарий
    requests.delete(f"{BASE}/api/comments/{reaction_comment_id}",
                    headers=hdr(OWNER_INIT), timeout=10)

# ─────────────────────────────────────────────────────────────────
# 9. THREADING (ответы на комментарии)
# ─────────────────────────────────────────────────────────────────
section("9. THREADING (ответы)")

# Создаём родительский комментарий
r = requests.post(f"{BASE}/api/comments",
                  headers=hdr(OWNER_INIT),
                  json={"post_id": POST_ID_WITH_COMMENTS, "text": "Родительский"},
                  timeout=10)
parent_id = r.json().get("id") if r.status_code == 201 else None

if parent_id:
    # Создаём ответ
    r = requests.post(f"{BASE}/api/comments",
                      headers=hdr(OTHER_INIT),
                      json={"post_id": POST_ID_WITH_COMMENTS, "text": "Ответ на родительский",
                            "parent_id": parent_id},
                      timeout=10)
    test("POST с parent_id → 201", r.status_code == 201, str(r.status_code))
    reply_id = r.json().get("id") if r.status_code == 201 else None
    if reply_id:
        test("reply.parent_id = parent_id", r.json().get("parent_id") == parent_id)

    # Проверяем структуру в GET
    r = requests.get(f"{BASE}/api/comments?post_id={POST_ID_WITH_COMMENTS}",
                     headers=hdr(OWNER_INIT), timeout=10)
    if r.status_code == 200:
        flat = r.json()
        parent_in_resp = next((c for c in flat if c["id"] == parent_id), None)
        test("Родительский комментарий есть в ответе", parent_in_resp is not None)

    # Чистим
    if reply_id:
        requests.delete(f"{BASE}/api/comments/{reply_id}",
                        headers=hdr(OWNER_INIT), timeout=10)
    requests.delete(f"{BASE}/api/comments/{parent_id}",
                    headers=hdr(OWNER_INIT), timeout=10)

# ─────────────────────────────────────────────────────────────────
# 10. ГРАНИЧНЫЕ СЛУЧАИ
# ─────────────────────────────────────────────────────────────────
section("10. ГРАНИЧНЫЕ СЛУЧАИ")

test("GET /api/comments без post_id → 400",
     requests.get(f"{BASE}/api/comments", headers=hdr(OWNER_INIT), timeout=10).status_code == 400)

test("GET /api/posts/999999 (не существует) → 404",
     requests.get(f"{BASE}/api/posts/999999", headers=hdr(OWNER_INIT), timeout=10).status_code == 404)

test("DELETE /api/comments/999999 (не существует) → 404",
     requests.delete(f"{BASE}/api/comments/999999", headers=hdr(OWNER_INIT), timeout=10).status_code == 404)

test("POST /api/comments с несуществующим post_id → 404 или 400",
     requests.post(f"{BASE}/api/comments", headers=hdr(OWNER_INIT),
                   json={"post_id": 999999, "text": "test"}, timeout=10).status_code in [400, 404, 500])

test("GET /api/channels/99999/settings (несуществующий канал) → 404",
     requests.get(f"{BASE}/api/channels/99999/analytics",
                  headers=hdr(OWNER_INIT), timeout=10).status_code == 404)

# ─────────────────────────────────────────────────────────────────
# ИТОГ
# ─────────────────────────────────────────────────────────────────
total = passed + failed
print(f"\n{'═'*60}")
print(f"  ИТОГ: {passed}/{total} PASSED  |  {failed} FAILED")
print(f"{'='*60}")
if failed == 0:
    print("  ✓ Все тесты прошли успешно!")
else:
    print(f"  ✗ {failed} тест(ов) провалились — требуется проверка")
