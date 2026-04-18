import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import paramiko
from pathlib import Path

HOST = '89.169.2.231'
USER = 'root'
PASS = '***REMOVED-SECRET-SSH-PASSWORD***'
LOCAL = Path(r'C:\Users\User\Desktop\Project\cooment_max')

FILES = [
    # Bot (нужно пересобрать mc_bot)
    (LOCAL / 'bot' / 'src' / 'api' / 'maxClient.ts',
     '/opt/max-comments/bot/src/api/maxClient.ts'),
    (LOCAL / 'bot' / 'src' / 'jobs' / 'sendNotifications.ts',
     '/opt/max-comments/bot/src/jobs/sendNotifications.ts'),
    # Mini App (нужно пересобрать mc_nginx)
    (LOCAL / 'miniapp' / 'src' / 'App.tsx',
     '/opt/max-comments/miniapp/src/App.tsx'),
    (LOCAL / 'miniapp' / 'src' / 'store' / 'useAppStore.ts',
     '/opt/max-comments/miniapp/src/store/useAppStore.ts'),
    (LOCAL / 'miniapp' / 'src' / 'pages' / 'CommentsPage.tsx',
     '/opt/max-comments/miniapp/src/pages/CommentsPage.tsx'),
    (LOCAL / 'miniapp' / 'src' / 'components' / 'CommentCard.tsx',
     '/opt/max-comments/miniapp/src/components/CommentCard.tsx'),
    (LOCAL / 'miniapp' / 'src' / 'styles' / 'global.css',
     '/opt/max-comments/miniapp/src/styles/global.css'),
]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, look_for_keys=False)
sftp = ssh.open_sftp()

for local_path, remote in FILES:
    content = local_path.read_bytes()
    with sftp.open(remote, 'wb') as f:
        f.write(content)
    print(f'OK  {remote}')

sftp.close()

# Пересобираем bot и nginx
for target in ['mc_bot', 'mc_nginx']:
    print(f'\nRebuilding {target}...')
    _, out, err = ssh.exec_command(
        f'cd /opt/max-comments/infra && docker compose up -d --build {target} 2>&1'
    )
    for line in out:
        sys.stdout.write(line)
    for line in err:
        sys.stdout.write('[ERR] ' + line)

ssh.close()
print('\nDone.')
