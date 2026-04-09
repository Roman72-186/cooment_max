#!/usr/bin/env python3
import paramiko
import sys

host = "89.169.2.231"
username = "root"
password = "***REMOVED-SECRET-SSH-PASSWORD***"
command = "docker logs mc_bot --tail 30 2>&1"

try:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    print(f"Connecting to {host}...", file=sys.stderr)
    client.connect(hostname=host, username=username, password=password, timeout=10)

    print(f"Executing: {command}", file=sys.stderr)
    stdin, stdout, stderr = client.exec_command(command)

    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    if output:
        print(output, end='')
    if error:
        print(error, end='', file=sys.stderr)

    client.close()

except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
