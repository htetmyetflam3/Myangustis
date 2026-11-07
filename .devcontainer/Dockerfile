FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# --- System libraries (minimal but sufficient for all native builds) ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    # OpenSSH FULL (server + client + sftp)
    openssh-server openssh-client openssh-sftp-server \
    # Build essentials for node-gyp / better-sqlite3 / canvas
    build-essential python3-dev pkg-config \
    # Canvas & PDF native deps
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    # MuPDF / PyMuPDF
    libmupdf-dev libfreetype6-dev libharfbuzz-dev \
    # SQLite + MySQL clients
    sqlite3 libsqlite3-dev default-mysql-client \
    # OCR / image processing
    tesseract-ocr tesseract-ocr-mya libtesseract-dev libleptonica-dev \
    # Misc tools
    curl wget git ca-certificates gnupg lsb-release \
    # Clean up
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# --- Node.js 22+ (required: engines >=22) ---
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && corepack enable \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# --- Python 3.12 + UV (fast package manager) ---
RUN add-apt-repository ppa:deadsnakes/ppa -y \
    && apt-get update && apt-get install -y python3.12 python3.12-venv python3.12-dev \
    && ln -sf /usr/bin/python3.12 /usr/bin/python3 \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/ \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# --- GitHub CLI ---
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# --- OpenSSH server setup ---
RUN mkdir /var/run/sshd \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config \
    && sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && echo "vscode:vscode" | chpasswd

# Expose SSH port (optional, for external access)
EXPOSE 22

# --- Verify installations ---
RUN node -v && npm -v && python3 --version && uv --version && gh --version && ssh -V
