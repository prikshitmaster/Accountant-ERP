-- =============================================================
-- invoice_lines: per-item selling detail for credit sales.
-- Enables full invoice detail view (qty + rate per item).
-- =============================================================

-- ---------- Table ----------
create table if not exists invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations on delete cascade,
  invoice_id    uuid not null references invoices on delete cascade,
  stock_item_id uuid not null references stock_items,
  qty           numeric(18,4) not null,
  rate          bigint not null,   -- selling price paise/unit
  amount        bigint NOT NULL    -- round(qty * rate)
);
create index if not exists invoice_lines_invoice_id_idx on invoice_lines (invoice_id);

-- ---------- RLS ----------
alter table invoice_lines enable row level security;
drop policy if exists "org member" on invoice_lines;
create policy "org member" on invoice_lines for all using (
  org_id in (select org_id from memberships where user_id = auth.uid())
);
grant select on invoice_lines to authenticated;

-- ---------- Updated sell (GST-aware + populates invoice_lines) ----------
create or replace function sell(
  p_org uuid, p_date date, p_party uuid, p_items jsonb,
  p_mode text default 'credit', p_narration text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := org_role(p_org);
  it jsonb; v_item stock_items%rowtype;
  v_qty numeric(18,4); v_rate bigint; v_line_base bigint; v_gst bigint;
  v_base bigint := 0; v_cogs bigint := 0;
  v_cgst bigint := 0; v_sgst bigint := 0; v_igst bigint := 0; v_total bigint;
  v_lines jsonb := '[]'::jsonb; v_stock jsonb := '[]'::jsonb;
  v_debit_acct uuid; v_party_line uuid; v_party_ledger uuid;
  v_org_state text; v_party_state text; v_inter boolean;
  v_res jsonb;
  v_invoice_id uuid;
begin
  if v_role is null then raise exception 'not_member'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'empty_voucher'; end if;
  if p_mode = 'credit' and p_party is null then raise exception 'party_required'; end if;

  select state_code into v_org_state from org_settings where org_id = p_org;
  if p_party is not null then select state_code into v_party_state from parties where id = p_party and org_id = p_org; end if;
  v_inter := (v_party_state is not null and v_org_state is not null and v_party_state <> v_org_state);

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::numeric; v_rate := (it->>'rate')::bigint;
    select * into v_item from stock_items where id = (it->>'stock_item_id')::uuid and org_id = p_org;
    if not found then raise exception 'unknown_stock_item'; end if;
    v_line_base := round(v_qty * v_rate);
    v_base := v_base + v_line_base;
    v_cogs := v_cogs + round(v_qty * v_item.avg_cost);
    if v_item.gst_rate > 0 then
      if v_inter then
        v_igst := v_igst + round(v_line_base * v_item.gst_rate / 100);
      else
        v_gst := round(v_line_base * (v_item.gst_rate / 2) / 100);
        v_cgst := v_cgst + v_gst; v_sgst := v_sgst + v_gst;
      end if;
    end if;
    v_stock := v_stock || jsonb_build_array(jsonb_build_object(
      'stock_item_id', v_item.id, 'qty_change', -v_qty, 'reason', 'Sale'));
  end loop;
  v_total := v_base + v_cgst + v_sgst + v_igst;

  if p_mode = 'credit' then
    select ledger_account_id into v_party_ledger from parties where id = p_party and org_id = p_org;
    if v_party_ledger is null then raise exception 'unknown_party'; end if;
    v_debit_acct := v_party_ledger; v_party_line := p_party;
  else
    v_debit_acct := sys_account(p_org, case when p_mode = 'bank' then 'bank' else 'cash' end);
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_debit_acct, 'party_id', v_party_line, 'debit', v_total, 'credit', 0),
    jsonb_build_object('account_id', sys_account(p_org,'sales'), 'debit', 0, 'credit', v_base));
  if v_cgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_cgst'), 'debit', 0, 'credit', v_cgst)); end if;
  if v_sgst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_sgst'), 'debit', 0, 'credit', v_sgst)); end if;
  if v_igst > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', sys_account(p_org,'output_igst'), 'debit', 0, 'credit', v_igst)); end if;
  if v_cogs > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', sys_account(p_org,'cogs'),      'debit', v_cogs, 'credit', 0),
      jsonb_build_object('account_id', sys_account(p_org,'inventory'), 'debit', 0,      'credit', v_cogs));
  end if;

  v_res := post_voucher(p_org, 1::smallint, p_date, p_party, p_narration, v_lines, v_stock);

  if p_mode = 'credit' then
    insert into invoices (org_id, party_id, voucher_id, invoice_no, date, total, outstanding)
      values (p_org, p_party, (v_res->>'voucher_id')::uuid, v_res->>'voucher_no', p_date, v_total, v_total)
      returning id into v_invoice_id;

    for it in select * from jsonb_array_elements(p_items) loop
      insert into invoice_lines (org_id, invoice_id, stock_item_id, qty, rate, amount)
      values (
        p_org,
        v_invoice_id,
        (it->>'stock_item_id')::uuid,
        (it->>'qty')::numeric,
        (it->>'rate')::bigint,
        round((it->>'qty')::numeric * (it->>'rate')::bigint)::bigint
      );
    end loop;
  end if;

  return v_res;
end; $$;

-- ---------- View: v_invoice_detail ----------
create or replace view v_invoice_detail with (security_invoker = on) as
select
  i.org_id,
  i.id            as invoice_id,
  i.invoice_no,
  i.date,
  i.total,
  i.outstanding,
  i.party_id,
  p.name          as party_name,
  v.narration,
  il.id           as line_id,
  il.stock_item_id,
  si.name         as item_name,
  si.unit,
  si.gst_rate,
  il.qty,
  il.rate,
  il.amount
from invoices i
join parties p        on p.id  = i.party_id
join vouchers v       on v.id  = i.voucher_id
join invoice_lines il on il.invoice_id = i.id
join stock_items si   on si.id = il.stock_item_id;

grant select on v_invoice_detail to authenticated;
grant execute on function sell(uuid, date, uuid, jsonb, text, text) to authenticated;
