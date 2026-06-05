import type { PurchaseOrderDetail } from '@/hooks/queries'
import { formatINR, formatDate } from '@/lib/money'

export function PurchaseOrderPrint({ po }: { po: PurchaseOrderDetail }) {
  const total = po.lines.reduce((s, l) => s + l.amount, 0)

  return (
    <div className="p-8 text-sm text-black font-sans">
      <div className="text-center mb-6">
        <h1 className="text-xl font-bold tracking-wide uppercase">Purchase Order</h1>
      </div>
      <div className="flex justify-between mb-6">
        <div>
          <p className="font-semibold text-base">{po.org_name}</p>
          {po.org_gstin && <p className="text-xs mt-0.5">GSTIN: {po.org_gstin}</p>}
          {po.org_address_line1 && <p className="text-xs mt-0.5">{po.org_address_line1}</p>}
          {po.org_address_line2 && <p className="text-xs">{po.org_address_line2}</p>}
          {(po.org_city || po.org_pincode) && (
            <p className="text-xs">{[po.org_city, po.org_pincode].filter(Boolean).join(' - ')}</p>
          )}
          {po.org_phone && <p className="text-xs mt-0.5">Ph: {po.org_phone}</p>}
          {po.org_email && <p className="text-xs">E: {po.org_email}</p>}
        </div>
        <div className="text-right text-sm">
          <p><span className="font-medium">PO#:</span> {po.po_no}</p>
          <p><span className="font-medium">Date:</span> {formatDate(po.date)}</p>
          {po.delivery_date && <p><span className="font-medium">Delivery Date:</span> {formatDate(po.delivery_date)}</p>}
        </div>
      </div>
      <div className="border border-black p-3 mb-6">
        <p className="text-xs font-semibold mb-1">Vendor Address</p>
        <p className="font-semibold">{po.party_name}</p>
        {po.party_gstin && <p className="text-xs">GSTIN: {po.party_gstin}</p>}
      </div>
      <table className="w-full border-collapse mb-4 text-xs">
        <thead>
          <tr className="bg-gray-800 text-white">
            <th className="border border-gray-300 p-2 text-left">#</th>
            <th className="border border-gray-300 p-2 text-left">Item &amp; Description</th>
            <th className="border border-gray-300 p-2 text-right">Qty</th>
            <th className="border border-gray-300 p-2 text-right">Rate</th>
            <th className="border border-gray-300 p-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {po.lines.map((l, i) => (
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
          <div className="flex justify-between"><span>Sub Total</span><span>{formatINR(total, false)}</span></div>
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
