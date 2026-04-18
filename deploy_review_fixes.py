import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import paramiko
from pathlib import Path

HOST = '89.169.2.231'
USER = 'root'
PASS = '***REMOVED-SECRET-SSH-PASSWORD***'
LOCAL = Path(r'C:\Users\User\Desktop\Project\cooment_max')

FILES = [
    # Backend (пересобрать mc_backend)
    (LOCAL / 'backend' / 'src' / 'routes' / 'comments.ts',
     '/opt/max-comments/backend/src/routes/comments.ts'),
    # Mini App (пересобрать mc_nginx)
    (LOCAL / 'miniapp' / 'src' / 'pages' / 'SettingsPage.tsx',
     '/opt/max-comments/miniapp/src/pages/SettingsPage.tsx'),
    (LOCAL / 'miniapp' / 'src' / 'components' / 'CommentInput.tsx',
     '/opt/max-comments/miniapp/src/components/CommentInput.tsx'),
    (LOCAL / 'miniapp' / 'src' / 'components' / 'CommentCard.tsx',
     '/opt/max-comments/miniapp/src/components/CommentCard.tsx'),
    (LOCAL / 'miniapp' / 'src' / 'store' / 'useAppStore.ts',
     '/opt/max-comments/miniapp/src/store/useAppStore.ts'),
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

for target in ['mc_backend', 'mc_nginx']:
    print(f'\nRebuilding {target}...')
    _, out, _ = ssh.exec_command(
        f'cd /opt/max-comments/infra && docker compose up -d --build {target} 2>&1'
    )
    for line in out:
        sys.stdout.write(line)

ssh.close()
print('\nDone.')
