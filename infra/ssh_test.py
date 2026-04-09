#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SSH connection test to production server
Executes commands to stop bot and test Supabase connectivity
"""

import paramiko
import sys
import time

# Server credentials
HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

def execute_command(ssh, command, timeout=30):
    """Execute command and return full output"""
    print(f"\n{'='*80}")
    print(f"Executing: {command}")
    print(f"{'='*80}")

    try:
        stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
        exit_status = stdout.channel.recv_exit_status()

        stdout_text = stdout.read().decode('utf-8', errors='replace')
        stderr_text = stderr.read().decode('utf-8', errors='replace')

        print(f"Exit code: {exit_status}")
        if stdout_text:
            print(f"STDOUT:\n{stdout_text}")
        if stderr_text:
            print(f"STDERR:\n{stderr_text}")

        return exit_status, stdout_text, stderr_text
    except Exception as e:
        print(f"ERROR executing command: {e}")
        return -1, "", str(e)

def main():
    print(f"Connecting to {HOST} as {USER}...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print("[OK] SSH connection established\n")

        # Step 1: Stop mc_bot
        print("\n" + "="*80)
        print("STEP 1: Stopping mc_bot container")
        print("="*80)
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose stop mc_bot"
        )

        time.sleep(2)

        # Verify bot is stopped
        execute_command(
            ssh,
            "docker ps -a | grep mc_bot"
        )

        # Step 2: Test Supabase connection
        print("\n" + "="*80)
        print("STEP 2: Testing direct Supabase connection from host")
        print("="*80)

        psql_command = '''apt-get install -y postgresql-client -qq 2>/dev/null; PGCONNECT_TIMEOUT=10 PGPASSWORD="r1PCAAuyYeOf3337" psql "host=aws-1-eu-north-1.pooler.supabase.com port=6543 dbname=postgres user=postgres.lfsqjmsjldisqycyvdnw sslmode=require" -c "SELECT 1 as test;" 2>&1'''

        exit_code, stdout, stderr = execute_command(ssh, psql_command, timeout=60)

        print("\n" + "="*80)
        print("FINAL RESULT:")
        print("="*80)
        print(f"Exit code: {exit_code}")
        if exit_code == 0:
            print("[OK] Supabase connection SUCCESSFUL")
        else:
            print("[ERROR] Supabase connection FAILED")
        print("="*80)

    except paramiko.AuthenticationException:
        print("[ERROR] Authentication failed - check credentials")
        sys.exit(1)
    except paramiko.SSHException as e:
        print(f"[ERROR] SSH error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] Unexpected error: {e}")
        sys.exit(1)
    finally:
        ssh.close()
        print("\nSSH connection closed")

if __name__ == "__main__":
    main()
