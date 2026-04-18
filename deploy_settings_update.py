import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import paramiko
from pathlib import Path

HOST = '89.169.2.231'
USER = 'root'
PASS = '***REMOVED-SECRET-SSH-PASSWORD***'
LOCAL = Path(r'C:\Users\User\Desktop\Project\cooment_max')

FILES = [
    (LOCAL / 'miniapp' / 'src' / 'pages' / 'SettingsPage.tsx',
     '/opt/max-comments/miniapp/src/pages/SettingsPage.tsx'),
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

# Пересобираем mc_nginx
print('Rebuilding mc_nginx...')
stdin, stdout, stderr = ssh.exec_command(
    'cd /opt/max-comments/infra && docker compose up -d --build mc_nginx 2>&1',
    get_pty=False
)
for line in stdout:
    print(line, end='')
for line in stderr:
    print('[ERR]', line, end='')

ssh.close()
print('Done.')
