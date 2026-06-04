import type { SalesOrderDetail } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'

export function SalesOrderPrint({ so }: { so: SalesOrderDetail }) {
  const subtotal = so.lines.reduce((s, l) => s + l.amount, 0)
  const taxable = subtotal - so.discount_amount
  const isInter = !!so.org_state_code && !!so.party_state_code && so.org_state_code !== so.party_state_code
  const gstTotal = so.lines.reduce((s, l) => {
    const base = Math.round(l.qty * l.rate)
    return s + (l.gst_rate > 0 ? Math.round(base * l.gst_rate / 100) : 0)
  }, 0)
  const scaledGst = subtotal > 0 ? Math.round(gstTotal * taxable / subtotal) : 0
  const total = taxable + scaledGst + so.freight_amount

  return (
    <div className="hidden print:block p-8 text-sm text-black font-sans">
      <div className="text-center mb-6">
        <h1 className="text-xl font-bold tracking-wide uppercase">Sales Order</h1>
      </div>
      <div className="flex justify-between mb-6">
        <div>
          <p className="font-semibold text-base">{so.org_name}</p>
          {so.org_gstin && <p className="text-xs mt-0.5">GSTIN: {so.org_gstin}</p>}
          {so.org_address_line1 && <p className="text-xs mt-0.5">{so.org_address_line1}</p>}
          {so.org_address_line2 && <p className="text-xs">{so.org_address_line2}</p>}
          {(so.org_city || so.org_pincode) && (
            <p className="text-xs">{[so.org_city, so.org_pincode].filter(Boolean).join(' - ')}</p>
          )}
          {so.org_phone && <p className="text-xs mt-0.5">Ph: {so.org_phone}</p>}
        </div>
        <div className="text-right text-sm">
          <p><span className="font-medium">Sales Order#:</span> {so.so_no}</p>
          <p><span className="font-medium">Date:</span> {formatDate(so.date)}</p>
          {so.delivery_date && <p><span className="font-medium">Delivery Date:</span> {formatDate(so.delivery_date)}</p>}
        </div>
      </div>
      <div className="border border-black p-3 mb-6">
        <p className="text-xs font-semibold mb-1">Bill To</p>
        <p className="font-semibold">{so.party_name}</p>
        {so.party_gstin && <p className="text-xs">GSTIN: {so.party_gstin}</p>}
      </div>
      <table className="w-full border-collapse mb-4 text-xs">
        <thead>
          <tr className="bg-gray-800 text-white">
            <th className="border border-gray-300 p-2 text-left">#</th>
            <th className="border border-gray-300 p-2 text-left">Item & Description</th>
            <th className="border border-gray-300 p-2 text-right">Qty</th>
            <th className="border border-gray-300 p-2 text-right">Rate</th>
            <th className="border border-gray-300 p-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {so.lines.map((l, i) => (
            <tr key={l.line_id}>
              <td className="border border-gray-300 p-2">{i + 1}</td>
              <td className="border border-gray-300 p-2">{l.item_name}<br /><span className="text-gray-500">{l.unit}</span></td>
              <td className="border border-gray-300 p-2 text-right">{Number(l.qty)}</td>
              <td className="border border-gray-300 p-2 text-right">{formatINR(l.rate, false)}</td>
              <td className="border border-gray-300 p-2 text-right">{formatINR(l.amount, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end mb-8">
        <div className="w-48 text-xs space-y-1">
          <div className="flex justify-between"><span>Sub Total</span><span>{formatINR(subtotal, false)}</span></div>
          {so.discount_amount > 0 && <div className="flex justify-between"><span>− Discount</span><span>{formatINR(so.discount_amount, false)}</span></div>}
          {scaledGst > 0 && (
            isInter
              ? <div className="flex justify-between"><span>IGST</span><span>{formatINR(scaledGst, false)}</span></div>
              : <>
                  <div className="flex justify-between"><span>CGST</span><span>{formatINR(Math.round(scaledGst / 2), false)}</span></div>
                  <div className="flex justify-between"><span>SGST</span><span>{formatINR(Math.round(scaledGst / 2), false)}</span></div>
                </>
          )}
          {so.freight_amount > 0 && <div className="flex justify-between"><span>+ Freight</span><span>{formatINR(so.freight_amount, false)}</span></div>}
          <div className="flex justify-between font-bold border-t border-black pt-1">
            <span>Total</span><span>{formatINR(total)}</span>
          </div>
        </div>
      </div>
      <div className="mt-12 border-t border-black pt-2 w-48">
        <p className="text-xs">Authorized Signature</p>
      </div>
    </div>
  )
}
