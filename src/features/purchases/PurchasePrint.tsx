// src/features/purchases/PurchasePrint.tsx
import type { BillDetail } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'

export function PurchasePrint({ bill }: { bill: BillDetail }) {
  const subtotal = bill.lines.reduce((s, l) => s + l.amount, 0)
  const isInter = !!bill.org_state_code && !!bill.party_state_code && bill.org_state_code !== bill.party_state_code
  const gstTotal = bill.lines.reduce((s, l) => l.gst_rate > 0 ? s + Math.round(l.amount * l.gst_rate / 100) : s, 0)

  return (
    <div className="p-8 text-sm text-black font-sans">
      <div className="text-center mb-6">
        <h1 className="text-xl font-bold tracking-wide uppercase">Purchase Bill</h1>
      </div>
      <div className="flex justify-between mb-6">
        <div>
          <p className="font-semibold text-base">{bill.org_name}</p>
          {bill.org_gstin && <p className="text-xs">GSTIN: {bill.org_gstin}</p>}
          {bill.org_address_line1 && <p className="text-xs mt-0.5">{bill.org_address_line1}</p>}
          {(bill.org_city || bill.org_pincode) && (
            <p className="text-xs">{[bill.org_city, bill.org_pincode].filter(Boolean).join(' - ')}</p>
          )}
        </div>
        <div className="text-right text-sm">
          <p><span className="font-medium">Bill No:</span> {bill.bill_no}</p>
          <p><span className="font-medium">Date:</span> {formatDate(bill.date)}</p>
        </div>
      </div>
      <div className="border border-black p-3 mb-6">
        <p className="text-xs font-semibold mb-1">Supplier</p>
        <p className="font-semibold">{bill.party_name}</p>
        {bill.party_gstin && <p className="text-xs">GSTIN: {bill.party_gstin}</p>}
      </div>
      <table className="w-full border-collapse mb-4 text-xs">
        <thead>
          <tr className="bg-gray-800 text-white">
            <th className="border border-gray-300 p-2 text-left">#</th>
            <th className="border border-gray-300 p-2 text-left">Item</th>
            <th className="border border-gray-300 p-2 text-right">Qty</th>
            <th className="border border-gray-300 p-2 text-right">Rate</th>
            <th className="border border-gray-300 p-2 text-right">GST %</th>
            <th className="border border-gray-300 p-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {bill.lines.map((l, i) => (
            <tr key={l.line_id}>
              <td className="border border-gray-300 p-2">{i + 1}</td>
              <td className="border border-gray-300 p-2">{l.item_name}</td>
              <td className="border border-gray-300 p-2 text-right">{Number(l.qty)}</td>
              <td className="border border-gray-300 p-2 text-right">{formatINR(l.rate, false)}</td>
              <td className="border border-gray-300 p-2 text-right">{l.gst_rate > 0 ? `${l.gst_rate}%` : '—'}</td>
              <td className="border border-gray-300 p-2 text-right">{formatINR(l.amount, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end mb-8">
        <div className="w-48 text-xs space-y-1">
          <div className="flex justify-between"><span>Sub Total</span><span>{formatINR(subtotal, false)}</span></div>
          {gstTotal > 0 && (
            isInter
              ? <div className="flex justify-between"><span>IGST</span><span>{formatINR(gstTotal, false)}</span></div>
              : <>
                  <div className="flex justify-between"><span>CGST</span><span>{formatINR(Math.round(gstTotal / 2), false)}</span></div>
                  <div className="flex justify-between"><span>SGST</span><span>{formatINR(Math.round(gstTotal / 2), false)}</span></div>
                </>
          )}
          <div className="flex justify-between font-bold border-t border-black pt-1">
            <span>Total</span><span>{formatINR(bill.total)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
