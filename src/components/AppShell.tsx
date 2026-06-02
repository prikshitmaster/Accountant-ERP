import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, ShoppingCart, Wallet, Users, Package,
  BarChart3, Settings, Menu, X, BookOpen, Boxes, Factory,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/cn'

type Item = { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }
const groups: { heading?: string; items: Item[] }[] = [
  { items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    heading: 'Transactions',
    items: [
      { to: '/sales', label: 'Sales', icon: TrendingUp },
      { to: '/purchases', label: 'Purchases', icon: ShoppingCart },
      { to: '/money', label: 'Money', icon: Wallet },
    ],
  },
  {
    heading: 'Masters',
    items: [
      { to: '/parties', label: 'Parties', icon: Users },
      { to: '/items', label: 'Items', icon: Package },
      { to: '/stock', label: 'Stock', icon: Boxes },
      { to: '/manufacture', label: 'Manufacture', icon: Factory },
    ],
  },
  {
    heading: 'Reports',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3 },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

const bottomNav: Item[] = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/sales', label: 'Sales', icon: TrendingUp },
  { to: '/purchases', label: 'Buy', icon: ShoppingCart },
  { to: '/money', label: 'Money', icon: Wallet },
]

export function AppShell() {
  const { memberships, currentOrgId, setCurrentOrgId, role, signOut } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const current = memberships.find((m) => m.org_id === currentOrgId)

  return (
    <div className="min-h-screen bg-paper">
      {/* ---------- Desktop sidebar ---------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-sidebar md:flex">
        <div className="flex items-center gap-2 px-5 py-5 text-ink">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-600 text-white">
            <BookOpen size={18} />
          </span>
          <span className="text-lg font-bold tracking-tight">Bahi</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((g, i) => (
            <div key={i} className="mb-1">
              {g.heading && (
                <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-sidebar-dim">
                  {g.heading}
                </p>
              )}
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition',
                      isActive
                        ? 'bg-sidebar-soft font-semibold text-brand-700'
                        : 'text-sidebar-ink hover:bg-canvas',
                    )
                  }
                >
                  <Icon size={18} className="shrink-0" />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* ---------- Main ---------- */}
      <div className="md:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur md:px-8">
          <div className="min-w-0">
            {memberships.length > 1 ? (
              <select
                className="max-w-[55vw] truncate bg-transparent text-base font-semibold outline-none"
                value={currentOrgId ?? ''}
                onChange={(e) => setCurrentOrgId(e.target.value)}
              >
                {memberships.map((m) => (
                  <option key={m.org_id} value={m.org_id}>{m.organizations.name}</option>
                ))}
              </select>
            ) : (
              <h1 className="truncate text-base font-semibold">{current?.organizations.name}</h1>
            )}
            <p className="text-xs capitalize text-muted">{role}</p>
          </div>
          <button onClick={signOut} className="text-sm text-muted hover:text-ink">Sign out</button>
        </header>

        <main className="px-4 py-5 pb-24 md:px-8 md:py-7 md:pb-10">
          <div className="mx-auto max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ---------- Mobile bottom nav ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-line bg-surface md:hidden">
        {bottomNav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn('flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px]',
                isActive ? 'text-brand-600' : 'text-muted')
            }
          >
            <Icon size={21} />
            {label}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] text-muted"
        >
          <Menu size={21} />
          More
        </button>
      </nav>

      {/* Mobile "More" sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold">More</p>
              <button onClick={() => setMoreOpen(false)}><X size={20} className="text-muted" /></button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { to: '/parties', label: 'Parties', icon: Users },
                { to: '/items', label: 'Items', icon: Package },
                { to: '/stock', label: 'Stock', icon: Boxes },
                { to: '/manufacture', label: 'Manufacture', icon: Factory },
                { to: '/reports', label: 'Reports', icon: BarChart3 },
                { to: '/settings', label: 'Settings', icon: Settings },
              ].map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMoreOpen(false)}
                  className="flex flex-col items-center gap-2 rounded-xl border border-line p-3 text-xs"
                >
                  <Icon size={22} className="text-brand-600" />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
