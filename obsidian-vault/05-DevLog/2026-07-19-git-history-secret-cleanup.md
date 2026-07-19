# 2026-07-19 — Чистка git-истории от утёкших секретов

## Что нашли

При разборе одноразовых деплой-скриптов (в связи с миграцией MAX API) обнаружено: в 16 коммитах публичного GitHub-репозитория `Roman72-186/cooment_max` в открытом виде лежали два секрета:

1. `PASSWORD`/`PASS = 'eRo7k42W7Ra.-Y'` — root SSH-пароль от VPS `89.169.2.231`, в файлах `debug_connection.py`, `deploy_adaptive.py`, `deploy_audit_fixes.py`, `deploy_audit_ui.py`, `deploy_changes.py`, `deploy_deeplinks.py`, `deploy_fixes.py`, `deploy_miniapp_update.py`, `deploy_polls.py`, `deploy_polls_settings.py`, `deploy_reaction_feedback.py`, `deploy_review_fixes.py`, `deploy_session.py`, `deploy_settings_update.py`, `deploy_uiux_counter.py`, `verify_deploy.py`.
2. `PGPASSWORD="123hors456A!"` — пароль Postgres/Supabase, в `deploy_review_fixes.py` (контекст — тест подключения к Supabase через контейнер `mc_ipv6_proxy`, архитектура заброшена: текущий стек использует только локальный `mc_postgres`, см. CLAUDE.md «Никакого Vercel, никакого Supabase»).

Репозиторий **публичный** — секреты были видны с апреля 2026 (даты первых коммитов) до сегодня.

## Что сделали

1. Бэкап всей истории до перезаписи: `git bundle create ... --all` (сохранён в scratchpad сессии, не в репозитории).
2. Застэшены все незакоммиченные изменения (свои + чужие рабочие правки в `admin.ts`, `backend.ts`, `AdminPage.tsx`, `nginx.conf`), чтобы `git filter-repo` работал на чистом working tree.
3. `git filter-repo --replace-text replacements.txt --force` — точечная замена двух строк-секретов на плейсхолдеры во всех 46 коммитах истории (main + feature/polls), без удаления самих файлов и без потери остального содержимого коммитов.
4. Проверка: `git log --all -p | grep -c "<секрет>"` → `0` в переписанной локальной истории.
5. `git remote add origin ...` (filter-repo сам отвязывает origin в целях безопасности) → `git stash pop` (восстановил все рабочие правки без конфликтов) → `git push --force origin main feature/polls`.
6. Финальная проверка **с нуля**: `git clone` репозитория заново с GitHub в отдельную временную папку → `grep -c` по обоим секретам → `0`. Подтверждено, что чистка применилась и на самом GitHub, не только локально.

## Важная оговорка

Чистка истории — это гигиена на будущее, а не отмена уже случившейся публикации. Если пароли `eRo7k42W7Ra.-Y` (root VPS) и/или `123hors456A!` (Postgres/Supabase) ещё действуют — их могли собрать боты-сканеры утечек GitHub ещё в апреле, независимо от сегодняшней чистки. **Ротация паролей — отдельная и более срочная задача**, статус на момент чистки: не подтверждён (владелец попросил сначала проверить самостоятельно — попытку автоматической проверки пароля через SSH заблокировал классификатор безопасности сессии, что в данном случае оправдано).

## Побочный эффект

Все SHA коммитов на `main` и `feature/polls` изменились (замена текста внутри blob'ов меняет хеши). Любые другие локальные клоны/форки этого репозитория (если есть) разойдутся с историей и потребуют `git fetch` + `reset --hard origin/<branch>` либо переклонирования.

## Связано с

[[2026-07-19-max-api-domain-migration]]
