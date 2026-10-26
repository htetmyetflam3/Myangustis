#!/bin/bash
# .bin/debian-setup.sh — paste this whole script into Conduit's Debian shell (one time only).
# After it runs: sshd listens on 127.0.0.1:2222, Node 22 + python3 + mupdf are installed,
# and you can drive Debian from Acode's terminal via the `dsh` wrapper.

set -e

echo '=== Conduit Debian bootstrap for Acode bridge ==='

# 1. Base packages
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg \
  openssh-server rsync \
  build-essential pkg-config \
  python3 python3-pip python3-venv \
  git \
  libmupdf-dev libjpeg-dev zlib1g-dev libfreetype-dev libharfbuzz-dev

# 2. Node.js 22 (from NodeSource; repo needs >=22 per engines)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo '--- installing Node.js 22 ---'
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "node:  $(node -v)"
echo "npm:   $(npm -v)"

# 3. Configure sshd — port 2222, key-only root login
echo '--- configuring sshd on port 2222 ---'
mkdir -p /run/sshd /root/.ssh
chmod 700 /root/.ssh

cat > /etc/ssh/sshd_config.d/99-acode-bridge.conf <<'EOF'
Port 2222
ListenAddress 0.0.0.0
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PasswordAuthentication no
ChallengeResponseAuthentication no
UsePAM no
X11Forwarding no
PermitEmptyPasswords no
AuthorizedKeysFile .ssh/authorized_keys
AcceptEnv LANG LC_*
EOF

ssh-keygen -A 2>/dev/null || true

KEY=/root/.ssh/acode_bridge_key
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -N '' -C 'acode-bridge' -f "$KEY" -q
fi
cat "$KEY.pub" >> /root/.ssh/authorized_keys
# dedupe
awk '!seen[$0]++' /root/.ssh/authorized_keys > /root/.ssh/authorized_keys.tmp \
  && mv /root/.ssh/authorized_keys.tmp /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys "$KEY"

mkdir -p /mnt/android/Myangustis

# 4. Start sshd
/usr/sbin/sshd -t
pkill sshd 2>/dev/null || true
/usr/sbin/sshd
sleep 1
if ss -tln 2>/dev/null | grep -q ':2222'; then
  echo '--- sshd listening on 0.0.0.0:2222 ---'
else
  netstat -tln 2>/dev/null | grep 2222 || echo '!!! sshd NOT listening — debug with: /usr/sbin/sshd -d -p 2222'
fi

# 5. Autostart sshd whenever a Debian shell starts (Conduit launches your shell on startup,
#    so this ensures sshd is already up even if you never open Conduit again).
cat > /etc/profile.d/00-start-sshd.sh <<'EOF'
#!/bin/sh
if ! pgrep -x sshd >/dev/null 2>&1; then
  mkdir -p /run/sshd
  /usr/sbin/sshd
fi
EOF
chmod +x /etc/profile.d/00-start-sshd.sh

# 6. MOTD
cat > /etc/motd <<'EOF'
==== Debian (Conduit) — Acode bridge ====
Project:  /mnt/android/Myangustis   (= /sdcard/Myangustis = Acode side)
sshd:     0.0.0.0:2222 (key-only)
You don't need to come back here — drive Debian from Acode with `dsh`.
EOF

cat <<'OUTER'

================================================================================
 BOOTSTRAP COMPLETE. Now do these 3 steps on the Acode side.
================================================================================

STEP 1 — Save the private key printed below. In Acode terminal run:

           mkdir -p ~/.ssh
           cat > ~/.ssh/acode_debian
           chmod 600 ~/.ssh/acode_debian

         Then paste EVERYTHING between the ---- lines (including the BEGIN/END
         lines) and press Ctrl+D on a blank line to end the cat.

---- BEGIN PRIVATE KEY ----
OUTER
cat "$KEY"
cat <<'OUTER'
---- END PRIVATE KEY ----

STEP 2 — Install the `dsh` wrapper on Acode. In Acode terminal run:

           mkdir -p ~/.bin
           cat > ~/.bin/dsh
           chmod +x ~/.bin/dsh

         Then paste the contents of .bin/dsh from the repo, Ctrl+D to end.
         Finally add ~/.bin to your PATH permanently:
           echo 'export PATH="$HOME/.bin:$PATH"' >> ~/.bashrc
           export PATH="$HOME/.bin:$PATH"

STEP 3 — Move the project onto shared storage (only if it's still in /public):
           sh .bin/move-project-to-sdcard.sh

         Then in Acode use File → Open Folder → navigate to
         /sdcard/Myangustis and open it.

STEP 4 — Test:  in Acode terminal type `dsh`. You should land at a Debian
         root@host prompt with a glibc `node -v` (v22.x).
         Ctrl+D exits back to Alpine.

         Run `dsh npm install` once inside Debian to build native modules
         against glibc. From then on:
           dsh npm test        # run tests in Debian
           dsh npm run build   # build in Debian
           dsh                 # interactive Debian shell

NOTE:   Keep Conduit in the background (enable wakelock/background in its
        settings). Every time Android kills Conduit, open it once and
        sshd auto-starts via /etc/profile.d; you can then switch back to
        Acode immediately. You never need to type in Conduit again.
OUTER
