-- Payments Received: one row per receipt voucher with party name and mode
create or replace view v_payments_received with (security_invoker = on) as
select
  v.org_id,
  v.id          as voucher_id,
  v.voucher_no,
  v.date,
  v.narration,
  p.name        as party_name,
  case when a.system_key = 'cash' then 'Cash' else 'Bank' end as mode,
  le.debit      as amount
from vouchers v
left join parties p       on p.id = v.party_id
join  ledger_entries le   on le.voucher_id = v.id and le.debit > 0
join  accounts a          on a.id = le.account_id
                         and a.system_key in ('cash','bank')
where v.voucher_type = 3;

-- Payments Made: one row per payment voucher with party name and mode
create or replace view v_payments_made with (security_invoker = on) as
select
  v.org_id,
  v.id          as voucher_id,
  v.voucher_no,
  v.date,
  v.narration,
  p.name        as party_name,
  case when a.system_key = 'cash' then 'Cash' else 'Bank' end as mode,
  le.credit     as amount
from vouchers v
left join parties p       on p.id = v.party_id
join  ledger_entries le   on le.voucher_id = v.id and le.credit > 0
join  accounts a          on a.id = le.account_id
                         and a.system_key in ('cash','bank')
where v.voucher_type = 4;

grant select on v_payments_received, v_payments_made to authenticated;
