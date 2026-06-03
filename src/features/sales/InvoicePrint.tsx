import type { InvoiceDetail } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'

export function InvoicePrint({ inv }: { inv: InvoiceDetail }) {
  const subtotal = inv.lines.reduce((s, l) => s + l.amount, 0)
  const taxable  = subtotal - inv.discount_amount
  const totalGst = inv.total - taxable - inv.freight_amount - inv.round_off

  const isInter =
    !!inv.org_state_code &&
    !!inv.party_state_code &&
    inv.org_state_code !== inv.party_state_code

  const hasStateInfo = !!inv.org_state_code && !!inv.party_state_code

  return (
    <div className="hidden print:block p-8 text-sm text-black font-sans">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-xl font-bold tracking-wide uppercase">Tax Invoice</h1>
      </div>

      {/* Supplier + Invoice meta */}
      <div className="flex justify-between mb-6">
        <div>
          <p className="font-semibold text-base">{inv.org_name}</p>
          {inv.org_gstin && <p className="text-xs mt-0.5">GSTIN: {inv.org_gstin}</p>}
          {(inv.org_state_code || inv.org_pan_no) && (
            <p className="text-xs">
              {inv.org_state_code && `State: ${inv.org_state_code}`}
              {inv.org_state_code && inv.org_pan_no && '  |  '}
              {inv.org_pan_no && `PAN: ${inv.org_pan_no}`}
            </p>
          )}
          {inv.org_address_line1 && <p className="text-xs mt-0.5">{inv.org_address_line1}</p>}
          {inv.org_address_line2 && <p className="text-xs">{inv.org_address_line2}</p>}
          {(inv.org_city || inv.org_pincode) && (
            <p className="text-xs">{[inv.org_city, inv.org_pincode].filter(Boolean).join(' - ')}</p>
          )}
          {inv.org_phone && <p className="text-xs mt-0.5">Ph: {inv.org_phone}</p>}
          {inv.org_email && <p className="text-xs">E: {inv.org_email}</p>}
        </div>
        <div className="text-right">
          <p><span className="font-medium">Invoice No:</span> {inv.invoice_no}</p>
          <p><span className="font-medium">Date:</span> {formatDate(inv.date)}</p>
        </div>
      </div>

      {/* Bill To */}
      <div className="border border-black p-3 mb-6">
        <p className="font-semibold mb-1">Bill To:</p>
        <p className="font-medium">{inv.party_name}</p>
        {inv.party_gstin && <p className="text-xs mt-0.5">GSTIN: {inv.party_gstin}</p>}
        {inv.party_state_code && <p className="text-xs">State Code: {inv.party_state_code}</p>}
      </div>

      {/* Items table */}
      <table className="w-full border-collapse mb-6 text-xs">
        <thead>
          <tr className="border border-black">
            <th className="border border-black p-2 text-left w-6">#</th>
            <th className="border border-black p-2 text-left">Description</th>
            <th className="border border-black p-2 text-left w-16">HSN</th>
            <th className="border border-black p-2 text-right w-12">Qty</th>
            <th className="border border-black p-2 text-left w-12">Unit</th>
            <th className="border border-black p-2 text-right w-20">Rate (₹)</th>
            <th className="border border-black p-2 text-right w-12">GST%</th>
            <th className="border border-black p-2 text-right w-24">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={l.line_id} className="border border-black">
              <td className="border border-black p-2">{i + 1}</td>
              <td className="border border-black p-2">{l.item_name}</td>
              <td className="border border-black p-2">{l.hsn ?? '—'}</td>
              <td className="border border-black p-2 text-right">{Number(l.qty)}</td>
              <td className="border border-black p-2">{l.unit}</td>
              <td className="border border-black p-2 text-right">{formatINR(l.rate, false)}</td>
              <td className="border border-black p-2 text-right">{Number(l.gst_rate) > 0 ? `${l.gst_rate}%` : '—'}</td>
              <td className="border border-black p-2 text-right">{formatINR(l.amount, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end mb-6">
        <table className="text-xs">
          <tbody>
            <tr>
              <td className="pr-8 py-1">Subtotal</td>
              <td className="text-right font-mono">{formatINR(subtotal, false)}</td>
            </tr>
            {inv.discount_amount > 0 && (
              <tr>
                <td className="pr-8 py-1">− Discount</td>
                <td className="text-right font-mono">{formatINR(inv.discount_amount, false)}</td>
              </tr>
            )}
            {inv.discount_amount > 0 && (
              <tr>
                <td className="pr-8 py-1">Taxable</td>
                <td className="text-right font-mono">{formatINR(taxable, false)}</td>
              </tr>
            )}
            {totalGst > 0 && hasStateInfo && !isInter && (
              <>
                <tr>
                  <td className="pr-8 py-1">CGST</td>
                  <td className="text-right font-mono">{formatINR(Math.floor(totalGst / 2), false)}</td>
                </tr>
                <tr>
                  <td className="pr-8 py-1">SGST</td>
                  <td className="text-right font-mono">{formatINR(totalGst - Math.floor(totalGst / 2), false)}</td>
                </tr>
              </>
            )}
            {totalGst > 0 && hasStateInfo && isInter && (
              <tr>
                <td className="pr-8 py-1">IGST</td>
                <td className="text-right font-mono">{formatINR(totalGst, false)}</td>
              </tr>
            )}
            {totalGst > 0 && !hasStateInfo && (
              <tr>
                <td className="pr-8 py-1">GST</td>
                <td className="text-right font-mono">{formatINR(totalGst, false)}</td>
              </tr>
            )}
            {inv.freight_amount > 0 && (
              <tr>
                <td className="pr-8 py-1">+ Freight</td>
                <td className="text-right font-mono">{formatINR(inv.freight_amount, false)}</td>
              </tr>
            )}
            {inv.round_off !== 0 && (
              <tr>
                <td className="pr-8 py-1">Round-off</td>
                <td className="text-right font-mono">
                  {inv.round_off > 0 ? '+' : '−'}{formatINR(Math.abs(inv.round_off), false)}
                </td>
              </tr>
            )}
            <tr className="border-t border-black font-semibold">
              <td className="pr-8 py-1">Bill Amount</td>
              <td className="text-right font-mono">{formatINR(inv.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Narration */}
      {inv.narration && (
        <p className="text-xs text-gray-600 mb-6">Note: {inv.narration}</p>
      )}

      {/* Payment Details */}
      {(inv.org_bank_name || inv.org_upi) && (
        <div className="border border-black p-3 mb-4 text-xs">
          <p className="font-semibold mb-1">Payment Details</p>
          {inv.org_bank_name && (
            <p>
              Bank: {inv.org_bank_name}
              {inv.org_bank_account_no && ` | A/c: ${inv.org_bank_account_no}`}
              {inv.org_bank_ifsc && ` | IFSC: ${inv.org_bank_ifsc}`}
            </p>
          )}
          {inv.org_upi && <p className="mt-0.5">UPI: {inv.org_upi}</p>}
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-black pt-3 flex justify-between text-xs text-gray-500">
        <span>This is a computer-generated invoice.</span>
        <span>{inv.org_name}</span>
      </div>
    </div>
  )
}
