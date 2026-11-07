#!/usr/bin/env bash
set -e

echo "🔧 Myangustis Environment Setup"
echo "================================"

# 1. Install Node dependencies (workspaces)
echo "📦 Installing Node.js dependencies..."
npm install

# 2. Install Python dependencies via UV
echo "🐍 Setting up Python environment..."
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install -e ".[dev]" 2>/dev/null || uv pip install -r pyproject.toml

# 3. Install additional tools
echo "🛠️ Installing CLI tools..."
npm install -g nodemon typescript vite 2>/dev/null || true

# 4. Verify critical imports
echo "✅ Verifying installations..."
node -v
npm -v
python3 -c "import fitz; print(f'PyMuPDF: {fitz.__version__}')" 2>/dev/null || echo "PyMuPDF: install with 'uv pip install pymupdf'"
python3 -c "import pypdf, docx, flask; print('Python deps OK')" 2>/dev/null || echo "Python deps: installing..."
uv --version
gh --version | head -1
sqlite3 --version
ssh -V

echo ""
echo "🚀 Environment Ready!"
echo "   Node: $(node -v)"
echo "   Python: $(python3 --version)"
echo "   UV: $(uv --version)"
echo ""
echo "💡 Tips:"
echo "   - Run 'npm run dev' to start the site"
echo "   - Run 'npm run dev:engine' for the engine"
echo "   - Activate Python venv: 'source .venv/bin/activate'"
