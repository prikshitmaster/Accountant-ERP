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
