#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Verify Mini App deployment
"""

import paramiko
import sys

HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

def execute_command(ssh, command, timeout=30):
    """Выполняет команду и возвращает результат"""
    print(f"\nКоманда: {command}")
    print("="*80)

    try:
        stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
        exit_status = stdout.channel.recv_exit_status()
        stdout_text = stdout.read().decode('utf-8', errors='replace')
        stderr_text = stderr.read().decode('utf-8', errors='replace')

        print(f"Exit code: {exit_status}")
        if stdout_text:
            print(f"Output:\n{stdout_text}")
        if stderr_text and exit_status != 0:
            print(f"Errors:\n{stderr_text}")

        return exit_status, stdout_text, stderr_text
    except Exception as e:
        print(f"Error: {e}")
        return -1, "", str(e)

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print("SSH connected\n")

        # Проверка 1: контейнер запущен
        print("="*80)
        print("CHECK 1: mc_nginx container status")
        print("="*80)
        exit_code, stdout, _ = execute_command(
            ssh,
            "docker ps | grep mc_nginx"
        )
        if exit_code == 0 and "Up" in stdout:
            print("[OK] Container is running")
        else:
            print("[ERROR] Container not running properly")

        # Проверка 2: поиск слова "Оферта" в HTML
        print("\n" + "="*80)
        print("CHECK 2: Search 'Оферта' in deployed HTML")
        print("="*80)
        exit_code, stdout, _ = execute_command(
            ssh,
            'curl -sk https://sushi-house-39.online/ | grep -o "Оферта"',
            timeout=30
        )
        if exit_code == 0 and stdout.strip():
            print(f"[OK] Found in HTML: {stdout.strip()}")
            print("\n[SUCCESS] Deployment verified successfully!")
        else:
            print("[WARNING] Word not found, check manually")

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
