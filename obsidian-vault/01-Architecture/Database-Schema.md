# Схема базы данных

PostgreSQL 15. Файл схемы: `bot/src/db/schema.sql` (копия: `infra/init.sql`).

## Таблицы

### users
Владельцы каналов и комментаторы.

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | SERIAL PK | Внутренний ID |
| max_user_id | BIGINT UNIQUE | ID пользователя в MAX |
| name | VARCHAR(255) | Отображаемое имя |
| username | VARCHAR(255) | @юзернейм |
| plan | VARCHAR(10) | `free` или `pro` |
| plan_expires | TIMESTAMP | Когда истекает PRO |
| ref_code | VARCHAR(20) UNIQUE | Реферальный код |
| referred_by | INT FK→users.id | Кто пригласил |
| created_at | TIMESTAMP | Дата регистрации |

### channels
Каналы, где установлен бот.

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | SERIAL PK | |
| owner_id | INT FK→users.id | Владелец канала |
| max_chat_id | BIGINT UNIQUE | ID чата в MAX |
| channel_name | VARCHAR(255) | Название канала |
| channel_type | VARCHAR(10) | `public` или `private` |
| discussion_chat_id | BIGINT | ID скрытого группового чата (хранилище комментариев) |
| is_active | BOOLEAN | Бот активен в канале |
| post_count | INT | Счётчик постов |
| total_comments | INT | Счётчик всех комментариев |
| connected_at | TIMESTAMP | Дата подключения |

### posts
Каждый обработанный пост канала.

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | SERIAL PK | |
| channel_id | INT FK→channels.id | |
| max_message_id | BIGINT | ID сообщения в MAX |
| discussion_msg_id | BIGINT | ID репоста в скрытом чате |
| text_preview | TEXT | Первые ~200 символов поста |
| view_count | INT | Просмотры |
| comment_count | INT | Кол-во комментариев (кэш) |
| published_at | TIMESTAMP | |

### comments
Комментарии с поддержкой вложенности.

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | SERIAL PK | |
| post_id | INT FK→posts.id | |
| author_id | INT FK→users.id | |
| parent_id | INT FK→comments.id | NULL = корневой, иначе — ответ |
| text | VARCHAR(2000) | Текст комментария |
| is_hidden | BOOLEAN | Скрыт модератором |
| created_at | TIMESTAMP | |

### payments

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | SERIAL PK | |
| user_id | INT FK→users.id | |
| yookassa_id | VARCHAR(255) | ID платежа в ЮКасса |
| amount_rub | NUMERIC(10,2) | Сумма в рублях |
| plan | VARCHAR(10) | Купленный план |
| status | VARCHAR(20) | `pending`, `succeeded`, `cancelled` |
| created_at | TIMESTAMP | |

### analytics_daily
Агрегированная статистика (заполняется ночным job'ом).

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | SERIAL PK | |
| channel_id | INT FK→channels.id | |
| date | DATE | День агрегации |
| views | INT | Просмотры за день |
| comments | INT | Комментарии за день |
| reactions | INT | Реакции за день |

## Индексы

```sql
CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_posts_channel_id ON posts(channel_id);
CREATE INDEX idx_analytics_channel_date ON analytics_daily(channel_id, date);
CREATE INDEX idx_channels_owner_id ON channels(owner_id);
```
