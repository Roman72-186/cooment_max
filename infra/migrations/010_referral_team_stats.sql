-- Гарантируем персональную реферальную ссылку для старых пользователей.
-- Доступ к реферальной программе проверяется в backend/bot: только активный купленный PRO.

UPDATE users
   SET ref_code = substr(md5(id::text || ':' || max_user_id::text), 1, 8)
 WHERE ref_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
