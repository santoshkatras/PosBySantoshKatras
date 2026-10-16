# SKPOS

Designed and developed by Santosh Katras - Vambori, Mob. 9975658762.

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
| SK Company Multi Business, Mumbai | owner@bytebazaar.demo | Computer shop. Serial and warranty modules. Andheri showroom and Bhiwandi warehouse. |
| SK Company Multi Business sales | sales@bytebazaar.demo | Andheri showroom only. |
| Spoke & Sprocket, Bengaluru | owner@spoke.demo | Car & bike workshop. Workshop board, job cards, customer history. Workshop and parts store. |
| Spoke mechanic | mechanic@spoke.demo | Workshop stock only. |

Other seeded users: manager@bytebazaar.demo, advisor@spoke.demo.

`npm test` checks tenant isolation, the module guard, and the stock ledger. `npm run build` writes `client/dist`. `npm start` builds the app and serves that build in production mode (works on Windows, macOS and Linux).

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
- `catalyst_auth`: false, because SKPOS signs users in itself
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

## Car and bike service module

Open **Vehicle Service → Workshop board** after signing in as a Spoke & Sprocket user. The flow follows a real Indian workshop:

1. **Check-in** (New job card): find the customer by mobile, name, or registration number, or add a new one. Pick the car or bike, record odometer, fuel level, complaints in the customer's words, labour from the car or bike menu, promised delivery time, mechanic and bay. Then the walk-around (scratches, dents, broken parts) and the belongings left in the vehicle.
2. **Estimate and approval**: add labour and parts from stock. Send the estimate on WhatsApp, then record the customer's decision line by line (approve or decline), and how they approved (in person, phone, WhatsApp).
3. **Work**: the mechanic starts the job, ticks off tasks, and can add extra work he finds. Extra work waits for customer approval. A job can be held for parts and resumed.
4. **Parts counter**: approved parts are issued from a stock location to the job. This writes `job_issue` rows to the same stock ledger. Returns write `job_return`. Cancelling a job puts issued parts back automatically.
5. **Quality check**: the advisor ticks the road-test checklist (different for cars and bikes). Passing QC raises a GST tax invoice (`SI-00001`), with CGST and SGST in-state and IGST for a customer from another state. Labour uses SAC 998714 at 18%; parts use their own HSN and GST rate.
6. **Payment and delivery**: take advances or payments by cash, UPI, card, bank, or insurance. Delivery needs the balance cleared, or credit allowed. Odometer out, next service date and km, and the customer rating are saved on the vehicle.

**Customer history**: click any customer name (board tiles, job cards, job list, customers list, reminders) to open their full story: every vehicle with odometer, next service, insurance and PUC dates; every visit with complaints, work done, parts, amount, mechanic, and rating; a parts-fitted list; payments; 12-month spend; outstanding balance; and repeat complaints.

**Live updates**: the board, job cards, and customer pages update on their own when anyone changes a job (server-sent events from `/api/service/stream`, with a one-minute refresh as backup).

**Service due & renewals** lists vehicles whose service, insurance, or PUC falls due, with a WhatsApp reminder and a one-click check-in.

Roles: owner, manager, and service advisor run the desk. Mechanics see their own and unassigned jobs, start work, tick tasks, request parts or extra work, and send to QC. Demo users: `advisor@spoke.demo`, `mechanic@spoke.demo`, `mechanic2@spoke.demo` (password `Demo@12345`).

### Catalyst Data Store tables for the service module

Create these tables in the Development Data Store before using the module on Catalyst (the local demo mode needs nothing). Every table also has `id`, `row_key`, and `company_id` like the others. Use Text columns for long or JSON fields.

| Table | Columns |
| --- | --- |
| `customers` | name, mobile, alt_mobile, email, address, city, state_code, gstin, notes, created_at |
| `vehicles` | customer_id, vehicle_type, reg_no, make, model, variant, fuel_type, year, color, vin, engine_no, insurer, insurance_expiry, puc_expiry, odometer, next_service_date, next_service_km, last_service_at, created_at |
| `job_cards` | job_no, customer_id, vehicle_id, location_id, service_type, status, odometer_in, odometer_out, fuel_level, complaints (Text), inspection (Text), accessories (Text), advisor_id, mechanic_id, bay, promised_at, checked_in_at, approved_at, approval_channel, started_at, qc_at, qc_checks (Text), qc_note, ready_at, invoice_no, invoiced_at, delivered_at, cancelled_at, cancel_reason, next_service_date, next_service_km, rating, feedback, credit_allowed, insurer, claim_no, coupon_no, notes, labour_total, parts_total, tax_total, grand_total, estimate_total, paid_total, pending_count, updated_at |
| `job_lines` | job_id, line_type, description, variant_id, sku, hsn_sac, qty, rate, discount, gst_rate, hours, approval, issued_qty, issue_location_id, mechanic_id, done, requested_by, created_at |
| `job_events` | job_id, kind, text, user_id, user_name, created_at |
| `job_payments` | job_id, customer_id, amount, mode, reference, kind, user_id, user_name, created_at |
| `serials` | product_id, variant_id, location_id, serial1, serial2, attr1, attr2, attr3, mrp, sale_price, cost_price, status, created_at, removed_at |
| `suppliers` | name, mobile, email, address, city, state_code, gstin, notes, created_at |
| `price_lists` | code, name, status, data (JSON: rule, customers, products, validity, happy time), created_at, updated_at |
| `price_updates` | number, note, data (JSON: lines with old and new MRP / selling / cost, serial when per serial), user_name, created_at |
| `documents` | module (purchase / sales), doc_type (order, receipt, invoice / quotation, order, bill), number, doc_date, party_id, party_name, location_id, status, source_number, total, data (JSON: party, lines, totals, GST, conversion), user_name, created_at |

`npm test` now also runs `server/service.test.mjs`, which walks a car through the whole flow and checks GST totals, stock issue, role limits, and tenant isolation.

## Customer and supplier masters

**Sales → Customers** and **Purchase → Suppliers** use the same list and master screens as Product.

- GST type: Registered, Unregistered or Composition. Registered and Composition need a GSTIN; the check digit is verified and the state and PAN are filled from it. The list has a separate **GSTIN** search box.
- Pincode: typing a 6-digit pincode loads the post-office areas (India Post) and fills taluka, district, state and country.
- Bank: the IFSC fills bank name, branch, bank address, city and MICR (Razorpay IFSC directory). Searching an account number fills the details already saved in SKPOS for that account.
- Full GST portal details (legal name, trade name, address) need a GST lookup key: set `GSTINCHECK_KEY` (from gstincheck.co.in) before starting the server. Without it the GSTIN is still validated and decoded.
- Banks do not publish account-holder names by account number. Fetching the holder name for a new account needs a paid bank-account verification service (penny drop), which can be added later.
- Extra master fields (type, address parts, bank, credit terms) are stored in `settings` as `party_customer_<id>` / `party_supplier_<id>`.

## Price lists

**Inventory → Price list** lists every price list; **+ Create PL** opens the form.

- Customers: all customers, selected customers, or by customer GST type.
- Types: Fixed price per product; Slab wise (quantity ranges on sale price, MRP or cost, each with its own markup or markdown).
- Options: rounding (₹0.50, ₹1, ₹5, ₹10, end with 9), never below cost, never above MRP, product overrides, include / exclude products.
- Validity (from / to), Happy Days (weekdays), Happy Hours (time windows) and Happy Dates (specific dates).
- Priority decides between lists that apply at the same time (lowest number first, then the lower price). The **Check** tab shows which price a customer gets for a product, quantity and time (`POST /api/price-lists/resolve`).

## Price updates

**Inventory → Price Updates** works like Opening Stock Entry: a list of updates (PU-0001 …) and **+ Create Price Update**. Scan or search items; a window opens by item type:
- Standard: current and new MRP, selling and cost price, with the change % and margin.
- Matrix: every variant with current and new prices, copy-down and "change by %".
- Serialised: the item price plus every serial number in stock with its own prices; copy the item price to the serials or change by %.
Selling price cannot be above MRP. Saving updates the item master (and the serials) and keeps the old and new prices in the update for later viewing.

## How this differs from the first foundation

The first cut used pnpm, Next.js, NestJS, Postgres with row-level security, and Redis. A later cut used a SQLite file so the process could start without Docker. This cut keeps the same product flows and stores rows in Catalyst Data Store, the way TechCizHRMS does.

Tenant isolation is in the queries: every business read and write filters on `company_id`. The API ignores a spoofed tenant header and uses the signed-in user. Passwords are scrypt hashes. Access tokens last 15 minutes. The refresh token is an httpOnly cookie named `sk_refresh`.

## Still to build

Purchase and goods receipt, GST invoices for counter sales, serial and IMEI, warranty lookup, reports, notifications, and a Zoho Books sync. Those modules are entitled by plan and can be toggled in Settings.

## Purchase and sales documents

- **Purchase:** Purchase Order (PO) → Receipt Note (GRN) → Purchase Invoice (PI). A PO converts to a Receipt Note or straight to a Purchase Invoice; a Receipt Note converts to a Purchase Invoice.
- **Sales:** Sales Quotation (SQ) → Sales Order (SO) → Sales Bill (SB). A quotation converts to an order or straight to a bill; an order converts to a bill.
- All six use the Opening Stock Entry item table: pick an item by code or name and a window opens for its type (Standard, Matrix, Serialised).
- Stock: Receipt Notes and direct Purchase Invoices receive stock (serialised items need the serial numbers); a Purchase Invoice made from a Receipt Note does not receive it again. Sales Bills take stock out (serialised items pick in-stock serial numbers). Orders and quotations do not change stock.
- Partial conversion: each conversion copies only the quantity still pending, and a document can be converted several times until nothing is pending. Status shows Partially / Fully Received, Invoiced, Ordered or Billed (or Partially / Fully Converted when it went to more than one type). The remaining balance can be closed (Short Closed).
- GST: CGST + SGST when the party is in the business's state, IGST otherwise. Rates can be entered with or without GST. Each document has a printable copy.

## Purchase formulas (Configuration → Purchase Configurations)

- A formula turns the supplier's bill into the net purchase rate (taxable value per unit) and the landing cost (saved as the item's cost price).
- Starting value: the supplier rate, or MRP less a margin (MRP with or without GST). Then up to three discounts (compound or flat), freight (% or ₹ per unit, on the invoice or only in landing cost), other charges, GST in landing cost (auto for unregistered / composition suppliers), and rounding.
- Optional custom expressions for the net rate and landing cost using MRP, RATE, GST, MARGIN, D1–D3, FRTPCT, FRT, OTH, BASE, NET, TAX with + − × ÷, brackets, percentages, MIN, MAX, ROUND.
- Supplier mapping: each supplier uses its mapped formula, else the default formula. Purchase Orders, Receipt Notes and Purchase Invoices apply it automatically; the server recalculates every rate.
- Stored in settings under `purchase_formulas` (formulas, defaultId, mapping).
