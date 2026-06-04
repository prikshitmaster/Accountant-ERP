import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { AuthPage } from '@/features/auth/AuthPage'
import { CreateOrg } from '@/features/onboarding/CreateOrg'
import { AppShell } from '@/components/AppShell'
import { Dashboard } from '@/features/dashboard/Dashboard'
import { SalesPage } from '@/features/sales/SalesPage'
import { SaleDetailPage } from '@/features/sales/SaleDetailPage'
import { PurchasesPage } from '@/features/purchases/PurchasesPage'
import { PurchaseDetailPage } from '@/features/purchases/PurchaseDetailPage'
import { PartiesPage } from '@/features/masters/PartiesPage'
import { ItemsPage } from '@/features/masters/ItemsPage'
import { StockPage } from '@/features/stock/StockPage'
import { ManufacturePage } from '@/features/stock/ManufacturePage'
import { MoneyPage } from '@/features/money/MoneyPage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'

export default function App() {
  const { session, loading, memberships, currentOrgId } = useAuth()

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-muted">Loading…</div>
  }

  if (!session) return <AuthPage />

  // Signed in but no organisation yet → onboarding.
  if (memberships.length === 0 || !currentOrgId) return <CreateOrg />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/sales/:id" element={<SaleDetailPage />} />
        <Route path="/purchases" element={<PurchasesPage />} />
        <Route path="/purchases/:id" element={<PurchaseDetailPage />} />
        <Route path="/parties" element={<PartiesPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/manufacture" element={<ManufacturePage />} />
        <Route path="/money" element={<MoneyPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
