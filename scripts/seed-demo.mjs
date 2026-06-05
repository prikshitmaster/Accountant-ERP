// seed-demo.mjs — Demo Traders: 3 fiscal years (FY 2024-25, 2025-26, 2026-27 Q1)
// DATABASE_URL=... node scripts/seed-demo.mjs
import pg from 'pg'
const url = process.env.DATABASE_URL
const EMAIL = process.env.EMAIL || 'a@a.co'
if (!url) { console.error('Set DATABASE_URL'); process.exit(1) }
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
const q   = (sql, a) => client.query(sql, a)
const one = async (sql, a) => (await q(sql, a)).rows[0]
const ORG = 'Demo Traders'

let org, I, C, S, cash, bank

async function run() {
  await client.connect()
  const u = await one(`select id from auth.users where email=$1`, [EMAIL])
  if (!u) { console.error(`No user ${EMAIL}; run create-user.mjs first`); process.exit(1) }
  const uid = u.id

  await q(`delete from organizations where name=$1 and id in (select org_id from memberships where user_id=$2)`, [ORG, uid])
  await q(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify({ sub: uid })])

  org = (await one(`select create_organization($1,4::smallint) id`, [ORG])).id
  await q(`update org_settings set gstin='07AABCT1234E1Z5', state_code='07', owner_name='Ramesh Kumar',
    address_line1='456 Industrial Area', address_line2='Okhla Phase II', city='New Delhi', pincode='110020',
    bank_name='State Bank of India', bank_account_no='00112233445566', bank_ifsc='SBIN0001234',
    upi='demotradersdelhi@okaxis' where org_id=$1`, [org])

  C = {
    rajesh: (await one(`select create_party($1,'Rajesh Hardware','customer','9810011111','07AAACR1111A1Z2','07') id`, [org])).id,
    mumbai: (await one(`select create_party($1,'Mumbai Mega Mart','customer','9820022222','27AAACM2222B1Z3','27') id`, [org])).id,
    sharma: (await one(`select create_party($1,'Sharma Builders','customer','9890033333','29AAACS3333C1Z4','29') id`, [org])).id,
    city:   (await one(`select create_party($1,'City Construction Co','customer','9870044444','36AAACC4444D1Z5','36') id`, [org])).id,
  }
  S = {
    steel:  (await one(`select create_party($1,'Bharat Steel Co','supplier','9811055555','07AAACB5555E1Z6','07') id`, [org])).id,
    cement: (await one(`select create_party($1,'Gujarat Cement Ltd','supplier','9824066666','24AAACG6666F1Z7','24') id`, [org])).id,
    paint:  (await one(`select create_party($1,'National Paints Pvt Ltd','supplier','9822077777','27AAACN7777G1Z8','27') id`, [org])).id,
  }

  I = {
    tmt:    (await one(`select create_stock_item($1,'TMT Steel Bar 12mm',4::smallint,'kg',1500,'7214',18) id`, [org])).id,
    cement: (await one(`select create_stock_item($1,'Cement Bag 50kg',4::smallint,'bag',250,'2523',28) id`, [org])).id,
    pipe:   (await one(`select create_stock_item($1,'GI Pipe 1 inch',4::smallint,'pcs',50,'7306',18) id`, [org])).id,
    paint:  (await one(`select create_stock_item($1,'Wall Paint 20L',4::smallint,'bucket',10,'3208',18) id`, [org])).id,
    wire:   (await one(`select create_stock_item($1,'Steel Wire Rod',1::smallint,'kg',100,'7213',18) id`, [org])).id,
    plate:  (await one(`select create_stock_item($1,'MS Plate 6mm',1::smallint,'kg',50,'7208',18) id`, [org])).id,
    frame:  (await one(`select create_stock_item($1,'Fabricated Steel Frame',2::smallint,'pcs',6,'7308',18) id`, [org])).id,
  }

  cash = (await one(`select id from accounts where org_id=$1 and system_key='cash'`, [org])).id
  bank = (await one(`select id from accounts where org_id=$1 and system_key='bank'`, [org])).id

  await q(`select opening_balances($1,$2::jsonb,'[]'::jsonb)`, [org, JSON.stringify([
    { account_id: cash, debit: 30000000,   credit: 0 },
    { account_id: bank, debit: 2000000000, credit: 0 },
  ])])

  // ── FY 2024-25 ──────────────────────────────────────────────────────────────

  // APR 2024 — opening stock + first sales
  await buy('2024-04-01', S.steel,  [[I.tmt,15000,5200],[I.wire,2000,4200],[I.plate,1000,5000],[I.pipe,600,26000]], 'credit', 'Opening steel stock FY24-25')
  await buy('2024-04-01', S.cement, [[I.cement,1200,36000]], 'credit', 'Opening cement stock')
  await buy('2024-04-01', S.paint,  [[I.paint,80,220000]], 'credit', 'Opening paint stock')
  await sell('2024-04-08', C.rajesh, [[I.tmt,600,6000],[I.cement,100,40000]], 'credit', 'Site order Apr 24', 0, 0)
  await sell('2024-04-15', C.mumbai, [[I.pipe,60,30000],[I.paint,12,260000]], 'credit', 'Bulk order Apr 24', 0, 0)
  await sell('2024-04-22', C.sharma, [[I.tmt,200,6100],[I.cement,50,41000]], 'credit', 'Project Apr 24', 0, 0)
  await sell('2024-04-28', null, [[I.cement,15,41500],[I.pipe,8,31000]], 'cash', 'Cash Apr 24', 0, 0)
  await expense('2024-04-30', 'Rent', 4000000, 'bank', 'Apr 24 rent')
  await expense('2024-04-28', 'Electricity', 1200000, 'cash', 'Apr 24 electricity')

  // MAY 2024
  await buy('2024-05-03', S.steel,  [[I.tmt,500,5200],[I.wire,200,4200]], 'credit', 'May 24 steel restock')
  await buy('2024-05-05', S.cement, [[I.cement,150,36500]], 'credit', 'May 24 cement')
  await recvLast(C.rajesh, '2024-05-08', 1.0, 'Rajesh Apr full rcpt')
  await recvLast(C.mumbai, '2024-05-10', 0.5, 'Mumbai Apr part rcpt')
  await payLast(S.steel,   '2024-05-06', 1.0, 'Steel Apr payment')
  await mfg('2024-05-20', [[I.wire,100],[I.plate,50]], [[I.frame,10,100]], 'Batch-1 May 24')
  await sell('2024-05-10', C.rajesh, [[I.tmt,400,6100],[I.cement,80,40500]], 'credit', 'Rajesh May 24', 0, 0)
  await sell('2024-05-18', C.city,   [[I.pipe,50,30500],[I.paint,8,265000]], 'credit', 'City May 24', 0, 0)
  await sell('2024-05-25', C.sharma, [[I.frame,5,750000]], 'credit', 'Frames May 24', 0, 0)
  await expense('2024-05-31', 'Rent', 4000000, 'bank', 'May 24 rent')
  await expense('2024-05-31', 'Salaries & Wages', 8000000, 'bank', 'May 24 salaries')

  // JUN 2024
  await buy('2024-06-02', S.paint, [[I.paint,30,225000]], 'credit', 'Jun 24 paint')
  await recvLast(C.rajesh, '2024-06-05', 1.0, 'Rajesh May rcpt')
  await recvLast(C.mumbai, '2024-06-08', 0.5, 'Mumbai May part')
  await payLast(S.cement,  '2024-06-05', 1.0, 'Cement Apr pay')
  await sell('2024-06-05', C.rajesh, [[I.tmt,300,6200],[I.pipe,30,31000]], 'credit', 'Jun 24 Rajesh', 0, 0)
  await sell('2024-06-12', C.mumbai, [[I.cement,60,41500],[I.paint,6,270000]], 'credit', 'Jun 24 Mumbai', 0, 0)
  await sell('2024-06-25', null, [[I.cement,20,42000],[I.pipe,10,32000]], 'cash', 'Cash Jun 24', 0, 0)
  await expense('2024-06-30', 'Rent', 4000000, 'bank', 'Jun 24 rent')
  await expense('2024-06-30', 'Salaries & Wages', 8000000, 'bank', 'Jun 24 salaries')

  // JUL 2024 (monsoon slow)
  await recvLast(C.rajesh, '2024-07-05', 1.0, 'Rajesh Jun rcpt')
  await recvLast(C.mumbai, '2024-07-08', 1.0, 'Mumbai Jun full')
  await payLast(S.paint,   '2024-07-05', 1.0, 'Paint Jun pay')
  await sell('2024-07-10', C.city,   [[I.tmt,150,6200],[I.cement,40,42000]], 'credit', 'Jul 24 City', 0, 0)
  await sell('2024-07-22', C.sharma, [[I.pipe,20,31500]], 'credit', 'Jul 24 Sharma', 0, 0)
  await expense('2024-07-31', 'Rent', 4000000, 'bank', 'Jul 24 rent')
  await expense('2024-07-31', 'Salaries & Wages', 8000000, 'bank', 'Jul 24 salaries')

  // AUG 2024 (monsoon)
  await buy('2024-08-05', S.steel, [[I.tmt,400,5300]], 'credit', 'Aug 24 steel')
  await recvLast(C.city,   '2024-08-08', 1.0, 'City Jul rcpt')
  await payLast(S.steel,   '2024-08-06', 1.0, 'Steel Jul pay')
  await sell('2024-08-12', C.rajesh, [[I.tmt,200,6300],[I.cement,50,42500]], 'credit', 'Aug 24 Rajesh', 0, 0)
  await sell('2024-08-25', null, [[I.cement,15,43000]], 'cash', 'Cash Aug 24', 0, 0)
  await expense('2024-08-31', 'Rent', 4000000, 'bank', 'Aug 24 rent')
  await expense('2024-08-31', 'Salaries & Wages', 8000000, 'bank', 'Aug 24 salaries')

  // SEP 2024 (monsoon end)
  await buy('2024-09-03', S.cement, [[I.cement,200,37000]], 'credit', 'Sep 24 cement')
  await buy('2024-09-04', S.paint,  [[I.paint,40,230000]], 'credit', 'Sep 24 paint')
  await recvLast(C.rajesh, '2024-09-05', 1.0, 'Rajesh Aug rcpt')
  await payLast(S.cement,  '2024-09-06', 1.0, 'Cement Sep pay')
  await sell('2024-09-10', C.city,   [[I.tmt,300,6400],[I.cement,60,43000]], 'credit', 'Sep 24 City', 0, 0)
  await sell('2024-09-20', C.mumbai, [[I.paint,10,275000],[I.pipe,30,32000]], 'credit', 'Sep 24 Mumbai', 0, 0)
  await expense('2024-09-30', 'Rent', 4000000, 'bank', 'Sep 24 rent')
  await expense('2024-09-30', 'Salaries & Wages', 8000000, 'bank', 'Sep 24 salaries')

  // OCT 2024 (Diwali / peak)
  await buy('2024-10-01', S.steel,  [[I.tmt,1000,5400],[I.wire,300,4400],[I.plate,150,5200],[I.pipe,200,27000]], 'credit', 'Oct 24 mega stock')
  await mfg('2024-10-10', [[I.wire,150],[I.plate,75]], [[I.frame,15,150]], 'Batch-2 Oct 24')
  await recvLast(C.city,   '2024-10-05', 1.0, 'City Sep rcpt')
  await recvLast(C.mumbai, '2024-10-08', 1.0, 'Mumbai Sep rcpt')
  await payLast(S.paint,   '2024-10-05', 1.0, 'Paint Sep pay')
  await sell('2024-10-05', C.rajesh, [[I.tmt,800,6500],[I.cement,120,44000]], 'credit', 'Oct 24 Rajesh festival', 0, 0)
  await sell('2024-10-10', C.mumbai, [[I.pipe,80,33000],[I.paint,20,280000]], 'credit', 'Oct 24 Mumbai', 0, 0)
  await sell('2024-10-18', C.sharma, [[I.frame,8,800000],[I.tmt,300,6500]], 'credit', 'Oct 24 Sharma frames', 0, 0)
  await sell('2024-10-25', C.city,   [[I.tmt,500,6600],[I.cement,80,44500]], 'credit', 'Oct 24 City', 0, 0)
  await sell('2024-10-28', null, [[I.cement,30,45000],[I.pipe,15,33500]], 'cash', 'Cash Oct 24', 0, 0)
  await expense('2024-10-31', 'Rent', 4000000, 'bank', 'Oct 24 rent')
  await expense('2024-10-31', 'Salaries & Wages', 8500000, 'bank', 'Oct 24 salaries')

  // NOV 2024 (peak cont.)
  await buy('2024-11-05', S.steel,  [[I.tmt,500,5400]], 'credit', 'Nov 24 steel')
  await buy('2024-11-06', S.cement, [[I.cement,150,37500]], 'credit', 'Nov 24 cement')
  await recvLast(C.rajesh, '2024-11-05', 0.7, 'Rajesh Oct part')
  await recvLast(C.mumbai, '2024-11-08', 1.0, 'Mumbai Oct full')
  await recvLast(C.city,   '2024-11-10', 1.0, 'City Oct full')
  await payLast(S.steel,   '2024-11-05', 1.0, 'Steel Oct pay')
  await sell('2024-11-05', C.rajesh, [[I.tmt,600,6600],[I.cement,100,45000]], 'credit', 'Nov 24 Rajesh', 0, 0)
  await sell('2024-11-12', C.city,   [[I.frame,5,820000],[I.pipe,60,33000]], 'credit', 'Nov 24 City frames', 0, 0)
  await sell('2024-11-20', C.mumbai, [[I.tmt,400,6700],[I.paint,15,282000]], 'credit', 'Nov 24 Mumbai', 500000, 0)
  await expense('2024-11-30', 'Rent', 4000000, 'bank', 'Nov 24 rent')
  await expense('2024-11-30', 'Salaries & Wages', 8500000, 'bank', 'Nov 24 salaries')

  // DEC 2024
  await buy('2024-12-03', S.paint, [[I.paint,50,235000]], 'credit', 'Dec 24 paint')
  await recvLast(C.rajesh, '2024-12-05', 0.5, 'Rajesh Nov part')
  await recvLast(C.city,   '2024-12-06', 1.0, 'City Nov full')
  await recvLast(C.mumbai, '2024-12-08', 1.0, 'Mumbai Nov full')
  await payLast(S.cement,  '2024-12-05', 1.0, 'Cement Nov pay')
  await payLast(S.steel,   '2024-12-08', 1.0, 'Steel Nov pay')
  await sell('2024-12-05', C.city,   [[I.tmt,400,6700],[I.cement,80,45500]], 'credit', 'Dec 24 City', 0, 0)
  await sell('2024-12-12', C.sharma, [[I.tmt,250,6800],[I.pipe,40,34000]], 'credit', 'Dec 24 Sharma', 0, 0)
  await sell('2024-12-20', null, [[I.paint,10,285000],[I.cement,20,46000]], 'cash', 'Cash Dec 24', 0, 0)
  await q(`select contra($1,'2024-12-15'::date,$2,$3,3000000::bigint,'Petty cash Dec 24')`, [org, bank, cash])
  await expense('2024-12-31', 'Rent', 4000000, 'bank', 'Dec 24 rent')
  await expense('2024-12-31', 'Salaries & Wages', 8500000, 'bank', 'Dec 24 salaries')

  // JAN 2025
  await buy('2025-01-02', S.steel,  [[I.tmt,600,5500],[I.pipe,100,27500]], 'credit', 'Jan 25 steel+pipe')
  await buy('2025-01-03', S.cement, [[I.cement,200,38000]], 'credit', 'Jan 25 cement')
  await recvLast(C.city,   '2025-01-05', 1.0, 'City Dec rcpt')
  await recvLast(C.sharma, '2025-01-08', 1.0, 'Sharma Dec rcpt')
  await payLast(S.paint,   '2025-01-05', 1.0, 'Paint Dec pay')
  await mfg('2025-01-10', [[I.wire,120],[I.plate,60]], [[I.frame,12,120]], 'Batch-3 Jan 25')
  await sell('2025-01-08', C.rajesh, [[I.tmt,700,6800],[I.cement,100,46000]], 'credit', 'Jan 25 Rajesh', 0, 0)
  await sell('2025-01-15', C.mumbai, [[I.frame,6,840000],[I.pipe,50,34500]], 'credit', 'Jan 25 Mumbai frames', 0, 0)
  await sell('2025-01-22', C.city,   [[I.tmt,400,6900],[I.paint,12,290000]], 'credit', 'Jan 25 City', 0, 0)
  await expense('2025-01-31', 'Rent', 4500000, 'bank', 'Jan 25 rent')
  await expense('2025-01-31', 'Salaries & Wages', 8500000, 'bank', 'Jan 25 salaries')

  // FEB 2025
  await recvLast(C.rajesh, '2025-02-05', 1.0, 'Rajesh Jan full')
  await recvLast(C.mumbai, '2025-02-08', 1.0, 'Mumbai Jan full')
  await payLast(S.steel,   '2025-02-05', 1.0, 'Steel Jan pay')
  await payLast(S.cement,  '2025-02-08', 1.0, 'Cement Jan pay')
  await sell('2025-02-06', C.sharma, [[I.tmt,350,7000],[I.cement,90,46500]], 'credit', 'Feb 25 Sharma', 0, 0)
  await sell('2025-02-14', C.rajesh, [[I.pipe,60,35000],[I.paint,10,292000]], 'credit', 'Feb 25 Rajesh', 0, 0)
  await sell('2025-02-22', null, [[I.tmt,100,7000],[I.cement,30,47000]], 'cash', 'Cash Feb 25', 0, 0)
  await expense('2025-02-28', 'Rent', 4500000, 'bank', 'Feb 25 rent')
  await expense('2025-02-28', 'Salaries & Wages', 8500000, 'bank', 'Feb 25 salaries')

  // MAR 2025 (year-end rush)
  await buy('2025-03-02', S.steel,  [[I.tmt,800,5500],[I.wire,200,4400],[I.plate,100,5200]], 'credit', 'Mar 25 steel stock-up')
  await buy('2025-03-03', S.cement, [[I.cement,300,38500]], 'credit', 'Mar 25 cement stock-up')
  await buy('2025-03-04', S.paint,  [[I.paint,60,238000]], 'credit', 'Mar 25 paint stock-up')
  await recvLast(C.sharma, '2025-03-05', 1.0, 'Sharma Feb rcpt')
  await recvLast(C.rajesh, '2025-03-08', 1.0, 'Rajesh Feb rcpt')
  await recvLast(C.city,   '2025-03-10', 1.0, 'City Jan rcpt')
  await payLast(S.steel,   '2025-03-05', 1.0, 'Steel pay Mar 25')
  await sell('2025-03-05', C.rajesh, [[I.tmt,900,7100],[I.cement,120,47000]], 'credit', 'Mar 25 Rajesh year-end', 0, 0)
  await sell('2025-03-12', C.city,   [[I.tmt,600,7200],[I.pipe,80,35500]], 'credit', 'Mar 25 City', 0, 0)
  await sell('2025-03-20', C.mumbai, [[I.paint,20,295000],[I.cement,80,48000]], 'credit', 'Mar 25 Mumbai', 0, 0)
  await sell('2025-03-25', C.sharma, [[I.frame,4,860000],[I.tmt,200,7200]], 'credit', 'Mar 25 Sharma frames', 0, 0)
  await sell('2025-03-30', null, [[I.cement,40,48000],[I.paint,8,296000]], 'cash', 'Cash Mar 25 year-end', 0, 0)
  await q(`select introduce_capital($1,'2025-03-31'::date,2000000000::bigint,'bank')`, [org])
  await q(`select drawings($1,'2025-03-31'::date,5000000::bigint,'bank')`, [org])
  await expense('2025-03-31', 'Rent', 4500000, 'bank', 'Mar 25 rent')
  await expense('2025-03-31', 'Salaries & Wages', 8500000, 'bank', 'Mar 25 salaries')

  // ── FY 2025-26 ──────────────────────────────────────────────────────────────

  const blr = (await one(`select create_party($1,'Premier Infra Pvt Ltd','customer','9845099999','29AAACPR999H1Z1','29') id`, [org])).id

  // APR 2025
  await recvLast(C.rajesh, '2025-04-05', 1.0, 'Rajesh Mar 25 rcpt')
  await recvLast(C.city,   '2025-04-07', 1.0, 'City Mar 25 rcpt')
  await recvLast(C.mumbai, '2025-04-10', 1.0, 'Mumbai Mar 25 rcpt')
  await recvLast(C.sharma, '2025-04-12', 0.5, 'Sharma Mar 25 part')
  await payLast(S.cement,  '2025-04-05', 1.0, 'Cement Mar 25 pay')
  await payLast(S.paint,   '2025-04-08', 1.0, 'Paint Mar 25 pay')
  await buy('2025-04-03', S.steel,  [[I.tmt,1000,5600],[I.wire,300,4500],[I.plate,200,5300],[I.pipe,200,28000]], 'credit', 'Apr 25 mega stock')
  await buy('2025-04-04', S.cement, [[I.cement,400,39000]], 'credit', 'Apr 25 cement')
  await buy('2025-04-05', S.paint,  [[I.paint,80,240000]], 'credit', 'Apr 25 paint')
  await sell('2025-04-08', C.rajesh, [[I.tmt,700,6400],[I.cement,100,43000]], 'credit', 'Apr 25 Rajesh', 0, 0)
  await sell('2025-04-14', C.mumbai, [[I.pipe,70,32000],[I.paint,15,275000]], 'credit', 'Apr 25 Mumbai', 0, 0)
  await sell('2025-04-20', blr,      [[I.tmt,300,6500],[I.cement,60,43500]], 'credit', 'Apr 25 BLR new', 0, 0)
  await sell('2025-04-26', null, [[I.cement,25,44000],[I.paint,5,278000]], 'cash', 'Cash Apr 25', 0, 0)
  await expense('2025-04-30', 'Rent', 4500000, 'bank', 'Apr 25 rent')
  await expense('2025-04-28', 'Electricity', 1400000, 'cash', 'Apr 25 electricity')

  // MAY 2025
  await recvLast(C.rajesh, '2025-05-05', 1.0, 'Rajesh Apr 25 rcpt')
  await recvLast(C.mumbai, '2025-05-08', 1.0, 'Mumbai Apr 25 rcpt')
  await recvLast(blr,      '2025-05-10', 1.0, 'BLR Apr 25 rcpt')
  await payLast(S.steel,   '2025-05-05', 1.0, 'Steel Apr 25 pay')
  await payLast(S.cement,  '2025-05-08', 1.0, 'Cement Apr 25 pay')
  await buy('2025-05-03', S.steel, [[I.tmt,500,5600],[I.wire,200,4500]], 'credit', 'May 25 steel')
  await mfg('2025-05-10', [[I.wire,150],[I.plate,75]], [[I.frame,15,150]], 'Batch-4 May 25')
  await sell('2025-05-08', C.rajesh, [[I.tmt,500,6500],[I.cement,80,44000]], 'credit', 'May 25 Rajesh', 0, 0)
  await sell('2025-05-15', C.city,   [[I.frame,8,860000],[I.pipe,50,33000]], 'credit', 'May 25 City frames', 0, 0)
  await sell('2025-05-22', C.sharma, [[I.tmt,350,6600],[I.cement,70,44500]], 'credit', 'May 25 Sharma', 500000, 0)
  await expense('2025-05-31', 'Rent', 4500000, 'bank', 'May 25 rent')
  await expense('2025-05-31', 'Salaries & Wages', 9000000, 'bank', 'May 25 salaries')

  // JUN 2025
  await recvLast(C.rajesh, '2025-06-05', 1.0, 'Rajesh May 25 rcpt')
  await recvLast(C.city,   '2025-06-08', 1.0, 'City May 25 rcpt')
  await recvLast(C.sharma, '2025-06-10', 1.0, 'Sharma May 25 rcpt')
  await payLast(S.steel,   '2025-06-05', 1.0, 'Steel May 25 pay')
  await buy('2025-06-03', S.paint, [[I.paint,40,242000]], 'credit', 'Jun 25 paint')
  await sell('2025-06-05', C.rajesh, [[I.tmt,400,6600],[I.pipe,40,33500]], 'credit', 'Jun 25 Rajesh', 0, 0)
  await sell('2025-06-12', C.mumbai, [[I.paint,12,278000],[I.cement,70,44500]], 'credit', 'Jun 25 Mumbai', 0, 0)
  await sell('2025-06-18', blr, [[I.tmt,250,6700],[I.frame,3,880000]], 'credit', 'Jun 25 BLR', 0, 0)
  await sell('2025-06-28', null, [[I.cement,20,45000],[I.pipe,12,34000]], 'cash', 'Cash Jun 25', 0, 0)
  await expense('2025-06-30', 'Rent', 4500000, 'bank', 'Jun 25 rent')
  await expense('2025-06-30', 'Salaries & Wages', 9000000, 'bank', 'Jun 25 salaries')

  // JUL 2025 (monsoon)
  await recvLast(C.rajesh, '2025-07-05', 1.0, 'Rajesh Jun 25 rcpt')
  await recvLast(C.mumbai, '2025-07-08', 1.0, 'Mumbai Jun 25 rcpt')
  await recvLast(blr,      '2025-07-10', 1.0, 'BLR Jun 25 rcpt')
  await payLast(S.paint,   '2025-07-05', 1.0, 'Paint Jun 25 pay')
  await sell('2025-07-10', C.city,   [[I.tmt,200,6700],[I.cement,50,45000]], 'credit', 'Jul 25 City', 0, 0)
  await sell('2025-07-22', C.sharma, [[I.pipe,30,34000]], 'credit', 'Jul 25 Sharma', 0, 0)
  await expense('2025-07-31', 'Rent', 4500000, 'bank', 'Jul 25 rent')
  await expense('2025-07-31', 'Salaries & Wages', 9000000, 'bank', 'Jul 25 salaries')

  // AUG 2025
  await buy('2025-08-05', S.steel, [[I.tmt,500,5700]], 'credit', 'Aug 25 steel')
  await recvLast(C.city,  '2025-08-08', 1.0, 'City Jul 25 rcpt')
  await payLast(S.steel,  '2025-08-06', 1.0, 'Steel Jul 25 pay')
  await sell('2025-08-12', C.rajesh, [[I.tmt,300,6800],[I.cement,60,45500]], 'credit', 'Aug 25 Rajesh', 0, 0)
  await sell('2025-08-25', null, [[I.cement,20,46000]], 'cash', 'Cash Aug 25', 0, 0)
  await expense('2025-08-31', 'Rent', 4500000, 'bank', 'Aug 25 rent')
  await expense('2025-08-31', 'Salaries & Wages', 9000000, 'bank', 'Aug 25 salaries')

  // SEP 2025
  await buy('2025-09-03', S.cement, [[I.cement,250,39000]], 'credit', 'Sep 25 cement')
  await buy('2025-09-04', S.paint,  [[I.paint,50,245000]], 'credit', 'Sep 25 paint')
  await recvLast(C.rajesh, '2025-09-05', 1.0, 'Rajesh Aug 25 rcpt')
  await payLast(S.steel,   '2025-09-05', 1.0, 'Steel Aug 25 pay')
  await payLast(S.cement,  '2025-09-08', 1.0, 'Cement Sep 25 pay')
  await sell('2025-09-08', C.city,   [[I.tmt,350,6900],[I.cement,70,46000]], 'credit', 'Sep 25 City', 0, 0)
  await sell('2025-09-18', C.mumbai, [[I.paint,12,282000],[I.pipe,35,34500]], 'credit', 'Sep 25 Mumbai', 0, 0)
  await sell('2025-09-25', blr,      [[I.tmt,200,7000],[I.cement,50,46500]], 'credit', 'Sep 25 BLR', 0, 0)
  await expense('2025-09-30', 'Rent', 4500000, 'bank', 'Sep 25 rent')
  await expense('2025-09-30', 'Salaries & Wages', 9000000, 'bank', 'Sep 25 salaries')

  // OCT 2025 (Diwali peak)
  await buy('2025-10-01', S.steel,  [[I.tmt,1500,5700],[I.wire,400,4600],[I.plate,200,5400],[I.pipe,300,28500]], 'credit', 'Oct 25 mega stock')
  await mfg('2025-10-08', [[I.wire,200],[I.plate,100]], [[I.frame,20,200]], 'Batch-5 Oct 25')
  await recvLast(C.city,   '2025-10-05', 1.0, 'City Sep 25 rcpt')
  await recvLast(C.mumbai, '2025-10-08', 1.0, 'Mumbai Sep 25 rcpt')
  await recvLast(blr,      '2025-10-10', 1.0, 'BLR Sep 25 rcpt')
  await payLast(S.paint,   '2025-10-05', 1.0, 'Paint Sep 25 pay')
  await sell('2025-10-05', C.rajesh, [[I.tmt,1000,7000],[I.cement,150,47000]], 'credit', 'Oct 25 Rajesh festival', 0, 0)
  await sell('2025-10-10', C.mumbai, [[I.pipe,100,35000],[I.paint,25,285000]], 'credit', 'Oct 25 Mumbai', 0, 0)
  await sell('2025-10-15', C.sharma, [[I.frame,12,870000],[I.tmt,400,7000]], 'credit', 'Oct 25 Sharma frames', 0, 0)
  await sell('2025-10-22', C.city,   [[I.tmt,700,7100],[I.cement,100,47500]], 'credit', 'Oct 25 City', 0, 0)
  await sell('2025-10-25', blr,      [[I.tmt,400,7200],[I.frame,5,890000]], 'credit', 'Oct 25 BLR', 0, 0)
  await sell('2025-10-28', null, [[I.cement,40,48000],[I.pipe,20,35500]], 'cash', 'Cash Oct 25', 0, 0)
  await expense('2025-10-31', 'Rent', 4500000, 'bank', 'Oct 25 rent')
  await expense('2025-10-31', 'Salaries & Wages', 10000000, 'bank', 'Oct 25 salaries')

  // NOV 2025
  await buy('2025-11-05', S.steel,  [[I.tmt,600,5800]], 'credit', 'Nov 25 steel')
  await buy('2025-11-06', S.cement, [[I.cement,200,39500]], 'credit', 'Nov 25 cement')
  await recvLast(C.rajesh, '2025-11-05', 0.8, 'Rajesh Oct 25 part')
  await recvLast(C.mumbai, '2025-11-08', 1.0, 'Mumbai Oct 25 full')
  await recvLast(C.city,   '2025-11-10', 1.0, 'City Oct 25 full')
  await payLast(S.steel,   '2025-11-05', 1.0, 'Steel Oct 25 pay')
  await sell('2025-11-05', C.rajesh, [[I.tmt,800,7100],[I.cement,120,48000]], 'credit', 'Nov 25 Rajesh', 0, 0)
  await sell('2025-11-12', C.city,   [[I.frame,6,890000],[I.pipe,70,35000]], 'credit', 'Nov 25 City frames', 0, 0)
  await sell('2025-11-20', C.mumbai, [[I.tmt,500,7200],[I.paint,18,288000]], 'credit', 'Nov 25 Mumbai', 500000, 0)
  await sell('2025-11-25', blr,      [[I.tmt,300,7200],[I.cement,80,48500]], 'credit', 'Nov 25 BLR', 0, 0)
  await expense('2025-11-30', 'Rent', 4500000, 'bank', 'Nov 25 rent')
  await expense('2025-11-30', 'Salaries & Wages', 10000000, 'bank', 'Nov 25 salaries')

  // DEC 2025
  await buy('2025-12-03', S.paint, [[I.paint,60,248000]], 'credit', 'Dec 25 paint')
  await recvLast(C.rajesh, '2025-12-05', 1.0, 'Rajesh Nov 25 full')
  await recvLast(C.sharma, '2025-12-08', 1.0, 'Sharma Oct 25 rcpt')
  await recvLast(blr,      '2025-12-10', 1.0, 'BLR Nov 25 rcpt')
  await payLast(S.cement,  '2025-12-05', 1.0, 'Cement Nov 25 pay')
  await payLast(S.steel,   '2025-12-08', 1.0, 'Steel Nov 25 pay')
  await sell('2025-12-05', C.city,   [[I.tmt,500,7200],[I.cement,100,48500]], 'credit', 'Dec 25 City', 0, 0)
  await sell('2025-12-12', C.sharma, [[I.tmt,300,7300],[I.pipe,50,35500]], 'credit', 'Dec 25 Sharma', 0, 0)
  await sell('2025-12-20', null, [[I.paint,12,292000],[I.cement,30,49000]], 'cash', 'Cash Dec 25', 0, 0)
  await q(`select contra($1,'2025-12-15'::date,$2,$3,3000000::bigint,'Petty cash Dec 25')`, [org, bank, cash])
  await expense('2025-12-31', 'Rent', 4500000, 'bank', 'Dec 25 rent')
  await expense('2025-12-31', 'Salaries & Wages', 10000000, 'bank', 'Dec 25 salaries')

  // JAN 2026
  await buy('2026-01-03', S.steel,  [[I.tmt,800,5800],[I.pipe,150,28500]], 'credit', 'Jan 26 steel+pipe')
  await buy('2026-01-04', S.cement, [[I.cement,250,40000]], 'credit', 'Jan 26 cement')
  await recvLast(C.city,   '2026-01-05', 1.0, 'City Dec 25 rcpt')
  await recvLast(C.sharma, '2026-01-08', 1.0, 'Sharma Dec 25 rcpt')
  await payLast(S.paint,   '2026-01-05', 1.0, 'Paint Dec 25 pay')
  await mfg('2026-01-12', [[I.wire,130],[I.plate,65]], [[I.frame,13,130]], 'Batch-6 Jan 26')
  await sell('2026-01-06', C.rajesh, [[I.tmt,800,7300],[I.cement,120,49000]], 'credit', 'Jan 26 Rajesh', 0, 0)
  await sell('2026-01-14', C.mumbai, [[I.frame,8,900000],[I.pipe,60,36000]], 'credit', 'Jan 26 Mumbai frames', 0, 0)
  await sell('2026-01-22', C.city,   [[I.tmt,500,7400],[I.paint,15,295000]], 'credit', 'Jan 26 City', 0, 0)
  await sell('2026-01-28', blr,      [[I.tmt,350,7400],[I.cement,90,49500]], 'credit', 'Jan 26 BLR', 0, 0)
  await expense('2026-01-31', 'Rent', 5000000, 'bank', 'Jan 26 rent')
  await expense('2026-01-31', 'Salaries & Wages', 10000000, 'bank', 'Jan 26 salaries')

  // FEB 2026
  await recvLast(C.rajesh, '2026-02-05', 1.0, 'Rajesh Jan 26 full')
  await recvLast(C.mumbai, '2026-02-08', 1.0, 'Mumbai Jan 26 full')
  await recvLast(blr,      '2026-02-10', 1.0, 'BLR Jan 26 rcpt')
  await payLast(S.steel,   '2026-02-05', 1.0, 'Steel Jan 26 pay')
  await payLast(S.cement,  '2026-02-08', 1.0, 'Cement Jan 26 pay')
  await sell('2026-02-05', C.sharma, [[I.tmt,450,7500],[I.cement,100,50000]], 'credit', 'Feb 26 Sharma', 0, 0)
  await sell('2026-02-14', C.rajesh, [[I.pipe,70,36500],[I.paint,12,298000]], 'credit', 'Feb 26 Rajesh', 0, 0)
  await sell('2026-02-22', null, [[I.tmt,120,7500],[I.cement,35,50500]], 'cash', 'Cash Feb 26', 0, 0)
  await expense('2026-02-28', 'Rent', 5000000, 'bank', 'Feb 26 rent')
  await expense('2026-02-28', 'Salaries & Wages', 10000000, 'bank', 'Feb 26 salaries')

  // MAR 2026 (FY 25-26 year-end)
  await buy('2026-03-02', S.steel,  [[I.tmt,1000,5800],[I.wire,250,4600],[I.plate,120,5400]], 'credit', 'Mar 26 steel stock-up')
  await buy('2026-03-03', S.cement, [[I.cement,350,40000]], 'credit', 'Mar 26 cement')
  await buy('2026-03-04', S.paint,  [[I.paint,70,248000]], 'credit', 'Mar 26 paint')
  await recvLast(C.sharma, '2026-03-05', 1.0, 'Sharma Feb 26 rcpt')
  await recvLast(C.rajesh, '2026-03-08', 1.0, 'Rajesh Feb 26 rcpt')
  await recvLast(C.city,   '2026-03-10', 1.0, 'City Jan 26 rcpt')
  await payLast(S.steel,   '2026-03-05', 1.0, 'Steel pay Mar 26')
  await sell('2026-03-05', C.rajesh, [[I.tmt,1100,7600],[I.cement,140,50500]], 'credit', 'Mar 26 Rajesh year-end', 0, 0)
  await sell('2026-03-12', C.city,   [[I.tmt,700,7700],[I.pipe,90,37000]], 'credit', 'Mar 26 City', 0, 0)
  await sell('2026-03-18', C.mumbai, [[I.paint,22,300000],[I.cement,100,51000]], 'credit', 'Mar 26 Mumbai', 0, 0)
  await sell('2026-03-25', C.sharma, [[I.frame,5,920000],[I.tmt,250,7700]], 'credit', 'Mar 26 Sharma frames', 0, 0)
  await sell('2026-03-30', null, [[I.cement,50,51000],[I.paint,10,300000]], 'cash', 'Cash Mar 26 year-end', 0, 0)
  await q(`select introduce_capital($1,'2026-03-31'::date,3000000000::bigint,'bank')`, [org])
  await q(`select drawings($1,'2026-03-31'::date,8000000::bigint,'bank')`, [org])
  await expense('2026-03-31', 'Rent', 5000000, 'bank', 'Mar 26 rent')
  await expense('2026-03-31', 'Salaries & Wages', 10000000, 'bank', 'Mar 26 salaries')

  // ── FY 2026-27 Q1 ───────────────────────────────────────────────────────────

  await recvLast(C.rajesh, '2026-04-05', 1.0, 'Rajesh Mar 26 rcpt')
  await recvLast(C.city,   '2026-04-08', 1.0, 'City Mar 26 rcpt')
  await recvLast(C.mumbai, '2026-04-10', 1.0, 'Mumbai Mar 26 rcpt')
  await recvLast(C.sharma, '2026-04-12', 0.6, 'Sharma Mar 26 part')
  await payLast(S.cement,  '2026-04-05', 1.0, 'Cement Mar 26 pay')
  await payLast(S.paint,   '2026-04-08', 1.0, 'Paint Mar 26 pay')

  // APR 2026
  await buy('2026-04-03', S.steel,  [[I.tmt,2000,5500],[I.wire,500,4500],[I.plate,200,5500],[I.pipe,200,28000]], 'credit', 'Opening steel stock')
  await buy('2026-04-04', S.cement, [[I.cement,300,38000]], 'credit', 'Cement + paint stock')
  await buy('2026-04-05', S.paint,  [[I.paint,60,240000]], 'credit', 'Paint stock')
  await mfg('2026-04-10', [[I.wire,100],[I.plate,50]], [[I.frame,10,100]], 'Batch-7 Apr 26')
  await sell('2026-04-08', C.rajesh, [[I.tmt,500,6200],[I.cement,80,42000]], 'credit', 'Site order', 0, 0)
  await sell('2026-04-14', C.mumbai, [[I.pipe,60,32000],[I.paint,15,280000]], 'credit', 'Bulk order', 0, 0)
  await sell('2026-04-20', C.sharma, [[I.tmt,300,6300],[I.frame,5,800000]], 'credit', 'Project supply + frames', 0, 0)
  await sell('2026-04-25', null, [[I.paint,3,290000],[I.cement,10,43000]], 'cash', 'Counter sale', 0, 0)
  await expense('2026-04-30', 'Rent', 4500000, 'bank', 'April rent')
  await expense('2026-04-28', 'Electricity', 1280000, 'cash', 'Electricity April')

  // Collect Apr 26 invoices
  const invR = await one(`select id,total from invoices where org_id=$1 and party_id=$2 and date>='2026-04-01' order by date limit 1`, [org, C.rajesh])
  if (invR) await q(`select receive_payment($1,'2026-05-05'::date,$2,$3::bigint,'bank',$4::jsonb,'Rajesh part-payment')`, [org, C.rajesh, Math.round(invR.total*0.6), JSON.stringify([{invoice_id:invR.id,amount:Math.round(invR.total*0.6)}])])
  const invM = await one(`select id,total from invoices where org_id=$1 and party_id=$2 and date>='2026-04-01' order by date limit 1`, [org, C.mumbai])
  if (invM) await q(`select receive_payment($1,'2026-05-07'::date,$2,$3::bigint,'bank',$4::jsonb,'Mumbai full payment')`, [org, C.mumbai, invM.total, JSON.stringify([{invoice_id:invM.id,amount:invM.total}])])
  const billSt = await one(`select id,total from bills where org_id=$1 and party_id=$2 and date>='2026-04-01' order by date limit 1`, [org, S.steel])
  if (billSt) await q(`select make_payment($1,'2026-05-10'::date,$2,$3::bigint,'bank',$4::jsonb,'Steel Co payment')`, [org, S.steel, billSt.total, JSON.stringify([{bill_id:billSt.id,amount:billSt.total}])])

  // MAY 2026
  await buy('2026-05-02', S.steel,  [[I.tmt,500,5600],[I.wire,300,4600]], 'credit', 'Steel restock')
  await buy('2026-05-08', S.cement, [[I.cement,100,39000]], 'credit', 'Cement restock')
  await mfg('2026-05-12', [[I.wire,80],[I.plate,40]], [[I.frame,8,80]], 'Batch-8 May 26')
  await sell('2026-05-06', C.city,   [[I.frame,8,850000],[I.pipe,40,33000]], 'credit', 'Frames + pipe order', 0, 0)
  await sell('2026-05-15', C.rajesh, [[I.tmt,400,6400],[I.cement,60,44000]], 'credit', 'May steel order', 0, 0)
  await sell('2026-05-22', C.sharma, [[I.tmt,200,6500],[I.pipe,30,34000]], 'credit', 'May project supply', 500000, 200000)
  await sell('2026-05-28', null, [[I.cement,15,44000],[I.paint,5,295000]], 'cash', 'Cash counter May', 0, 0)
  await q(`select contra($1,'2026-05-20'::date,$2,$3,2000000::bigint,'Petty cash withdrawal')`, [org, bank, cash])
  await q(`select introduce_capital($1,'2026-05-01'::date,1000000000::bigint,'bank')`, [org])
  await expense('2026-05-31', 'Rent', 4500000, 'bank', 'May rent')
  await expense('2026-05-15', 'Salaries & Wages', 8500000, 'bank', 'Salaries May')
  await expense('2026-05-25', 'Electricity', 950000, 'cash', 'Electricity May')

  // JUN 2026
  await buy('2026-06-02', S.paint, [[I.paint,20,245000],[I.pipe,50,29000]], 'credit', 'Paint + pipe restock')
  await sell('2026-06-03', C.mumbai, [[I.tmt,200,6600],[I.paint,8,300000]], 'credit', 'June order Mumbai', 0, 0)
  await sell('2026-06-03', C.city,   [[I.tmt,100,6700],[I.cement,25,45000]], 'credit', 'June order City', 0, 0)
  const invR2 = await one(`select id,total from invoices where org_id=$1 and party_id=$2 and date>='2026-05-01' order by date desc limit 1`, [org, C.rajesh])
  if (invR2) await q(`select receive_payment($1,'2026-06-01'::date,$2,$3::bigint,'bank',$4::jsonb,'Rajesh June full payment')`, [org, C.rajesh, invR2.total, JSON.stringify([{invoice_id:invR2.id,amount:invR2.total}])])
  const invSh = await one(`select id,total from invoices where org_id=$1 and party_id=$2 and date>='2026-04-01' order by date limit 1`, [org, C.sharma])
  if (invSh) await q(`select receive_payment($1,'2026-06-02'::date,$2,$3::bigint,'bank',$4::jsonb,'Sharma part payment')`, [org, C.sharma, Math.round(invSh.total*0.4), JSON.stringify([{invoice_id:invSh.id,amount:Math.round(invSh.total*0.4)}])])
  const billPt = await one(`select id,total from bills where org_id=$1 and party_id=$2 and date>='2026-06-01' order by date limit 1`, [org, S.paint])
  if (billPt) await q(`select make_payment($1,'2026-06-01'::date,$2,$3::bigint,'bank',$4::jsonb,'National Paints payment')`, [org, S.paint, billPt.total, JSON.stringify([{bill_id:billPt.id,amount:billPt.total}])])
  await expense('2026-06-01', 'Rent', 4500000, 'bank', 'June rent')
  await expense('2026-06-03', 'Salaries & Wages', 8500000, 'bank', 'Salaries June')
  await q(`select drawings($1,'2026-06-02'::date,3000000::bigint,'bank')`, [org])

  // Returns
  await q(`select sales_return($1,'2026-05-18'::date,$2,$3::jsonb,'credit','Damaged TMT bars returned')`,    [org, C.rajesh, JSON.stringify([{stock_item_id:I.tmt,qty:50,rate:6200}])])
  await q(`select sales_return($1,'2026-05-25'::date,$2,$3::jsonb,'credit','Wrong colour paint returned')`,   [org, C.mumbai, JSON.stringify([{stock_item_id:I.paint,qty:5,rate:280000}])])
  await q(`select purchase_return($1,'2026-05-20'::date,$2,$3::jsonb,'credit','Wrong grade cement returned')`, [org, S.cement, JSON.stringify([{stock_item_id:I.cement,qty:20,rate:38000}])])
  await q(`select purchase_return($1,'2026-06-01'::date,$2,$3::jsonb,'credit','Defective pipes returned')`,    [org, S.steel,  JSON.stringify([{stock_item_id:I.pipe,qty:10,rate:28000}])])

  await client.end()
  console.log(`\n✓ Seeded "${ORG}" for ${EMAIL}`)
  console.log('  FY 2024-25 (full) + FY 2025-26 (full) + FY 2026-27 Q1')
  console.log('  5 customers (Delhi/Mumbai/Bangalore/Hyderabad + BLR new in FY25-26) + 3 suppliers')
  console.log('  4 trading items + 2 raw materials + 1 finished good')
  console.log('  ~140 vouchers across 3 years with seasonal patterns')
  console.log('  Capital introductions at FY year-ends; drawings; contra; credit/debit notes\n')
}

async function buy(date, partyId, lines, mode, narr) {
  const items = lines.map(([s,q,r]) => ({ stock_item_id: s, qty: q, rate: r }))
  await q(`select purchase($1,$2::date,$3,$4::jsonb,$5,$6)`, [org, date, partyId, JSON.stringify(items), mode, narr])
}
async function sell(date, partyId, lines, mode, narr, disc, frt) {
  const items = lines.map(([s,qty,r]) => ({ stock_item_id: s, qty, rate: r }))
  await q(`select sell($1,$2::date,$3,$4::jsonb,$5,$6,$7::bigint,$8::bigint)`, [org, date, partyId, JSON.stringify(items), mode, narr, disc, frt])
}
async function expense(date, accName, amount, mode, narr) {
  const acc = (await one(`select id from accounts where org_id=$1 and name=$2`, [org, accName])).id
  await q(`select expense($1,$2::date,$3,$4::bigint,$5,null,$6)`, [org, date, acc, amount, mode, narr])
}
async function mfg(date, inputs, outputs, narr) {
  const inp = inputs.map(([s,qty]) => ({ stock_item_id: s, qty }))
  const out = outputs.map(([s,qty,weight]) => ({ stock_item_id: s, qty, weight }))
  await q(`select manufacture($1,$2::date,$3::jsonb,$4::jsonb,$5)`, [org, date, JSON.stringify(inp), JSON.stringify(out), narr])
}
async function recvLast(partyId, date, frac, narr) {
  const inv = await one(`select id,outstanding from invoices where org_id=$1 and party_id=$2 and outstanding>0 order by date desc limit 1`, [org, partyId])
  if (!inv) return
  const amt = Math.round(Number(inv.outstanding) * frac)
  if (amt <= 0) return
  await q(`select receive_payment($1,$2::date,$3,$4::bigint,'bank',$5::jsonb,$6)`, [org, date, partyId, amt, JSON.stringify([{invoice_id:inv.id,amount:amt}]), narr])
}
async function payLast(suppId, date, frac, narr) {
  const bill = await one(`select id,outstanding from bills where org_id=$1 and party_id=$2 and outstanding>0 order by date desc limit 1`, [org, suppId])
  if (!bill) return
  const amt = Math.round(Number(bill.outstanding) * frac)
  if (amt <= 0) return
  await q(`select make_payment($1,$2::date,$3,$4::bigint,'bank',$5::jsonb,$6)`, [org, date, suppId, amt, JSON.stringify([{bill_id:bill.id,amount:amt}]), narr])
}

run().catch((e) => { console.error(e.message); process.exit(1) })
