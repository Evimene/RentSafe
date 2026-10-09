# RentSafe Server — local Windows setup

## Important port distinction

- Express / RentSafe API: `http://localhost:4000` (`PORT=4000`)
- PostgreSQL: `localhost:5432` (`DB_PORT=5432`)

The server reads `.env`, not `.env.example`. Create `.env` from `.env.example` and edit that file.

## 1. Prepare environment

Open PowerShell in this folder (the folder containing `package.json`):

```powershell
Copy-Item .env.example .env
notepad .env
```

Set `DB_PASS` to the password for your local PostgreSQL user. Replace the JWT values with long random strings. Keep `PORT=4000` and `DB_PORT=5432` unless you deliberately use different ports.

If you previously set a PowerShell environment variable named `PORT`, remove it for this session so `.env` takes effect:

```powershell
Remove-Item Env:PORT -ErrorAction SilentlyContinue
```

If you set `PORT` in Windows User or System environment variables, remove or update it there too, then open a new terminal. Environment variables already present in the shell take precedence over values in `.env` unless dotenv is configured to override them.

## 2. Install dependencies and create database

```powershell
npm install
```

Make sure the PostgreSQL service is running and the database named in `DB_NAME` exists. For the example configuration, create `Dwellvibes` if it does not exist:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE Dwellvibes;"
```

If PostgreSQL reports that the database already exists, that is fine.

## 3. Run migrations and server

The initial authentication/KYC migration does not require PostGIS. PostGIS can be added later when the property-location schema actually uses spatial columns/functions.

```powershell
npm run migrate
npm run dev
```

Run these commands from the folder containing `package.json`, not from a different copy of the project. If you edit `.env`, stop the running server with `Ctrl+C` and start `npm run dev` again; changing `.env` does not reliably trigger Node's file watcher.

## 4. Verify

Open these URLs:

- `http://localhost:4000/` — web application
- `http://localhost:4000/health` — API process health and configured API port
- `http://localhost:4000/health/db` — database connection test

A successful `/health` with a failing `/health/db` means Express is running but the PostgreSQL connection settings/password/database need correction.

## Development notes

- `KYC_PROVIDER=mock` is for local testing only, not real identity verification.
- `OTP_DEV_RETURN=true` is for development only.
- In development, SMS is logged locally instead of sent to a live SMS provider.
- `.env`, `.git`, `node_modules`, and user uploads are not included in this source archive. Never commit `.env` or production credentials.





-------------------> Paystack workflow Design Process

GUEST                    ME (RentSafe)              HOST
  │                           │                        │
  │ 1. Book + pay ₦150,000    │                        │
  ├──────────────────────────►│                        │
  │                           │                        │
  │                    2. Paystack charges guest       │
  │                       Funds settle to YOU          │
  │                       (T+1 to your bank)           │
  │                           │                        │
  │                    3. You hold funds in YOUR       │
  │                       operational account          │
  │                       (you are merchant of record) │
  │                           │                        │
  │ 4. Guest checks in        │                        │
  ├──────────────────────────►│                        │
  │                           │                        │
  │                    5. You initiate Paystack        │
  │                       Transfer to host             │
  │                       (host's recipient_code)      │
  │                           ├───────────────────────►│
  │                           │                        │
  │                    6. transfer.success webhook     │
  │                       confirms payout              │

Key insight: Paystack is your payment collector (charge) and your payout rail (transfer). The "escrow" is a logical state in your database — not a Paystack product. I hold the funds in your own account between charge and transfer. This is legal because you are the merchant, not a custodian.