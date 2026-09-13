# BuddySite on Render with PostgreSQL (many sellers + customers)

## Why
The old single `data.json` file gets slow/unstable when many sellers and customers use the app at once.
PostgreSQL on Render fixes that.

## Setup (one time)

### 1. Create Postgres on Render
1. Open https://dashboard.render.com
2. **New +** → **PostgreSQL**
3. Name: `buddysite-db`
4. Plan: Free (or Starter)
5. Create

### 2. Copy the database URL
On the Postgres service page, copy **Internal Database URL**
(looks like `postgres://user:pass@dpg-xxx/buddysite`)

### 3. Add it to your Web Service
1. Open your BuddySite **Web Service** on Render
2. **Environment** → **Add Environment Variable**
3. Key: `DATABASE_URL`
4. Value: paste the Internal Database URL
5. Save

### 4. Deploy
Push this code (or Manual Deploy).

On start, BuddySite will:
- connect to Postgres
- create tables automatically
- use Postgres instead of `data.json`

### 5. (Optional) Run migrate manually
In Render Shell for the web service:
```
node scripts/migrate.js
```

## Local development
Leave `DATABASE_URL` empty → uses `data.json` (same as before).
Tests also use the JSON file.

## Note
Existing data in `data.json` is **not** auto-imported.
If you already have live sellers on JSON, tell me and we’ll add an import script.
