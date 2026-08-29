# Godown Inventory

Internal stock app for a distribution business: goods come in from the supplier
and go out to distributors. Tracks what arrived, what sold, what it is worth and
what it earned, and reconciles daily against the Tally stock summary.

Built with Next.js (App Router) + TypeScript + Tailwind, on Postgres. Storage
sits behind a repository layer, so the local JSON file store and the database
are interchangeable.

---

## Running it

```bash
npm install
npm run data:rebuild  # build the catalogue from the Tally stock summary
npm run db:push       # create the schema and load it into Postgres
npm run dev           # http://localhost:3000
```

Working offline, or without a database? Set `DB_DRIVER=json` in `.env.local`
and skip `db:push` — the app then reads and writes the files under `data/`.

Sign in with one of the seeded accounts:

| Role  | Username | Password       | Can do                                     |
|-------|----------|----------------|--------------------------------------------|
| Admin | `admin`  | `admin@12345`  | Everything, including products and users   |
| Staff | `ramesh` | `staff@12345`  | Record stock entries, view rates and stock  |

**Change both passwords from the Users screen before anyone else uses this.**

### Environment

Copy `.env.example` to `.env.local`. Two variables matter:

```ini
# Signs the login cookie. 32+ characters. Changing it signs everyone out.
SESSION_SECRET=<32+ random characters>

# Neon Postgres. Set it and the app uses the database; leave it out and it
# falls back to the JSON files under data/.
DATABASE_URL=postgresql://user:pass@host.neon.tech/dbname?sslmode=require
```

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use a **different** `SESSION_SECRET` in production from the one on your machine.

### Scripts

| Command              | What it does                                        |
|----------------------|-----------------------------------------------------|
| `npm run dev`        | Development server                                  |
| `npm run build`      | Production build                                    |
| `npm start`          | Serve the production build                          |
| `npm run data:rebuild`| Rebuild the catalogue from the stock summary + price list |
| `npm run data:price-list` | Re-join the two halves of the price list       |
| `npm run data:review`| Render the rebuild audit as a readable page          |
| `npm run data:build` | Rebuild from the source spreadsheets (superseded)   |
| `npm run db:push`    | Create the schema and load `data/` into Postgres    |
| `npm run db:test`    | Check the schema and queries against real Postgres  |
| `npm run smoke`      | End-to-end check against a running dev server       |
| `npm run typecheck`  | TypeScript, no emit                                 |
| `npm run lint`       | ESLint                                              |

---

## The screens

| Screen | What it's for |
|---|---|
| **Dashboard** (`/`) | The landing screen — today's inward/outward, stock value, what needs restocking, last 14 days |
| **Rates & Items** (`/rates`) | Every item with its rate and current stock |
| **New Entry** | The daily job: log a challan of goods received, or goods dispatched |
| **Inventory** | Search and filter stock; admins add products and change rates here |
| **Products** (`/products`) | Admin only — the catalogue itself. Every product, one click from being edited: name, code, category, unit, both prices, alert level, payment pending |
| **Daily Log** | Day-by-day history, filterable by date range, type and product |
| **Stock File** | Upload the Tally stock summary, review the differences, then apply them |
| **Categories** | Group products so lists stay manageable |
| **Users** | Admin only — who can sign in, and what they can do |

The bell in the header shows stock updates, rate changes and low-stock warnings.
It refreshes every 30 seconds while the tab is open.

Light and dark themes follow the system setting by default; the toggle in the
header overrides it. Every screen is built mobile-first — phones get a bottom
tab bar and card layouts, desktops get the top nav and tables.

---

## How stock is calculated

Stock is **never stored as a number**. It is always:

```
current stock = opening stock + sum of every entry's delta
```

Entries carry a signed `delta` (`+` for received, `−` for dispatched, either
for a correction). That means the entry log is the single source of truth —
there is no stored counter that can drift out of step with it. Delete a wrong
entry and the stock corrects itself.

Each entry snapshots **both** prices as they were at the time, so purchases stay
valued at what you paid and sales at what you charged. Changing a price today
does not rewrite last month's figures, and the margin between the two is real.

Stock is allowed to go negative, because Tally allows it and this app mirrors
Tally. Negative items are flagged on the dashboard rather than hidden.

### Goods received but not paid for

Tally shows a negative closing balance when goods arrived and no purchase bill
was passed against them. The stock is genuinely on the shelf — what is
outstanding is the money. So the catalogue carries both facts separately:

```
opening stock       the quantity, counted positively, because it is there
paymentPendingQty   the part of it the supplier has not been paid for
```

The dashboard totals what is owed, the Products screen filters to it, and the
Inventory rows badge it. Set the pending quantity back to 0 once the bill is
settled — nothing else moves, because no stock moved.

---

## Where the catalogue comes from

Two documents, each authoritative about a different thing:

- the **Tally stock summary** says what we stock and how much of it;
- the **price list** says what each item costs and sells for.

`npm run data:rebuild` joins them into the whole data set:

```
scripts/data/stock-summary-<date>.json    the report, transcribed whole and
                                           reconciled to its printed Grand Total
scripts/data/price-list/*.csv             the two halves of the price list -
                                           Itwari carries SS, UltraClean Dist.
scripts/data/price-list-<date>.json       the two, joined by item name
scripts/data/price-carryover-map.json     hand-checked Tally name -> list item
scripts/data/catalogue-decisions.json     the calls no document could settle,
                                           each with the reason behind it
scripts/data/rebuild-audit.json           written every run: what happened to
                                           every single line, and why
```

`npm run data:price-list` rebuilds the joined list from the CSVs;
`npm run data:review` renders the audit as a page you can read.

Both prices come from the price list. Tally's closing rate is a weighted average
of what was paid across the year, and it had drifted more than 10% from the list
on a third of the catalogue — taking both prices from one document is what makes
every margin real. An item the list does not carry keeps its Tally rate as cost
and is badged for a selling price.

Items are matched onto the list by confirmed alias, identical name, or that
hand-checked table — **never** by fuzzy match. Measured against this data the
matcher scored "Master Clean Phynile 1 Lit" onto "White Phenyle 1 Lit" above the
auto-accept floor. A wrong price is silent; a missing one is badged on screen
until somebody fills it in.

The same discipline caught two mappings the app had been carrying for months:
"Amaze Wiper 20\"" pointed at *Amaze Kitchen Wiper*, and "Bleaching Powder" at
*Power*, which is a broom. The check that found them is in
`scripts/propose-price-mapping.mjs`: Tally's rate should land near the list's SS
price when a match is right, so a large gap is evidence of a wrong one.

## Storage

The app talks to storage only through `getRepositories()` in
`src/server/db/index.ts`, which returns objects matching the interfaces in
`src/server/db/repositories.ts`. Two drivers implement them:

```
src/server/db/
  types.ts          domain entities (one field per column)
  repositories.ts   the contracts - findMany/create/update/delete
  index.ts          picks a driver
  json/             local files under data/ - development
  sql/              Postgres - what runs in production
```

Which one runs is inferred: **set `DATABASE_URL` and it uses Postgres**,
otherwise it falls back to the JSON files. `DB_DRIVER=json` forces files even
when a connection string is present, which is handy offline.

No page, service or action knows the difference.

### Database commands

| Command | What it does |
|---|---|
| `npm run db:push` | Create the schema, then load `data/` if the tables are empty |
| `npm run db:push -- --force` | Wipe the database and reload from `data/` |
| `npm run db:test` | Verify the schema and every query against real Postgres, offline |

`npm run db:test` runs against PGlite — Postgres compiled to WebAssembly — so
schema or query mistakes surface without touching your real database.

### The JSON store is for development only

It serialises writes with an **in-process** lock and writes through a temp file
so a crash cannot truncate data, and it re-reads a file when its mtime changes.
What it cannot do is coordinate two processes, and it needs a writable disk —
which is exactly why it cannot run on Vercel. Use it locally; use Postgres
anywhere else.

---

## Deploying to Vercel

The app is built for it: every data route is server-rendered on demand, and
storage is Postgres over HTTP, which suits an environment that may start a
fresh instance per request.

**1. Create the database.** In your Vercel project → Storage → add Neon
(free tier is far more than this needs). Vercel injects `DATABASE_URL` for you.
Or create one at [neon.tech](https://neon.tech) and paste the connection string
in yourself.

**2. Set the environment variables** in Project Settings → Environment
Variables:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | 32+ random characters. **Use a different one from local.** |
| `DATABASE_URL` | Your Neon connection string (auto-set if you used the integration) |

**3. Load the data once**, from your machine, with `DATABASE_URL` pointing at
the production database:

```bash
npm run db:push
```

**4. Deploy** — push to GitHub and import the repo, or run `vercel`.

**5. Sign in and change both seeded passwords** from the Users screen.

### What does not ship

`data/` is gitignored, so the JSON files never reach a deployment. That is
deliberate: production reads from Postgres, and your local files stay local.
Back up by taking a Neon branch or a `pg_dump`.

### One caveat worth knowing

The login throttle counts failed attempts **in memory**. Across several
serverless instances each keeps its own count, so the lockout is looser than it
is locally. Everything else — sessions, permissions, validation — is enforced
per request against the database and is unaffected. Moving the counter into a
table is a small change if you want it tightened.

---

## Security

Internal-use posture — CSP and security headers are deliberately out of scope
for now. What is in place:

- **Sessions** are signed JWTs (HS256, `jose`) in an httpOnly, sameSite=lax
  cookie, secure in production, 7-day expiry.
- **Passwords** use scrypt with a per-user random salt and constant-time
  comparison. Plaintext passwords are never stored or logged.
- **`src/proxy.ts`** blocks every route except `/login` without a valid cookie.
- **Guards run again on the server for every page and every action**
  (`requireUser` / `requireAdminAction`). Hiding a button is never the control —
  posting the request directly still gets refused, and deactivating an account
  takes effect on the next request rather than when the token expires.
- **Nothing sensitive reaches the browser.** Storage modules are marked
  `server-only`, and everything crossing to a client component goes through the
  explicit mappers in `src/server/dto.ts`, which build each object field by
  field so a password hash cannot ride along.
- **Every action validates its input** with a Zod schema before touching storage.
- **Login is throttled** — repeated failures lock an account out for 10 minutes,
  and a wrong password and an unknown username give the identical message so
  usernames can't be probed.

`npm run smoke` asserts all of the above against a running server.

---

## Testing

With the dev server running:

```bash
npm run smoke
```

It resets to seed data, then drives the real HTTP surface — signing in,
recording a multi-product challan, overdrawing stock, tripping a low-stock
alert, changing a rate, and checking that staff are refused admin actions and
that no page leaks a credential. 53 assertions, and it is safe to re-run.
