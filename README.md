# Godown Inventory

Internal stock app for a godown that receives goods from a main warehouse.
Records what comes in each day, what goes out, what everything is worth, and
warns when something is running low.

Built with Next.js (App Router) + TypeScript + Tailwind. Data lives in JSON
files today, behind a repository layer so a real database is a contained swap.

---

## Running it

```bash
npm install
npm run seed        # sample categories, products and ~3 weeks of entries
npm run dev         # http://localhost:3000
```

Sign in with one of the seeded accounts:

| Role  | Username | Password       | Can do                                     |
|-------|----------|----------------|--------------------------------------------|
| Admin | `admin`  | `admin@12345`  | Everything, including products and users   |
| Staff | `ramesh` | `staff@12345`  | Record stock entries, view rates and stock  |

**Change both passwords from the Users screen before anyone else uses this.**

### Environment

`.env.local` is created for you on first setup. It needs:

```ini
SESSION_SECRET=<32+ random characters>   # signs the login cookie
DB_DRIVER=json                           # storage driver
DATA_DIR=data                            # where the JSON files live
```

Generate a fresh secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Changing `SESSION_SECRET` signs everyone out.

### Scripts

| Command              | What it does                                        |
|----------------------|-----------------------------------------------------|
| `npm run dev`        | Development server                                  |
| `npm run build`      | Production build                                    |
| `npm start`          | Serve the production build                          |
| `npm run seed`       | Fill empty data files with sample data              |
| `npm run seed:reset` | Wipe `data/` and reseed from scratch                |
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
| **Daily Log** | Day-by-day history, filterable by date range, type and product |
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

Each entry also snapshots the rate at the time it was logged, so changing a
product's rate today does not rewrite the value of last month's receipts.

---

## Moving to a real database

The app never touches JSON directly. Everything goes through
`getRepositories()` in `src/server/db/index.ts`, which returns objects matching
the interfaces in `src/server/db/repositories.ts`.

```
src/server/db/
  types.ts          domain entities (map 1:1 onto table columns)
  repositories.ts   the contracts — findMany/create/update/delete
  index.ts          picks a driver from DB_DRIVER
  json/             the current file-based implementation
```

To switch to Postgres, SQLite, or anything else:

1. Add `src/server/db/sql/` implementing the same interfaces.
2. Add a `case "sql":` to the switch in `src/server/db/index.ts`.
3. Set `DB_DRIVER=sql`.

No page, service or action changes. The interfaces are deliberately shaped like
SQL — `findMany({ where, orderBy, skip, take })`, `sumDeltaByProduct()` which
becomes a `GROUP BY`, `deleteMany(ids)` which becomes `DELETE ... WHERE id IN`.
Ids are UUID strings and timestamps are ISO strings, so both map straight across.

### Before you outgrow the JSON store

The file store serialises writes with an **in-process** lock and writes through
a temp file so a crash can't truncate data. It also re-reads a file when its
mtime changes, so editing the JSON by hand or reseeding is picked up without a
restart.

What it cannot do is coordinate **two processes**. Running more than one
instance against the same `data/` directory will race and lose writes. If you
need multiple instances, or you outgrow a few thousand entries, that is the
signal to do the swap above.

Back up by copying the `data/` folder. It is gitignored, so it never leaves the
machine on its own.

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
