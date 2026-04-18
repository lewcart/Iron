# Neon Database Setup for Rebirth

## Quick Setup (5 minutes)

### 1. Create Neon Database

1. Go to [Neon Console](https://console.neon.tech)
2. Click **"Create Project"**
3. Name it: `rebirth`
4. Select region: **US East (Ohio)** (or closest to you)
5. Click **"Create Project"**

### 2. Get Connection String

After creating the project, Neon shows your connection string:

```
postgresql://[user]:[password]@[endpoint].neon.tech/[database]?sslmode=require
```

**Copy this entire string** — you'll need it in the next steps.

### 3. Configure Vercel Environment Variables

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Find the **Rebirth** project
3. Go to **Settings** → **Environment Variables**
4. Add two variables:
   - **Name:** `POSTGRES_URL`
     **Value:** [paste your Neon connection string]
     **Environments:** Production, Preview, Development
   - **Name:** `DATABASE_URL`
     **Value:** [paste your Neon connection string]
     **Environments:** Production, Preview, Development
5. Click **"Save"**

### 4. Run Database Migrations

Option A: Using Neon SQL Editor (manual)
1. In Neon Console, click **"SQL Editor"**
2. Paste and run each file in `src/db/migrations/` in filename order
3. Copy the contents of `src/db/exercises.json` and run the seed manually OR...

Option B: Using the CLI (recommended, after vercel deployment)
```bash
# Set the connection string locally
export POSTGRES_URL="postgresql://..."

# Run migrations
npm run db:migrate

# Seed exercises
npm run db:seed
```

### 5. Redeploy Vercel (if needed)

If you added env vars after deployment:
```bash
vercel --prod
```

Or just trigger a redeploy from the Vercel dashboard.

---

## Local Development Setup

To run the app locally with Neon:

1. Copy `.env.local.example` to `.env.local`:
   ```bash
   cp .env.local.example .env.local
   ```

2. Edit `.env.local` and add your Neon connection string:
   ```env
   POSTGRES_URL="postgresql://[user]:[password]@[endpoint].neon.tech/[database]?sslmode=require"
   ```

3. Run migrations and seed:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```

4. Start the dev server:
   ```bash
   npm run dev
   ```

---

## Verifying Everything Works

After deployment and database setup:

1. Visit your Vercel deployment URL
2. You should see the Rebirth web UI
3. Go to `/api/health` (if you add a health check endpoint) or just browse exercises

To test the CLI:
```bash
# List exercises
npm run cli -- list-exercises

# Should show 15+ exercises from the seed data
```

---

## Troubleshooting

**Error: "Missing database connection string"**
- Make sure `POSTGRES_URL` or `DATABASE_URL` is set in Vercel
- Redeploy after adding environment variables

**Error: "relation 'exercises' does not exist"**
- Run migrations: `npm run db:migrate`
- Then seed: `npm run db:seed`

**CLI works but web app doesn't**
- Check Vercel environment variables are set
- Check Vercel function logs for errors

---

## What Changed from SQLite

- ✅ Database migrated from SQLite to PostgreSQL (Neon)
- ✅ All queries now use async/await
- ✅ JSONB fields instead of TEXT for JSON data
- ✅ Boolean fields use `true/false` instead of `0/1`
- ✅ Timestamps use `NOW()` instead of `CURRENT_TIMESTAMP`
- ✅ CLI commands all updated for async operations

---

## Neon Benefits

- **Serverless**: Scales to zero when not in use (free tier!)
- **Postgres-compatible**: Full SQL support
- **Vercel integration**: Native integration with Vercel projects
- **Branching**: Database branches for preview deployments (optional)
- **Fast**: Low-latency connection pooling

---

Need help? Check the [Neon Docs](https://neon.tech/docs) or ping Lewis.
