// Money is stored as bigint paise everywhere. UI works in rupees.

/** Format paise as Indian-grouped rupees, e.g. 15000000 -> "₹1,50,000.00" */
export function formatINR(paise: number, withSymbol = true): string {
  const rupees = (paise ?? 0) / 100
  const s = rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return withSymbol ? `₹${s}` : s
}

/** Convert a rupee input (number or string) to integer paise. */
export function rupeesToPaise(rupees: number | string): number {
  const n = typeof rupees === 'string' ? parseFloat(rupees) : rupees
  if (!isFinite(n)) return 0
  return Math.round(n * 100)
}

/** Convert paise to a plain rupee number (for form fields). */
export function paiseToRupees(paise: number): number {
  return (paise ?? 0) / 100
}

/** Format a DD-MM-YYYY string from an ISO date. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('T')[0].split('-')
  return `${d}-${m}-${y}`
}
