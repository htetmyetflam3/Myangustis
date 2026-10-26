#!/bin/bash
# Run this inside Conduit's Debian container (as root or normal user).
# Reports what paths Debian can see and whether SSH is available.

printf '=== DEBIAN SIDE DIAGNOSTIC ===\n\n'
printf 'User: '; whoami
printf 'UID:  '; id
printf 'cwd:  '; pwd
printf '\n--- OS ---\n'; cat /etc/os-release 2>/dev/null | head -5
printf '\n--- writable paths ---\n'
for p in "$HOME" /root /mnt /sdcard /storage /host /proc/self/mountinfo /data /system; do
  if [ -e "$p" ]; then
    perms=$(ls -ld "$p" 2>/dev/null | awk '{print $1, $3, $4}')
    printf '  EXISTS  %-40s  %s\n' "$p" "$perms"
    if [ -w "$p" ]; then
      printf '           ^-- WRITABLE\n'
    fi
  else
    printf '  missing %s\n' "$p"
  fi
done

printf '\n--- mounts that look like host binds ---\n'
grep -E 'sdcard|storage|host|acode|project|emulated' /proc/self/mountinfo 2>/dev/null || echo '  (no host-like mounts found)'

printf '\n--- any /mnt/* subdirs? ---\n'; ls -la /mnt 2>/dev/null
printf '\n--- /host contents if present ---\n'; ls -la /host 2>/dev/null | head -20

printf '\n--- ssh client/server ---\n'
which ssh sshd sshfs rsync inotifywait 2>/dev/null
dpkg -l openssh-client openssh-server sshfs rsync inotify-tools 2>/dev/null | grep '^ii' || echo '  (none of those packages installed yet)'

printf '\n--- listening ports ---\n'
ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null

printf '\n--- home dir ---\n'; ls -la "$HOME" 2>/dev/null | head -20

printf '\n=== paste everything above into chat ===\n'
