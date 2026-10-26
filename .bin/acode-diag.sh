#!/system/bin/sh
# Run this inside Acode's terminal (Alpine side).
# Reports what paths this app can actually see/write to.

printf '=== ACODE SIDE DIAGNOSTIC ===\n\n'
printf 'User: '; whoami
printf 'UID:  '; id
printf 'cwd:  '; pwd
printf '\n--- writable paths we can reach ---\n'
for p in "$HOME" /data/data /sdcard /storage/emulated/0 /storage/self/primary /mnt /proc/self/mountinfo; do
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

printf '\n--- home directory layout ---\n'
ls -la "$HOME" 2>/dev/null | head -40

printf '\n--- any .ssh keys? ---\n'
ls -la "$HOME/.ssh/" 2>/dev/null

printf '\n--- open/listening sockets (ssh? sshd?) ---\n'
netstat -tlnp 2>/dev/null || ss -tlnp 2>/dev/null || printf '  (no netstat/ss)\n'

printf '\n--- what is our project dir? (if we can reach it) ---\n'
for p in ~/Myangustis ~/project /sdcard/Myangustis /data/data/com.foxdebug.acode/files/Myangustis /home/user/Myangustis; do
  [ -d "$p" ] && printf '  FOUND project at %s\n' "$p" && ls "$p" 2>/dev/null | head -10
done

printf '\n=== paste everything above into chat ===\n'
