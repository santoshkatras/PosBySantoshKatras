# Stockkeep

Inventory for Indian computer shops and bike service centres. One Node process serves the API and the web app. There is no Docker, Postgres, Redis, or SQLite. The layout matches TechCizHRMS: a Vite client, an Express server started with `node server/start.mjs`, Zoho Catalyst AppSail on Node 24 port 9000, and Catalyst Data Store tables.

## Run it on your computer

You need Node.js 22 or newer, and the Catalyst CLI signed in to the same org.

```bash
npm install -g zcatalyst-cli
catalyst login --dc us
npm install
npm run dev
```

Open http://127.0.0.1:9000

The server reads and writes the Development Data Store in the Catalyst project PosBySantoshKatras. The first start loads two demo businesses if they are not already there. Password for every demo user is `Demo@12345`.

| Business | Sign in | What you can see |
| --- | --- | --- |
| ByteBazaar, Mumbai | owner@bytebazaar.demo | Computer shop. Serial and warranty modules. Andheri showroom and Bhiwandi warehouse. |
| ByteBazaar sales | sales@bytebazaar.demo | Andheri showroom only. |
| Spoke & Sprocket, Bengaluru | owner@spoke.demo | Bike workshop. Job cards and purchase. Workshop and parts store. |
| Spoke mechanic | mechanic@spoke.demo | Workshop stock only. |

Other seeded users: manager@bytebazaar.demo, advisor@spoke.demo.

`npm test` checks tenant isolation, the module guard, and the stock ledger. `npm run build` writes `client/dist`. `npm start` serves that build with `NODE_ENV=production`.

## What you can do

Sign up a computer shop or a bike service centre. The business type picks the trial plan and the modules. Then use the dashboard, catalogue, stock adjustments, locations, users, and settings. Purchase, GST billing, serials, warranty, job cards, customers, reports, and notifications are visible when the plan includes them, and those screens say they are next.

Money is INR. Product rows carry HSN/SAC and a GST rate. Stock cannot go below zero. A user with no assigned locations sees every location. A user with assigned locations sees only those.

## Host it on Catalyst the same way as TechCizHRMS

This is an AppSail service, not a Catalyst function and not a Slate site. Do not deploy it into the existing TechCizHRMS or TechCizHRMS2 AppSail. That service is already running HRMS.

1. The Catalyst project is already created: **PosBySantoshKatras**, id `82924000000039365`, in org `skatras632` (`941422719`), Development, timezone Asia/Kolkata. Console: https://console.catalyst.zoho.com/baas/941422719/index
2. From this folder, link that project:

```bash
npm install -g zcatalyst-cli
catalyst login --dc us -ni
catalyst init --org 941422719 -p 82924000000039365 -ni
```

3. Add an AppSail service named `posbysantoshkatras`. The CLI writes `catalyst.json`. Keep these values, which already match `app-config.json` and the live HRMS service:

- Startup command: `node server/start.mjs`
- Stack: `node24`
- Memory: 512
- Port: the process listens on `X_ZOHO_CATALYST_LISTEN_PORT` (9000 locally)
- `catalyst_auth`: false, because Stockkeep signs users in itself
- Environment: `TZ=Asia/Kolkata` and `NODE_ENV=production`

4. Try it locally with the Catalyst CLI, then deploy only the Development environment:

```bash
npm test
catalyst serve
catalyst deploy appsail --name posbysantoshkatras -ni
```

The Development AppSail is already deployed at https://posbysantoshkatras-10135490478.development.catalystappsail.com

`.catalystignore` keeps git metadata out of the upload. `node_modules` stays in the package because AppSail starts `node server/start.mjs` directly and does not run `npm install` before the process must listen.

Business data lives in Catalyst Data Store, the same service TechCizHRMS uses. Each table has Catalyst's `ROWID`, plus `row_key`, a numeric `id`, and `company_id` on company-owned rows. The tables are `companies`, `users`, `locations`, `roles`, `role_rights`, `user_locations`, `refresh_tokens`, `units`, `categories`, `brands`, `products`, `variants`, `stock_levels`, `stock_movements`, `audit_logs`, and `settings`. A redeploy does not wipe those rows. The demo seed runs again only when the demo emails are missing.

Set `JWT_SECRET` in `app-config.json` `env_variables` before a real deploy. The development fallback is only for a laptop.

## How this differs from the first foundation

The first cut used pnpm, Next.js, NestJS, Postgres with row-level security, and Redis. A later cut used a SQLite file so the process could start without Docker. This cut keeps the same product flows and stores rows in Catalyst Data Store, the way TechCizHRMS does.

Tenant isolation is in the queries: every business read and write filters on `company_id`. The API ignores a spoofed tenant header and uses the signed-in user. Passwords are scrypt hashes. Access tokens last 15 minutes. The refresh token is an httpOnly cookie named `sk_refresh`.

## Still to build

Purchase and goods receipt, GST invoices (CGST, SGST, IGST), serial and IMEI, warranty lookup, bike job cards, customers, reports, notifications, and a Zoho Books sync. Those modules are entitled by plan and can be toggled in Settings.
