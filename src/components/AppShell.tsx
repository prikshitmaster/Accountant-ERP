import { NavLink, Outlet } from 'react-router-dom'
import { Home, Wallet, BarChart3, Settings } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/cn'

const nav = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/money', label: 'Money', icon: Wallet, end: false },
  { to: '/reports', label: 'Reports', icon: BarChart3, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
]

export function AppShell() {
  const { memberships, currentOrgId, setCurrentOrgId, signOut } = useAuth()
  const current = memberships.find((m) => m.org_id === currentOrgId)

  return (
    <div className="mx-auto flex min-h-screen max-w-screen-sm flex-col bg-canvas">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-4 py-3">
        <div className="min-w-0">
          {memberships.length > 1 ? (
            <select
              className="max-w-[60vw] truncate bg-transparent text-base font-semibold outline-none"
              value={currentOrgId ?? ''}
              onChange={(e) => setCurrentOrgId(e.target.value)}
            >
              {memberships.map((m) => (
                <option key={m.org_id} value={m.org_id}>
                  {m.organizations.name}
                </option>
              ))}
            </select>
          ) : (
            <h1 className="truncate text-base font-semibold">{current?.organizations.name}</h1>
          )}
          <p className="text-xs capitalize text-muted">{current?.role}</p>
        </div>
        <button onClick={signOut} className="text-sm text-muted hover:text-ink">
          Sign out
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-4 pb-24">
        <Outlet />
      </main>

      {/* Bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-screen-sm items-stretch border-t border-line bg-white">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-xs',
                isActive ? 'text-brand-600' : 'text-muted',
              )
            }
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
