#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

HOST = '89.169.2.231'
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)

sftp = ssh.open_sftp()

with sftp.open('/opt/max-comments/bot/src/handlers/onPostCreated.ts', 'r') as f:
    lines = f.readlines()

print("Строки 90-100:")
for i, line in enumerate(lines[89:100], start=90):
    print(f"{i}: {line.rstrip()}")

sftp.close()
ssh.close()
