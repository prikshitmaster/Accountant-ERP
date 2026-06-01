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
  zero_cost_manufacture: 'The materials consumed have no cost — set their cost first.',
  invalid_quantity: 'Quantities must be greater than zero.',
  invalid_weight: 'Each finished good needs a cost weight greater than zero.',
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

  createParty: (
    orgId: string, name: string, kind: string,
    phone?: string, gstin?: string, stateCode?: string,
    details: Record<string, unknown> = {},
    opening?: { amount: number; type: 'dr' | 'cr'; date: string },
  ) =>
    callRpc<string>('create_party', {
      p_org: orgId, p_name: name, p_kind: kind, p_phone: phone ?? null,
      p_gstin: gstin ?? null, p_state_code: stateCode ?? null,
      p_details: details,
      p_opening_amount: opening?.amount ?? 0,
      p_opening_type: opening?.type ?? null,
      p_opening_date: opening?.date ?? null,
    }),

  createStockItem: (
    orgId: string, name: string, itemType: number, unit: string,
    minLevel = 0, hsn?: string, gstRate = 0,
    details: Record<string, unknown> = {},
    opening?: { qty: number; rate: number; date: string },
  ) =>
    callRpc<string>('create_stock_item', {
      p_org: orgId, p_name: name, p_item_type: itemType, p_unit: unit,
      p_min_level: minLevel, p_hsn: hsn ?? null, p_gst_rate: gstRate,
      p_details: details,
      p_opening_qty: opening?.qty ?? 0,
      p_opening_rate: opening?.rate ?? 0,
      p_opening_date: opening?.date ?? null,
    }),

  sell: (orgId: string, date: string, party: string | null, items: unknown[], mode: string, narration?: string) =>
    callRpc<{ voucher_no: string }>('sell', {
      p_org: orgId, p_date: date, p_party: party, p_items: items, p_mode: mode, p_narration: narration ?? null,
    }),

  purchase: (orgId: string, date: string, party: string | null, items: unknown[], mode: string, narration?: string) =>
    callRpc<{ voucher_no: string }>('purchase', {
      p_org: orgId, p_date: date, p_party: party, p_items: items, p_mode: mode, p_narration: narration ?? null,
    }),

  manufacture: (
    orgId: string,
    date: string,
    inputs: { stock_item_id: string; qty: number }[],
    outputs: { stock_item_id: string; qty: number; weight: number }[],
    narration?: string,
  ) =>
    callRpc<{ voucher_no: string }>('manufacture', {
      p_org: orgId, p_date: date, p_inputs: inputs, p_outputs: outputs,
      p_narration: narration ?? null,
    }),

  receivePayment: (orgId: string, date: string, party: string, amountPaise: number, mode: string, allocations: unknown[], narration?: string) =>
    callRpc<{ voucher_no: string }>('receive_payment', {
      p_org: orgId, p_date: date, p_party: party, p_amount: amountPaise, p_mode: mode,
      p_allocations: allocations, p_narration: narration ?? null,
    }),

  makePayment: (orgId: string, date: string, party: string, amountPaise: number, mode: string, allocations: unknown[], narration?: string) =>
    callRpc<{ voucher_no: string }>('make_payment', {
      p_org: orgId, p_date: date, p_party: party, p_amount: amountPaise, p_mode: mode,
      p_allocations: allocations, p_narration: narration ?? null,
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

  closePeriod: (orgId: string, lockUpto: string) =>
    callRpc('close_period', { p_org: orgId, p_lock_upto: lockUpto }),
}
