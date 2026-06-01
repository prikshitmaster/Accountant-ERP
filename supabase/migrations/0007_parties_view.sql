-- Expose GST identity in the parties list view.
drop view if exists v_parties;
create view v_parties with (security_invoker = on) as
select
  p.org_id, p.id, p.name, p.kind, p.phone, p.ledger_account_id, p.gstin, p.state_code,
  coalesce((select sum(le.debit - le.credit) from ledger_entries le
            where le.org_id = p.org_id and le.account_id = p.ledger_account_id), 0) as balance
from parties p;

grant select on v_parties to authenticated;
