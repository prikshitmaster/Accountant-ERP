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

export type Item = {
  id: string; name: string; item_type: number; unit: string
  qty_on_hand: number; avg_cost: number; value_on_hand: number
  min_level: number; hsn: string | null; gst_rate: number
}
export function useItems(orgId: string | null) {
  return useQuery({
    queryKey: ['items', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Item[]> => {
      const { data, error } = await supabase
        .from('stock_items')
        .select('id, name, item_type, unit, qty_on_hand, avg_cost, value_on_hand, min_level, hsn, gst_rate')
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
