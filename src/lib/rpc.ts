import { supabase } from './supabase'

/** Maps Postgres error messages from our RPC engine to friendly text. */
const ERROR_MAP: Record<string, string> = {
  not_authenticated: 'Please sign in again.',
  not_member: 'You are not a member of this organisation.',
  forbidden_role: 'You do not have permission to do this.',
  period_locked: 'This date falls in a locked accounting period.',
  unbalanced_voucher: 'The entry is not balanced (debits ≠ credits).',
  empty_voucher: 'The entry has no lines.',
  negative_stock_blocked: 'This would take stock negative, which is blocked.',
  unknown_stock_item: 'One of the stock items was not found.',
  invalid_amount: 'Enter an amount greater than zero.',
  opening_empty: 'Add at least one opening balance.',
  voucher_not_found: 'That voucher could not be found.',
  already_cancelled: 'This voucher is already cancelled.',
}

export function friendlyError(message: string): string {
  const key = Object.keys(ERROR_MAP).find((k) => message.includes(k))
  return key ? ERROR_MAP[key] : message
}

/** Thin typed wrapper over supabase.rpc with friendly error mapping. */
export async function callRpc<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(friendlyError(error.message))
  return data as T
}

// ---- Typed RPC helpers (Phase 1) ----
export const rpc = {
  createOrganization: (name: string, fyStartMonth = 4) =>
    callRpc<string>('create_organization', { p_name: name, p_fy_start_month: fyStartMonth }),

  createParty: (orgId: string, name: string, kind: string, phone?: string) =>
    callRpc<string>('create_party', { p_org: orgId, p_name: name, p_kind: kind, p_phone: phone ?? null }),

  createStockItem: (orgId: string, name: string, itemType: number, unit: string, minLevel = 0) =>
    callRpc<string>('create_stock_item', {
      p_org: orgId, p_name: name, p_item_type: itemType, p_unit: unit, p_min_level: minLevel,
    }),

  expense: (orgId: string, date: string, expenseAccount: string, amountPaise: number, mode: 'cash' | 'bank', narration?: string) =>
    callRpc('expense', {
      p_org: orgId, p_date: date, p_expense_account: expenseAccount,
      p_amount: amountPaise, p_mode: mode, p_party: null, p_narration: narration ?? null,
    }),

  contra: (orgId: string, date: string, fromAccount: string, toAccount: string, amountPaise: number, narration?: string) =>
    callRpc('contra', {
      p_org: orgId, p_date: date, p_from_account: fromAccount, p_to_account: toAccount,
      p_amount: amountPaise, p_narration: narration ?? null,
    }),

  introduceCapital: (orgId: string, date: string, amountPaise: number, mode: 'cash' | 'bank') =>
    callRpc('introduce_capital', { p_org: orgId, p_date: date, p_amount: amountPaise, p_mode: mode }),

  drawings: (orgId: string, date: string, amountPaise: number, mode: 'cash' | 'bank') =>
    callRpc('drawings', { p_org: orgId, p_date: date, p_amount: amountPaise, p_mode: mode }),

  openingBalances: (orgId: string, entries: unknown[], stock: unknown[]) =>
    callRpc('opening_balances', { p_org: orgId, p_entries: entries, p_stock: stock }),

  cancelVoucher: (orgId: string, voucherId: string) =>
    callRpc('cancel_voucher', { p_org: orgId, p_voucher: voucherId }),
}
