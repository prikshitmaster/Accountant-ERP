-- =============================================================
-- Phase 1 — Row Level Security & grants
-- Reads: members of an org can SELECT that org's rows.
-- Writes to ledger/voucher/inventory tables: NO client policy ->
--   denied via PostgREST. Only SECURITY DEFINER RPC (owned by the
--   migration role) may write. Defense-in-depth REVOKEs below too.
-- =============================================================

-- Lookup tables: public read.
alter table account_groups enable row level security;
alter table item_types     enable row level security;
alter table voucher_types  enable row level security;
create policy read_all on account_groups for select using (true);
create policy read_all on item_types     for select using (true);
create policy read_all on voucher_types  for select using (true);

-- Org-scoped tables: members read.
alter table organizations             enable row level security;
alter table memberships               enable row level security;
alter table accounts                  enable row level security;
alter table parties                   enable row level security;
alter table voucher_sequences         enable row level security;
alter table vouchers                  enable row level security;
alter table ledger_entries            enable row level security;
alter table invoices                  enable row level security;
alter table bills                     enable row level security;
alter table allocations               enable row level security;
alter table stock_items               enable row level security;
alter table stock_movements           enable row level security;
alter table period_locks              enable row level security;
alter table account_balance_snapshots enable row level security;
alter table audit_log                 enable row level security;
alter table org_settings              enable row level security;

create policy member_read on organizations    for select using (is_org_member(id));
create policy member_read on memberships       for select using (is_org_member(org_id));
create policy member_read on accounts          for select using (is_org_member(org_id));
create policy member_read on parties           for select using (is_org_member(org_id));
create policy member_read on voucher_sequences for select using (is_org_member(org_id));
create policy member_read on vouchers          for select using (is_org_member(org_id));
create policy member_read on ledger_entries    for select using (is_org_member(org_id));
create policy member_read on invoices          for select using (is_org_member(org_id));
create policy member_read on bills             for select using (is_org_member(org_id));
create policy member_read on allocations       for select using (is_org_member(org_id));
create policy member_read on stock_items       for select using (is_org_member(org_id));
create policy member_read on stock_movements   for select using (is_org_member(org_id));
create policy member_read on period_locks      for select using (is_org_member(org_id));
create policy member_read on account_balance_snapshots for select using (is_org_member(org_id));
create policy member_read on audit_log         for select using (is_org_member(org_id));
create policy member_read on org_settings      for select using (is_org_member(org_id));

-- Allow owners to update org settings directly (simple master edit).
create policy owner_update_settings on org_settings for update
  using (org_role(org_id) in ('owner','accountant'))
  with check (org_role(org_id) in ('owner','accountant'));

-- Defense in depth: clients may never write the financial core directly.
revoke insert, update, delete on
  vouchers, ledger_entries, voucher_sequences, invoices, bills, allocations,
  stock_items, stock_movements, accounts, parties, account_balance_snapshots, audit_log
  from anon, authenticated;

-- Grant execute on RPC to logged-in users.
grant execute on function is_org_member(uuid) to anon, authenticated;
grant execute on function org_role(uuid)       to anon, authenticated;
