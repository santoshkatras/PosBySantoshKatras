# Stockkeep

Multi-tenant inventory for Indian computer shops and bike service centres. This repository is the Phase 1a foundation: tenancy, auth, module entitlements, catalogue, and a stock ledger. Purchase, GST billing, serial tracking, job cards, and Zoho Books sync are next.

English only. Every screen string lives in `apps/web/src/messages/en.json`. Money is INR. GST rates, HSN/SAC, GSTIN, and state codes are in the data model.

## Architecture

```
apps/web   Next.js PWA (port 4317)
apps/api   NestJS modular monolith (port 4318)
packages/types   Shared domain, plans, permissions, Zod schemas
packages/ui      INR / date / quantity formatting and empty states
packages/config  Shared TypeScript and Prettier config
```

PostgreSQL holds every tenant in one schema. Each tenant-owned row has `tenant_id`. Row-Level Security is forced on those tables. The API opens one transaction per authenticated request and runs:

```sql
SELECT set_config('app.tenant_id', '<id from the JWT>', true);
```

Policies compare `tenant_id` (or `id` on `tenants`) to `app_current_tenant_id()`. If the setting is missing, the comparison fails and the row is invisible. The tenant id comes from the access token, never from a header or body.

Two database roles:

| Role | Used for | RLS |
|---|---|---|
| `postgres` | Migrations, seed, signup, login, token refresh | Bypasses (superuser) |
| `inventory_app` | Every request after login | Enforced, including the table owner via `FORCE ROW LEVEL SECURITY` |

Plans and plan features are platform data. `inventory_app` can read them and cannot write them. Audit rows are insert-only.

Access is three layers, as in the product plan:

1. **Plan entitlement** — what the subscription includes.
2. **Tenant toggle** — the owner can switch a module off inside that entitlement. Users and settings stay on.
3. **Role permission** — module, then action (`catalogue.view`, `stock.adjust`, …).

The API guards are the source of truth. The sidebar hides anything the guards would reject.

Business type at signup picks the trial plan and the default modules, roles, units, and categories.

| Business type | Trial plan | Vertical modules |
|---|---|---|
| `computer_shop` | Computer Shop Standard | Serial numbers, warranty |
| `bike_service` | Bike Service Standard | Job cards (bike service) |

Both get the shared core: catalogue, stock, purchase, sales, customers, reports, notifications, users, settings.

## Prerequisites

- Node.js 22+
- pnpm 10 (`corepack enable`)
- Docker with Compose

## Run it locally

```bash
docker compose up -d
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm db:migrate` copies `.env.example` to `.env` if needed, applies Prisma migrations, then reapplies `apps/api/prisma/sql/post-migrate.sql` (roles, grants, RLS, append-only audit).

- Web: http://localhost:4317 (http://127.0.0.1:4317 works the same)
- API health: http://localhost:4318/api/health

Postgres is on host port **54329**, Redis on **63799**.

### Demo businesses

Password for every demo user: `Demo@12345`

| Business | Email | What you should see |
|---|---|---|
| ByteBazaar Computers (Mumbai) | `owner@bytebazaar.demo` | Serial numbers and warranty in the sidebar. No job cards. |
| ByteBazaar manager | `manager@bytebazaar.demo` | Same modules, without settings management. |
| ByteBazaar sales, Andheri only | `sales@bytebazaar.demo` | Catalogue and stock for the showroom only. |
| Spoke & Sprocket (Bengaluru) | `owner@spoke.demo` | Job cards. No serial or warranty. |
| Service advisor | `advisor@spoke.demo` | Front desk role. |
| Mechanic, workshop only | `mechanic@spoke.demo` | Dashboard, stock, and job cards. |

Sign up creates a new trial tenant the same way. Pick computer shop or bike service on the form.

## Tests

```bash
docker compose up -d
pnpm db:migrate
pnpm test
```

`apps/api/test/isolation.e2e-spec.ts` checks that one tenant cannot read another’s products over HTTP (including a spoofed `x-tenant-id` header) and that the `inventory_app` role sees nothing without a tenant setting and cannot insert a row for a different tenant.

`apps/api/test/module-guard.e2e-spec.ts` checks that serial numbers are open for a computer shop and closed for a bike centre, that switching catalogue off returns `MODULE_DISABLED`, and that a computer shop cannot turn on bike service.

## Folder map

```
apps/api/src/modules/auth        signup, login, refresh, JWT
apps/api/src/modules/tenancy     plan seed, tenant provisioning, session shape
apps/api/src/common              RLS transaction, module guard, permission guard
apps/api/src/modules/catalogue   categories, brands, products, variants
apps/api/src/modules/stock       on-hand view and ledger adjustments
apps/api/src/modules/users       users, roles, permissions
apps/api/src/modules/locations   stores, warehouses, service bays
apps/api/src/modules/settings    profile and module toggles
apps/api/prisma                  schema, migration, RLS script, seed
apps/web/src/messages/en.json    all UI copy
apps/web/src/app                 login, signup, dashboard, catalogue, stock, users, locations, settings
```

Stock changes go through one statement that inserts or increments `stock_levels` and refuses a negative result, then writes `stock_movements` in the same transaction. `stock_levels` is a cache. The ledger is the source of truth.

## Decisions that differ from the full plan

This slice is the foundation, not the MVP.

- **Email and password**, not mobile OTP. OTP, 2FA, and SMS stay later.
- **Zoho Books is not connected.** The plan requires a one-way push in the MVP. The connector, outbox, and tax mapping are the integration stream after invoices exist.
- **No S3 yet.** Images and PDFs are not in this slice. Redis is used for login rate limiting and the health check. Queues (BullMQ) arrive with background work.
- **Placeholder screens** for purchase, sales, customers, reports, serials, warranty, job cards, and notifications. They exist so both module sets are visible and the API already rejects them when the module is off.
- **Plan prices are not stored.** The plan document leaves them as placeholders.
- **Locations are part of the core**, not a separately billed module. Plans still cap how many you can create.
- **Product name is Stockkeep.** The plan did not name the product.

## What to build next

Follow the plan’s build order: shared core, then both verticals, then Zoho.

1. **Suppliers, purchase orders, and GRN.** Goods receipt writes the stock ledger (and, later, captures serials).
2. **Customers**, with mobile as the lookup and GSTIN plus state for B2B.
3. **One GST invoice engine** for POS and bike service: HSN/SAC, place of supply, CGST+SGST or IGST, amounts in `NUMERIC`, no hard deletes.
4. **Computer shop serial / IMEI** on that receipt and invoice, plus warranty dates from the sale.
5. **Bike service**: vehicle registry, job cards, estimates, mechanic assignment, parts issue (including part-litres), labour with a SAC code, and the same invoice.
6. **Zoho Books one-way sync**: per-tenant OAuth, India data centre, outbox, external id map, tax mapping, sync log.
7. **Essential reports**, including GSTR-1 data in Excel.

Anything not in the plan’s MVP table stays in the Phase 2 backlog.
