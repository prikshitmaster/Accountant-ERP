import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type DashboardSummary = {
  org_id: string
  cash_balance: number
  bank_balance: number
  receivables: number
  payables: number
  today_sales: number
  low_stock_count: number
}

export function useDashboard(orgId: string | null) {
  return useQuery({
    queryKey: ['dashboard', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<DashboardSummary | null> => {
      const { data, error } = await supabase
        .from('v_dashboard_summary')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle()
      if (error) throw error
      return data as DashboardSummary | null
    },
  })
}

export type DayBookRow = {
  voucher_id: string
  date: string
  type_code: string
  type_name: string
  voucher_no: string
  narration: string | null
  status: string
  party_name: string | null
  amount: number
}

export function useDayBook(orgId: string | null, limit = 25) {
  return useQuery({
    queryKey: ['daybook', orgId, limit],
    enabled: !!orgId,
    queryFn: async (): Promise<DayBookRow[]> => {
      const { data, error } = await supabase
        .from('v_day_book')
        .select('*')
        .eq('org_id', orgId)
        .order('date', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as DayBookRow[]
    },
  })
}

export type Account = {
  id: string
  name: string
  group_id: number
  system_key: string | null
  is_active: boolean
}

export function useAccounts(orgId: string | null) {
  return useQuery({
    queryKey: ['accounts', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, name, group_id, system_key, is_active')
        .eq('org_id', orgId)
        .order('name')
      if (error) throw error
      return (data ?? []) as Account[]
    },
  })
}

export type Party = {
  id: string; name: string; kind: 'customer' | 'supplier' | 'both'
  phone: string | null; balance: number; gstin: string | null; state_code: string | null
  group_name: string | null; city: string | null; credit_limit: number; credit_days: number
}
export function useParties(orgId: string | null, kind?: 'customer' | 'supplier') {
  return useQuery({
    queryKey: ['parties', orgId, kind ?? 'all'],
    enabled: !!orgId,
    queryFn: async (): Promise<Party[]> => {
      let qb = supabase.from('v_parties').select('*').eq('org_id', orgId).order('name')
      if (kind) qb = qb.in('kind', [kind, 'both'])
      const { data, error } = await qb
      if (error) throw error
      return (data ?? []) as Party[]
    },
  })
}

export type PartyFull = {
  id: string; org_id: string; name: string; kind: 'customer' | 'supplier' | 'both'
  phone: string | null; gstin: string | null; state_code: string | null
  alias: string | null; group_name: string | null; area: string | null
  city: string | null; pincode: string | null; billing_address: string | null
  shipping_address: string | null; email: string | null; contact_person: string | null
  pan: string | null; aadhaar: string | null; udyam_no: string | null
  msme_activity: string | null; credit_limit: number; credit_days: number
  created_at: string
}
export function usePartyFull(orgId: string | null, partyId: string | null) {
  return useQuery({
    queryKey: ['party_full', orgId, partyId],
    enabled: !!orgId && !!partyId,
    queryFn: async (): Promise<PartyFull | null> => {
      const { data, error } = await supabase
        .from('parties')
        .select('id, org_id, name, kind, phone, gstin, state_code, alias, group_name, area, city, pincode, billing_address, shipping_address, email, contact_person, pan, aadhaar, udyam_no, msme_activity, credit_limit, credit_days, created_at')
        .eq('org_id', orgId)
        .eq('id', partyId)
        .maybeSingle()
      if (error) throw error
      return data as PartyFull | null
    },
  })
}

export type Item = {
  id: string; name: string; item_type: number; unit: string
  qty_on_hand: number; avg_cost: number; value_on_hand: number
  min_level: number; hsn: string | null; gst_rate: number
  item_code: string | null; category: string | null; description: string | null
  sale_price: number; purchase_price: number
}
export function useItems(orgId: string | null) {
  return useQuery({
    queryKey: ['items', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Item[]> => {
      const { data, error } = await supabase
        .from('stock_items')
        .select('id, name, item_type, unit, qty_on_hand, avg_cost, value_on_hand, min_level, hsn, gst_rate, item_code, category, description, sale_price, purchase_price')
        .eq('org_id', orgId).order('name')
      if (error) throw error
      return (data ?? []) as Item[]
    },
  })
}

export type Invoice = {
  id: string; party_id: string; invoice_no: string; date: string
  total: number; outstanding: number
}
export function useInvoices(orgId: string | null, partyId?: string, openOnly = false) {
  return useQuery({
    queryKey: ['invoices', orgId, partyId ?? 'all', openOnly],
    enabled: !!orgId,
    queryFn: async (): Promise<Invoice[]> => {
      let qb = supabase.from('invoices').select('id, party_id, invoice_no, date, total, outstanding')
        .eq('org_id', orgId).order('date', { ascending: false })
      if (partyId) qb = qb.eq('party_id', partyId)
      if (openOnly) qb = qb.gt('outstanding', 0)
      const { data, error } = await qb
      if (error) throw error
      return (data ?? []) as Invoice[]
    },
  })
}

export type Bill = Invoice & { bill_no: string }
export function useBills(orgId: string | null, partyId?: string, openOnly = false) {
  return useQuery({
    queryKey: ['bills', orgId, partyId ?? 'all', openOnly],
    enabled: !!orgId,
    queryFn: async (): Promise<Bill[]> => {
      let qb = supabase.from('bills').select('id, party_id, bill_no, date, total, outstanding')
        .eq('org_id', orgId).order('date', { ascending: false })
      if (partyId) qb = qb.eq('party_id', partyId)
      if (openOnly) qb = qb.gt('outstanding', 0)
      const { data, error } = await qb
      if (error) throw error
      return (data ?? []).map((b) => ({ ...b, invoice_no: (b as { bill_no: string }).bill_no })) as Bill[]
    },
  })
}

export type ReturnNote = {
  voucher_id: string
  voucher_no: string
  date: string
  party_name: string | null
  amount: number
  status: string
}

export function useCreditNotes(orgId: string | null) {
  return useQuery({
    queryKey: ['credit_notes', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<ReturnNote[]> => {
      const { data, error } = await supabase
        .from('v_day_book')
        .select('voucher_id, voucher_no, date, party_name, amount, status')
        .eq('org_id', orgId)
        .eq('type_code', 'CREDIT_NOTE')
        .order('date', { ascending: false })
      if (error) throw error
      return (data ?? []) as ReturnNote[]
    },
  })
}

export function useDebitNotes(orgId: string | null) {
  return useQuery({
    queryKey: ['debit_notes', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<ReturnNote[]> => {
      const { data, error } = await supabase
        .from('v_day_book')
        .select('voucher_id, voucher_no, date, party_name, amount, status')
        .eq('org_id', orgId)
        .eq('type_code', 'DEBIT_NOTE')
        .order('date', { ascending: false })
      if (error) throw error
      return (data ?? []) as ReturnNote[]
    },
  })
}

export type PaymentRow = {
  voucher_id: string; voucher_no: string; date: string
  party_name: string | null; mode: string; amount: number; narration: string | null
}

export function usePaymentsReceived(orgId: string | null) {
  return useQuery({
    queryKey: ['payments_received', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<PaymentRow[]> => {
      const { data, error } = await supabase
        .from('v_payments_received')
        .select('voucher_id, voucher_no, date, party_name, mode, amount, narration')
        .eq('org_id', orgId)
        .order('date', { ascending: false })
      if (error) throw error
      return (data ?? []) as PaymentRow[]
    },
  })
}

export function usePaymentsMade(orgId: string | null) {
  return useQuery({
    queryKey: ['payments_made', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<PaymentRow[]> => {
      const { data, error } = await supabase
        .from('v_payments_made')
        .select('voucher_id, voucher_no, date, party_name, mode, amount, narration')
        .eq('org_id', orgId)
        .order('date', { ascending: false })
      if (error) throw error
      return (data ?? []) as PaymentRow[]
    },
  })
}

export type AgedRow = {
  party_name: string; invoice_no?: string; bill_no?: string; date: string
  outstanding: number; age_days: number
  b_0_30: number; b_31_60: number; b_61_90: number; b_90_plus: number
}
export function useAged(orgId: string | null, kind: 'receivables' | 'payables') {
  return useQuery({
    queryKey: ['aged', orgId, kind],
    enabled: !!orgId,
    queryFn: async (): Promise<AgedRow[]> => {
      const { data, error } = await supabase
        .from(kind === 'receivables' ? 'v_aged_receivables' : 'v_aged_payables')
        .select('*').eq('org_id', orgId).order('age_days', { ascending: false })
      if (error) throw error
      return (data ?? []) as AgedRow[]
    },
  })
}

export type LedgerRow = {
  voucher_id: string; date: string; voucher_no: string; type_code: string
  narration: string | null; debit: number; credit: number; running_balance: number
}
export function usePartyLedger(orgId: string | null, partyId: string | null) {
  return useQuery({
    queryKey: ['party_ledger', orgId, partyId],
    enabled: !!orgId && !!partyId,
    queryFn: async (): Promise<LedgerRow[]> => {
      const { data, error } = await supabase
        .from('v_party_ledger')
        .select('voucher_id, date, voucher_no, type_code, narration, debit, credit, running_balance')
        .eq('org_id', orgId).eq('party_id', partyId)
        .order('date').order('voucher_no')
      if (error) throw error
      return (data ?? []) as LedgerRow[]
    },
  })
}

export type StockLedgerRow = {
  date: string; voucher_no: string | null; type_code: string | null
  qty_change: number; unit_cost: number; value_change: number
  balance_qty: number; balance_value: number; reason: string | null
}
export function useStockLedger(orgId: string | null, itemId: string | null) {
  return useQuery({
    queryKey: ['stock_ledger', orgId, itemId],
    enabled: !!orgId && !!itemId,
    queryFn: async (): Promise<StockLedgerRow[]> => {
      const { data, error } = await supabase.from('v_stock_ledger')
        .select('date, voucher_no, type_code, qty_change, unit_cost, value_change, balance_qty, balance_value, reason')
        .eq('org_id', orgId).eq('stock_item_id', itemId).order('date').order('voucher_no')
      if (error) throw error
      return (data ?? []) as StockLedgerRow[]
    },
  })
}

export function useInventoryRecon(orgId: string | null) {
  return useQuery({
    queryKey: ['inv_recon', orgId], enabled: !!orgId,
    queryFn: async (): Promise<{ ledger_balance: number; stock_value: number } | null> => {
      const { data, error } = await supabase.from('v_inventory_reconciliation').select('*').eq('org_id', orgId).maybeSingle()
      if (error) throw error
      return data as { ledger_balance: number; stock_value: number } | null
    },
  })
}

export type FinRow = { account_id: string; account_name: string; group_id: number; amount?: number; balance?: number }
export function useProfitLoss(orgId: string | null) {
  return useQuery({
    queryKey: ['pl', orgId], enabled: !!orgId,
    queryFn: async (): Promise<FinRow[]> => {
      const { data, error } = await supabase.from('v_profit_loss').select('*').eq('org_id', orgId).order('group_id')
      if (error) throw error
      return (data ?? []) as FinRow[]
    },
  })
}
export function useBalanceSheet(orgId: string | null) {
  return useQuery({
    queryKey: ['bs', orgId], enabled: !!orgId,
    queryFn: async (): Promise<FinRow[]> => {
      const { data, error } = await supabase.from('v_balance_sheet').select('*').eq('org_id', orgId).order('group_id')
      if (error) throw error
      return (data ?? []) as FinRow[]
    },
  })
}

export type GstSummary = { output_tax: number; input_credit: number; net_payable: number }
export function useGstSummary(orgId: string | null) {
  return useQuery({
    queryKey: ['gst', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<GstSummary | null> => {
      const { data, error } = await supabase.from('v_gst_summary').select('*').eq('org_id', orgId).maybeSingle()
      if (error) throw error
      return data as GstSummary | null
    },
  })
}

export type InvoiceDetailLine = {
  line_id: string
  stock_item_id: string
  item_name: string
  unit: string
  hsn: string | null
  gst_rate: number
  qty: number
  rate: number   // paise per unit
  amount: number // paise
}

export type InvoiceDetail = {
  invoice_id: string
  invoice_no: string
  date: string
  total: number
  outstanding: number
  party_id: string
  party_name: string
  narration: string | null
  discount_amount: number
  freight_amount: number
  round_off: number
  org_name: string
  org_gstin: string | null
  org_state_code: string | null
  org_pan_no: string | null
  org_phone: string | null
  org_email: string | null
  org_address_line1: string | null
  org_address_line2: string | null
  org_city: string | null
  org_pincode: string | null
  org_bank_name: string | null
  org_bank_account_no: string | null
  org_bank_ifsc: string | null
  org_upi: string | null
  party_gstin: string | null
  party_state_code: string | null
  lines: InvoiceDetailLine[]
}

export function useInvoiceDetail(orgId: string | null, invoiceId: string | null) {
  return useQuery({
    queryKey: ['invoice_detail', orgId, invoiceId],
    enabled: !!orgId && !!invoiceId,
    queryFn: async (): Promise<InvoiceDetail | null> => {
      const { data, error } = await supabase
        .from('v_invoice_detail')
        .select('*')
        .eq('org_id', orgId)
        .eq('invoice_id', invoiceId)
      if (error) throw error
      if (!data || data.length === 0) return null
      const first = data[0] as Record<string, unknown>
      return {
        invoice_id:  first.invoice_id  as string,
        invoice_no:  first.invoice_no  as string,
        date:        first.date        as string,
        total:       Number(first.total),
        outstanding: Number(first.outstanding),
        party_id:    first.party_id    as string,
        party_name:  first.party_name  as string,
        narration:   first.narration   as string | null,
        discount_amount: Number(first.discount_amount),
        freight_amount:  Number(first.freight_amount),
        round_off:       Number(first.round_off),
        org_name:         String(first.org_name ?? ''),
        org_gstin:        first.org_gstin        ? String(first.org_gstin)        : null,
        org_state_code:   first.org_state_code   ? String(first.org_state_code)   : null,
        org_pan_no:          first.org_pan_no          ? String(first.org_pan_no)          : null,
        org_phone:           first.org_phone           ? String(first.org_phone)           : null,
        org_email:           first.org_email           ? String(first.org_email)           : null,
        org_address_line1:   first.org_address_line1   ? String(first.org_address_line1)   : null,
        org_address_line2:   first.org_address_line2   ? String(first.org_address_line2)   : null,
        org_city:            first.org_city            ? String(first.org_city)            : null,
        org_pincode:         first.org_pincode         ? String(first.org_pincode)         : null,
        org_bank_name:       first.org_bank_name       ? String(first.org_bank_name)       : null,
        org_bank_account_no: first.org_bank_account_no ? String(first.org_bank_account_no) : null,
        org_bank_ifsc:       first.org_bank_ifsc       ? String(first.org_bank_ifsc)       : null,
        org_upi:             first.org_upi             ? String(first.org_upi)             : null,
        party_gstin:      first.party_gstin      ? String(first.party_gstin)      : null,
        party_state_code: first.party_state_code ? String(first.party_state_code) : null,
        lines: data.map((r) => {
          const row = r as Record<string, unknown>
          return {
            line_id:       row.line_id       as string,
            stock_item_id: row.stock_item_id as string,
            item_name:     row.item_name     as string,
            unit:          row.unit          as string,
            hsn:           row.hsn ? String(row.hsn) : null,
            gst_rate:      Number(row.gst_rate),
            qty:           Number(row.qty),
            rate:          Number(row.rate),
            amount:        Number(row.amount),
          }
        }),
      }
    },
  })
}

export type OrgSettings = {
  org_id: string
  business_name: string | null
  gstin: string | null
  state_code: string | null
  pan_no: string | null
  phone: string | null
  email: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  pincode: string | null
  bank_name: string | null
  bank_account_no: string | null
  bank_ifsc: string | null
  upi: string | null
  negative_stock_policy: string
}

export function useOrgSettings(orgId: string | null) {
  return useQuery({
    queryKey: ['org_settings', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<OrgSettings | null> => {
      const { data, error } = await supabase
        .from('org_settings')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle()
      if (error) throw error
      return data as OrgSettings | null
    },
  })
}

export type MonthlyPL = {
  month: string   // ISO date string — first day of month
  income: number  // paise
  expense: number // paise
}

export function useMonthlyPL(orgId: string | null, from?: string, to?: string) {
  return useQuery({
    queryKey: ['monthly_pl', orgId, from, to],
    enabled: !!orgId,
    queryFn: async (): Promise<MonthlyPL[]> => {
      const { data, error } = await supabase
        .from('v_monthly_pl')
        .select('month, income, expense')
        .eq('org_id', orgId!)
        .gte('month', from ?? '1970-01-01')
        .lte('month', to   ?? '2099-12-31')
        .order('month', { ascending: true })
        .limit(12)
      if (error) throw error
      return (data ?? []).map((r) => ({
        month:   String(r.month),
        income:  Number(r.income),
        expense: Number(r.expense),
      }))
    },
  })
}

export type MonthlyCashFlow = {
  month: string
  incoming: number  // paise — debits to cash/bank
  outgoing: number  // paise — credits to cash/bank
}

export function useMonthlyCashFlow(orgId: string | null, from?: string, to?: string) {
  return useQuery({
    queryKey: ['monthly_cashflow', orgId, from, to],
    enabled: !!orgId,
    queryFn: async (): Promise<MonthlyCashFlow[]> => {
      const { data, error } = await supabase
        .from('v_monthly_cashflow')
        .select('month, incoming, outgoing')
        .eq('org_id', orgId!)
        .gte('month', from ?? '1970-01-01')
        .lte('month', to   ?? '2099-12-31')
        .order('month', { ascending: true })
        .limit(12)
      if (error) throw error
      return (data ?? []).map((r) => ({
        month:    String(r.month),
        incoming: Number(r.incoming),
        outgoing: Number(r.outgoing),
      }))
    },
  })
}

// ---- Party Breakdown (customer/supplier sales by period) ----
export type PartyBreakdownRow = {
  party_name: string
  sales: number
  outstanding: number
  invoices: number
}

export function useCustomerBreakdown(orgId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['customer_breakdown', orgId, from, to],
    enabled: !!orgId,
    queryFn: async (): Promise<PartyBreakdownRow[]> => {
      const { data, error } = await supabase
        .from('invoices')
        .select('total, outstanding, party:parties(name)')
        .eq('org_id', orgId!)
        .gte('date', from)
        .lte('date', to)
        .not('party_id', 'is', null)
      if (error) throw error
      const map = new Map<string, PartyBreakdownRow>()
      for (const r of data ?? []) {
        const name = (r.party as { name: string } | null)?.name ?? 'Unknown'
        const e = map.get(name) ?? { party_name: name, sales: 0, outstanding: 0, invoices: 0 }
        e.sales       += Number(r.total)
        e.outstanding += Number(r.outstanding)
        e.invoices    += 1
        map.set(name, e)
      }
      return Array.from(map.values()).sort((a, b) => b.sales - a.sales)
    },
  })
}

// ---- Sales Orders ----
export type SalesOrder = {
  id: string; org_id: string; so_no: string; date: string
  party_id: string; party_name: string; delivery_date: string | null
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled'
  narration: string | null; discount_amount: number; freight_amount: number
  linked_voucher_id: string | null; total: number
}
export function useSalesOrders(orgId: string | null) {
  return useQuery({
    queryKey: ['sales_orders', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<SalesOrder[]> => {
      const { data, error } = await supabase
        .from('v_sales_orders').select('*').eq('org_id', orgId)
        .order('date', { ascending: false })
      if (error) throw error
      return (data ?? []) as SalesOrder[]
    },
  })
}

export type OrderDetailLine = {
  line_id: string; stock_item_id: string; item_name: string
  unit: string; hsn: string | null; gst_rate: number
  qty: number; rate: number; amount: number
}
export type SalesOrderDetail = {
  so_id: string; org_id: string; so_no: string; date: string
  party_id: string; party_name: string
  party_gstin: string | null; party_state_code: string | null
  delivery_date: string | null
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled'
  narration: string | null; discount_amount: number; freight_amount: number
  linked_voucher_id: string | null
  org_name: string; org_gstin: string | null; org_state_code: string | null
  org_phone: string | null; org_email: string | null
  org_address_line1: string | null; org_address_line2: string | null
  org_city: string | null; org_pincode: string | null
  lines: OrderDetailLine[]
}
export function useSalesOrderDetail(orgId: string | null, soId: string | null) {
  return useQuery({
    queryKey: ['so_detail', orgId, soId],
    enabled: !!orgId && !!soId,
    queryFn: async (): Promise<SalesOrderDetail | null> => {
      const { data, error } = await supabase
        .from('v_sales_order_detail').select('*')
        .eq('org_id', orgId).eq('so_id', soId)
      if (error) throw error
      if (!data || data.length === 0) return null
      const f = data[0] as Record<string, unknown>
      return {
        so_id: f.so_id as string, org_id: f.org_id as string,
        so_no: f.so_no as string, date: f.date as string,
        party_id: f.party_id as string, party_name: f.party_name as string,
        party_gstin: f.party_gstin ? String(f.party_gstin) : null,
        party_state_code: f.party_state_code ? String(f.party_state_code) : null,
        delivery_date: f.delivery_date ? String(f.delivery_date) : null,
        status: f.status as SalesOrderDetail['status'],
        narration: f.narration ? String(f.narration) : null,
        discount_amount: Number(f.discount_amount), freight_amount: Number(f.freight_amount),
        linked_voucher_id: f.linked_voucher_id ? String(f.linked_voucher_id) : null,
        org_name: String(f.org_name ?? ''),
        org_gstin: f.org_gstin ? String(f.org_gstin) : null,
        org_state_code: f.org_state_code ? String(f.org_state_code) : null,
        org_phone: f.org_phone ? String(f.org_phone) : null,
        org_email: f.org_email ? String(f.org_email) : null,
        org_address_line1: f.org_address_line1 ? String(f.org_address_line1) : null,
        org_address_line2: f.org_address_line2 ? String(f.org_address_line2) : null,
        org_city: f.org_city ? String(f.org_city) : null,
        org_pincode: f.org_pincode ? String(f.org_pincode) : null,
        lines: data.map((r) => {
          const row = r as Record<string, unknown>
          return {
            line_id: row.line_id as string, stock_item_id: row.stock_item_id as string,
            item_name: row.item_name as string, unit: row.unit as string,
            hsn: row.hsn ? String(row.hsn) : null, gst_rate: Number(row.gst_rate),
            qty: Number(row.qty), rate: Number(row.rate), amount: Number(row.amount),
          }
        }),
      }
    },
  })
}

// ---- Purchase Orders ----
export type PurchaseOrder = {
  id: string; org_id: string; po_no: string; date: string
  party_id: string; party_name: string; delivery_date: string | null
  status: 'draft' | 'confirmed' | 'billed' | 'cancelled'
  narration: string | null; linked_voucher_id: string | null; total: number
}
export function usePurchaseOrders(orgId: string | null) {
  return useQuery({
    queryKey: ['purchase_orders', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<PurchaseOrder[]> => {
      const { data, error } = await supabase
        .from('v_purchase_orders').select('*').eq('org_id', orgId)
        .order('date', { ascending: false })
      if (error) throw error
      return (data ?? []) as PurchaseOrder[]
    },
  })
}

export type PurchaseOrderDetail = {
  po_id: string; org_id: string; po_no: string; date: string
  party_id: string; party_name: string
  party_gstin: string | null; party_state_code: string | null
  delivery_date: string | null
  status: 'draft' | 'confirmed' | 'billed' | 'cancelled'
  narration: string | null; linked_voucher_id: string | null
  org_name: string; org_gstin: string | null; org_state_code: string | null
  org_phone: string | null; org_email: string | null
  org_address_line1: string | null; org_address_line2: string | null
  org_city: string | null; org_pincode: string | null
  lines: OrderDetailLine[]
}
export function usePurchaseOrderDetail(orgId: string | null, poId: string | null) {
  return useQuery({
    queryKey: ['po_detail', orgId, poId],
    enabled: !!orgId && !!poId,
    queryFn: async (): Promise<PurchaseOrderDetail | null> => {
      const { data, error } = await supabase
        .from('v_purchase_order_detail').select('*')
        .eq('org_id', orgId).eq('po_id', poId)
      if (error) throw error
      if (!data || data.length === 0) return null
      const f = data[0] as Record<string, unknown>
      return {
        po_id: f.po_id as string, org_id: f.org_id as string,
        po_no: f.po_no as string, date: f.date as string,
        party_id: f.party_id as string, party_name: f.party_name as string,
        party_gstin: f.party_gstin ? String(f.party_gstin) : null,
        party_state_code: f.party_state_code ? String(f.party_state_code) : null,
        delivery_date: f.delivery_date ? String(f.delivery_date) : null,
        status: f.status as PurchaseOrderDetail['status'],
        narration: f.narration ? String(f.narration) : null,
        linked_voucher_id: f.linked_voucher_id ? String(f.linked_voucher_id) : null,
        org_name: String(f.org_name ?? ''),
        org_gstin: f.org_gstin ? String(f.org_gstin) : null,
        org_state_code: f.org_state_code ? String(f.org_state_code) : null,
        org_phone: f.org_phone ? String(f.org_phone) : null,
        org_email: f.org_email ? String(f.org_email) : null,
        org_address_line1: f.org_address_line1 ? String(f.org_address_line1) : null,
        org_address_line2: f.org_address_line2 ? String(f.org_address_line2) : null,
        org_city: f.org_city ? String(f.org_city) : null,
        org_pincode: f.org_pincode ? String(f.org_pincode) : null,
        lines: data.map((r) => {
          const row = r as Record<string, unknown>
          return {
            line_id: row.line_id as string, stock_item_id: row.stock_item_id as string,
            item_name: row.item_name as string, unit: row.unit as string,
            hsn: row.hsn ? String(row.hsn) : null, gst_rate: Number(row.gst_rate),
            qty: Number(row.qty), rate: Number(row.rate), amount: Number(row.amount),
          }
        }),
      }
    },
  })
}

// ---- Bill Detail ----
export type BillDetail = {
  bill_id: string; org_id: string; bill_no: string; date: string
  total: number; outstanding: number
  party_id: string; party_name: string
  party_gstin: string | null; party_state_code: string | null
  narration: string | null
  org_name: string; org_gstin: string | null; org_state_code: string | null
  org_pan_no: string | null; org_phone: string | null; org_email: string | null
  org_address_line1: string | null; org_address_line2: string | null
  org_city: string | null; org_pincode: string | null
  org_bank_name: string | null; org_bank_account_no: string | null
  org_bank_ifsc: string | null; org_upi: string | null
  lines: OrderDetailLine[]
}
export function useBillDetail(orgId: string | null, billId: string | null) {
  return useQuery({
    queryKey: ['bill_detail', orgId, billId],
    enabled: !!orgId && !!billId,
    queryFn: async (): Promise<BillDetail | null> => {
      const { data, error } = await supabase
        .from('v_bill_detail').select('*')
        .eq('org_id', orgId).eq('bill_id', billId)
      if (error) throw error
      if (!data || data.length === 0) return null
      const f = data[0] as Record<string, unknown>
      return {
        bill_id: f.bill_id as string, org_id: f.org_id as string,
        bill_no: f.bill_no as string, date: f.date as string,
        total: Number(f.total), outstanding: Number(f.outstanding),
        party_id: f.party_id as string, party_name: f.party_name as string,
        party_gstin: f.party_gstin ? String(f.party_gstin) : null,
        party_state_code: f.party_state_code ? String(f.party_state_code) : null,
        narration: f.narration ? String(f.narration) : null,
        org_name: String(f.org_name ?? ''),
        org_gstin: f.org_gstin ? String(f.org_gstin) : null,
        org_state_code: f.org_state_code ? String(f.org_state_code) : null,
        org_pan_no: f.org_pan_no ? String(f.org_pan_no) : null,
        org_phone: f.org_phone ? String(f.org_phone) : null,
        org_email: f.org_email ? String(f.org_email) : null,
        org_address_line1: f.org_address_line1 ? String(f.org_address_line1) : null,
        org_address_line2: f.org_address_line2 ? String(f.org_address_line2) : null,
        org_city: f.org_city ? String(f.org_city) : null,
        org_pincode: f.org_pincode ? String(f.org_pincode) : null,
        org_bank_name: f.org_bank_name ? String(f.org_bank_name) : null,
        org_bank_account_no: f.org_bank_account_no ? String(f.org_bank_account_no) : null,
        org_bank_ifsc: f.org_bank_ifsc ? String(f.org_bank_ifsc) : null,
        org_upi: f.org_upi ? String(f.org_upi) : null,
        lines: data.map((r) => {
          const row = r as Record<string, unknown>
          return {
            line_id: row.line_id as string, stock_item_id: row.stock_item_id as string,
            item_name: row.item_name as string, unit: row.unit as string,
            hsn: row.hsn ? String(row.hsn) : null, gst_rate: Number(row.gst_rate),
            qty: Number(row.qty), rate: Number(row.rate), amount: Number(row.amount),
          }
        }),
      }
    },
  })
}
