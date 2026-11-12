#!/usr/bin/env bash
set -e

echo "Myangustis JavaScript Environment Setup"
echo "======================================="

echo "Installing Node.js workspace dependencies..."
npm install --no-package-lock

echo "Verifying the development tools..."
node -v
npm -v
gh --version | head -1
sqlite3 --version
ssh -V

echo ""
echo "Environment ready. Use npm test to run the test suite."
