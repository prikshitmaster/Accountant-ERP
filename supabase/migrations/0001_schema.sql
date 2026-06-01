-- =============================================================
-- Phase 1 — Schema: tenancy, chart of accounts, vouchers, ledger,
-- parties, inventory, locks, audit, settings + helper functions.
-- Money = bigint paise. Quantity = numeric(18,4). Rates = bigint paise.
-- =============================================================

create extension if not exists pgcrypto;

-- ---------- Reference / lookup tables (global, not org-scoped) ----------
create table account_groups (
  id   smallint primary key,
  name text not null
);
insert into account_groups(id,name) values
  (1,'Asset'),(2,'Liability'),(3,'Equity'),(4,'Income'),(5,'Expense');

create table item_types (
  id   smallint primary key,
  code text not null,
  name text not null
);
insert into item_types(id,code,name) values
  (1,'raw_material','Raw Material'),
  (2,'finished_good','Finished Good'),
  (3,'consumable','Consumable'),
  (4,'trading_good','Trading Good');

create table voucher_types (
  id   smallint primary key,
  code text not null,
  name text not null
);
insert into voucher_types(id,code,name) values
  (1,'SALE','Sales'),
  (2,'PURCHASE','Purchase'),
  (3,'RECEIPT','Receipt'),
  (4,'PAYMENT','Payment'),
  (5,'CONTRA','Contra'),
  (6,'JOURNAL','Journal'),
  (7,'CREDIT_NOTE','Credit Note'),
  (8,'DEBIT_NOTE','Debit Note'),
  (9,'STOCK_JOURNAL','Stock Journal'),
  (10,'OPENING','Opening');

-- ---------- Tenancy & users ----------
create table organizations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  fy_start_month smallint not null default 4,
  created_at     timestamptz not null default now()
);

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations on delete cascade,
  user_id    uuid not null references auth.users,
  role       text not null check (role in ('owner','accountant','staff')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index on memberships (user_id);

-- ---------- Chart of accounts ----------
create table accounts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations on delete cascade,
  code         text,
  name         text not null,
  group_id     smallint not null references account_groups,
  parent_id    uuid references accounts,
  system_key   text,                       -- stable key for system accounts (cash, bank, ...)
  is_control   boolean not null default false,
  is_inventory boolean not null default false,
  is_system    boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (org_id, name)
);
create index on accounts (org_id, group_id);
create index on accounts (org_id, parent_id);
create unique index accounts_org_system_key_uq on accounts (org_id, system_key) where system_key is not null;

-- ---------- Parties (subsidiary ledgers) ----------
create table parties (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations on delete cascade,
  name              text not null,
  kind              text not null check (kind in ('customer','supplier','both')),
  phone             text,
  ledger_account_id uuid not null references accounts,
  created_at        timestamptz not null default now()
);
create index on parties (org_id, kind);

-- ---------- Vouchers & ledger ----------
create table voucher_sequences (
  org_id       uuid not null references organizations on delete cascade,
  voucher_type smallint not null references voucher_types,
  fy_year      smallint not null,
  next_no      integer not null default 1,
  primary key (org_id, voucher_type, fy_year)
);

create table vouchers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations on delete cascade,
  voucher_type smallint not null references voucher_types,
  voucher_no   text not null,
  date         date not null,
  narration    text,
  party_id     uuid references parties,
  status       text not null default 'posted' check (status in ('posted','cancelled')),
  reverses_id  uuid references vouchers,
  created_by   uuid not null references auth.users,
  created_at   timestamptz not null default now(),
  unique (org_id, voucher_type, voucher_no)
);
create index on vouchers (org_id, date);
create index on vouchers (org_id, party_id, date);

create table ledger_entries (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations on delete cascade,
  voucher_id uuid not null references vouchers on delete cascade,
  account_id uuid not null references accounts,
  party_id   uuid references parties,
  debit      bigint not null default 0,
  credit     bigint not null default 0,
  date       date not null,
  check ((debit = 0) <> (credit = 0)),
  check (debit >= 0 and credit >= 0)
);
create index on ledger_entries (org_id, account_id, date);
create index on ledger_entries (org_id, voucher_id);
create index on ledger_entries (org_id, party_id, date);

-- ---------- Invoices / bills / allocations (used from Phase 2) ----------
create table invoices (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations on delete cascade,
  party_id    uuid not null references parties,
  voucher_id  uuid not null references vouchers,
  invoice_no  text not null,
  date        date not null,
  total       bigint not null,
  outstanding bigint not null,
  created_at  timestamptz not null default now()
);
create index on invoices (org_id, party_id);

create table bills (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations on delete cascade,
  party_id    uuid not null references parties,
  voucher_id  uuid not null references vouchers,
  bill_no     text not null,
  date        date not null,
  total       bigint not null,
  outstanding bigint not null,
  created_at  timestamptz not null default now()
);
create index on bills (org_id, party_id);

create table allocations (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations on delete cascade,
  payment_voucher_id uuid not null references vouchers,
  target_kind        text not null check (target_kind in ('invoice','bill')),
  target_id          uuid not null,
  amount             bigint not null,
  created_at         timestamptz not null default now()
);

-- ---------- Inventory ----------
create table stock_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations on delete cascade,
  name          text not null,
  item_type     smallint not null references item_types,
  unit          text not null,
  qty_on_hand   numeric(18,4) not null default 0,
  avg_cost      bigint not null default 0,
  value_on_hand bigint not null default 0,
  min_level     numeric(18,4) not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index on stock_items (org_id, item_type);

create table stock_movements (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations on delete cascade,
  stock_item_id uuid not null references stock_items,
  voucher_id    uuid references vouchers,
  date          date not null,
  qty_change    numeric(18,4) not null,
  unit_cost     bigint not null,
  value_change  bigint not null,
  balance_qty   numeric(18,4) not null,
  balance_value bigint not null,
  reason        text,
  created_at    timestamptz not null default now()
);
create index on stock_movements (org_id, stock_item_id, date);

-- ---------- Period locks, snapshots, audit, settings ----------
create table period_locks (
  org_id    uuid primary key references organizations on delete cascade,
  lock_upto date not null
);

create table account_balance_snapshots (
  org_id     uuid not null references organizations on delete cascade,
  account_id uuid not null references accounts,
  period     date not null,
  closing_dr bigint not null,
  closing_cr bigint not null,
  primary key (org_id, account_id, period)
);

create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations on delete cascade,
  user_id    uuid not null references auth.users,
  action     text not null,
  entity     text,
  entity_id  uuid,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index on audit_log (org_id, created_at);

create table org_settings (
  org_id                uuid primary key references organizations on delete cascade,
  business_name         text,
  owner_name            text,
  negative_stock_policy text not null default 'warn'
                        check (negative_stock_policy in ('block','warn','allow')),
  updated_at            timestamptz not null default now()
);

-- =============================================================
-- Helper functions (membership / role)
-- =============================================================
create or replace function is_org_member(target_org uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
  );
$$;

create or replace function org_role(target_org uuid)
returns text language sql security definer stable set search_path = public as $$
  select role from memberships
  where org_id = target_org and user_id = auth.uid();
$$;

create or replace function sys_account(p_org uuid, p_key text)
returns uuid language sql security definer stable set search_path = public as $$
  select id from accounts where org_id = p_org and system_key = p_key limit 1;
$$;
