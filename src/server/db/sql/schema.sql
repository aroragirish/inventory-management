-- Godown Inventory schema for Postgres (Neon).
--
-- Mirrors src/server/db/types.ts one field per column. Money is numeric so
-- rupees never drift the way floats do; quantities allow three decimals for
-- part-units. Ids stay text uuids to match what the JSON store already wrote,
-- so existing data migrates across untouched.
--
-- Safe to run more than once.

create table if not exists users (
  id            uuid primary key,
  name          text        not null,
  username      text        not null unique,
  password_hash text        not null,
  salt          text        not null,
  role          text        not null check (role in ('admin', 'staff')),
  active        boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists categories (
  id          uuid primary key,
  name        text        not null,
  description text        not null default '',
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists products (
  id                  uuid primary key,
  name                text          not null,
  sku                 text          not null,
  category_id         uuid          not null references categories (id),
  unit                text          not null default 'pcs',
  cost_price          numeric(12, 2) not null default 0,
  selling_price       numeric(12, 2) not null default 0,
  mrp                 numeric(12, 2) not null default 0,
  inner_pack          numeric(12, 2) not null default 0,
  master_pack         numeric(12, 2) not null default 0,
  low_stock_threshold numeric(14, 3) not null default 0,
  opening_stock       numeric(14, 3) not null default 0,
  needs_pricing       boolean       not null default false,
  active              boolean       not null default true,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now()
);

create unique index if not exists products_sku_key on products (lower(sku));
create index if not exists products_category_idx on products (category_id);

-- Stock is never stored as a number: it is summed from these rows.
create table if not exists stock_entries (
  id               uuid primary key,
  type             text          not null check (type in ('IN', 'OUT', 'ADJUST')),
  product_id       uuid          not null references products (id),
  quantity         numeric(14, 3) not null,
  delta            numeric(14, 3) not null,
  cost_at_entry    numeric(12, 2) not null default 0,
  selling_at_entry numeric(12, 2) not null default 0,
  date             date          not null,
  reference        text          not null default '',
  note             text          not null default '',
  created_by       uuid          not null,
  created_at       timestamptz   not null default now()
);

-- The two queries that matter: the stock sum, and the daily log.
create index if not exists stock_entries_product_idx on stock_entries (product_id);
create index if not exists stock_entries_date_idx on stock_entries (date desc);

create table if not exists rate_changes (
  id         uuid primary key,
  product_id uuid          not null references products (id),
  field      text          not null check (field in ('cost', 'selling')),
  old_rate   numeric(12, 2) not null,
  new_rate   numeric(12, 2) not null,
  changed_by uuid          not null,
  changed_at timestamptz   not null default now(),
  note       text          not null default '',
  created_at timestamptz   not null default now()
);

create index if not exists rate_changes_product_idx on rate_changes (product_id);

create table if not exists notifications (
  id         uuid primary key,
  type       text        not null,
  title      text        not null,
  message    text        not null,
  product_id uuid,
  read_by    jsonb       not null default '[]'::jsonb,
  created_by uuid        not null,
  created_at timestamptz not null default now()
);

create index if not exists notifications_created_idx on notifications (created_at desc);

-- Tally's item names, resolved once and remembered.
-- product_id null means "known, and deliberately not one of ours".
create table if not exists stock_aliases (
  id            uuid primary key,
  external_name text        not null,
  normalized    text        not null unique,
  product_id    uuid references products (id),
  created_by    uuid        not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- An uploaded stock file plus its reviewed lines. The lines travel together
-- and are always read as a whole, so they live as one jsonb document.
create table if not exists stock_imports (
  id          uuid primary key,
  file_name   text        not null,
  date        date        not null,
  status      text        not null check (status in ('pending', 'approved', 'discarded')),
  lines       jsonb       not null default '[]'::jsonb,
  uploaded_by uuid        not null,
  approved_by uuid,
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists stock_imports_status_idx on stock_imports (status, created_at desc);
