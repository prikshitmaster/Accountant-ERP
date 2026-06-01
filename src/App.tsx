import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { AuthPage } from '@/features/auth/AuthPage'
import { CreateOrg } from '@/features/onboarding/CreateOrg'
import { AppShell } from '@/components/AppShell'
import { Dashboard } from '@/features/dashboard/Dashboard'
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
        <Route path="/money" element={<MoneyPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
