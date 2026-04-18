#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deploy changed files to VPS using SFTP
Uploads bot, miniapp files and rebuilds containers
"""

import paramiko
import sys
import os
import time

# SSH credentials
HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

# Mapping: local path -> remote path
# VPS project root: /opt/max-comments/
FILES_TO_UPLOAD = [
    (
        r"C:\Users\User\Desktop\Project\cooment_max\bot\src\api\maxClient.ts",
        "/opt/max-comments/bot/src/api/maxClient.ts"
    ),
    (
        r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\components\CommentInput.tsx",
        "/opt/max-comments/miniapp/src/components/CommentInput.tsx"
    ),
    (
        r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\styles\global.css",
        "/opt/max-comments/miniapp/src/styles/global.css"
    ),
]

def mkdir_p(sftp, remote_path):
    """Рекурсивно создать все директории до remote_path"""
    dirs = []
    path = remote_path
    while path and path != "/":
        dirs.append(path)
        path = os.path.dirname(path)

    dirs.reverse()
    for dir_path in dirs:
        try:
            sftp.stat(dir_path)
        except FileNotFoundError:
            try:
                sftp.mkdir(dir_path)
                print(f"  Created dir: {dir_path}")
            except:
                pass  # Может уже существовать из-за гонки

def upload_file(sftp, local_path, remote_path):
    """Upload a single file via SFTP"""
    print(f"\n{'='*80}")
    print(f"Uploading: {os.path.basename(local_path)}")
    print(f"  Local:  {local_path}")
    print(f"  Remote: {remote_path}")
    print(f"{'='*80}")

    try:
        # Ensure all parent directories exist
        remote_dir = os.path.dirname(remote_path).replace("\\", "/")
        mkdir_p(sftp, remote_dir)

        # Upload file
        sftp.put(local_path, remote_path)
        print(f"[OK] Uploaded successfully")
        return True
    except Exception as e:
        print(f"[ERROR] Upload failed: {e}")
        return False

def execute_command(ssh, command, timeout=300):
    """Execute SSH command and return output"""
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
        print(f"[ERROR] Command execution failed: {e}")
        return -1, "", str(e)

def main():
    print(f"\n{'#'*80}")
    print(f"# MAX Comments Platform — Deploy Script")
    print(f"# Target: {HOST}")
    print(f"{'#'*80}\n")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        # Connect
        print(f"[1/4] Connecting to {HOST} as {USER}...")
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
        sftp = ssh.open_sftp()
        print("[OK] SSH connection established\n")

        # Upload files
        print(f"[2/4] Uploading {len(FILES_TO_UPLOAD)} file(s)...")
        upload_success = True
        for local_path, remote_path in FILES_TO_UPLOAD:
            if not os.path.exists(local_path):
                print(f"[WARNING] Local file not found, skipping: {local_path}")
                continue

            if not upload_file(sftp, local_path, remote_path):
                upload_success = False

        sftp.close()

        if not upload_success:
            print("\n[ERROR] Some files failed to upload. Aborting rebuild.")
            sys.exit(1)

        print("\n[OK] All files uploaded successfully")

        # Rebuild bot container (for maxClient.ts)
        print(f"\n[3/4] Rebuilding mc_bot container...")
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_bot",
            timeout=180
        )

        # Rebuild nginx container (for miniapp files)
        print(f"\n[4/4] Rebuilding mc_nginx container (this will take ~3 minutes)...")
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_nginx",
            timeout=300
        )

        # Wait for containers to stabilize
        print("\nWaiting 10 seconds for containers to stabilize...")
        time.sleep(10)

        # Check container status
        print("\n" + "="*80)
        print("FINAL STATUS: Checking container health")
        print("="*80)
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose ps",
            timeout=30
        )

        # Get recent logs
        print("\n" + "="*80)
        print("Recent mc_bot logs (last 20 lines):")
        print("="*80)
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose logs --tail=20 mc_bot",
            timeout=30
        )

        print("\n" + "="*80)
        print("Recent mc_nginx logs (last 20 lines):")
        print("="*80)
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose logs --tail=20 mc_nginx",
            timeout=30
        )

        print("\n" + "#"*80)
        print("# DEPLOY COMPLETED")
        print("#"*80)
        print("\nNext steps:")
        print("  1. Test bot webhook: send a message to the bot in MAX")
        print("  2. Test Mini App: open a post with comments button")
        print("  3. Monitor logs: docker compose logs -f mc_bot mc_nginx")
        print("\n")

    except paramiko.AuthenticationException:
        print("[ERROR] SSH authentication failed — check credentials")
        sys.exit(1)
    except paramiko.SSHException as e:
        print(f"[ERROR] SSH error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        ssh.close()
        print("SSH connection closed")

if __name__ == "__main__":
    main()
