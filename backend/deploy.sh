#!/bin/bash
# ATP Backend — Quick setup script
# Run this ONCE after Railway deploys the backend

echo "🌿 ATP Backend Setup"
echo ""

# 1. Run database migration
echo "📦 Running database migration..."
node src/db/migrate.js
echo ""

# 2. Verify connection
echo "✅ Setup complete!"
echo ""
echo "Your API is live. Add these env vars to Railway:"
echo "  DATABASE_URL = <your neon connection string>"
echo "  JWT_SECRET   = <the secret from .env>"
echo "  FRONTEND_URL = https://attheparkworld.github.io"
