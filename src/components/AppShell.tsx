import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, ShoppingCart, Wallet, Users, Package,
  BarChart3, Settings, Menu, X, BookOpen, Boxes, Factory, ClipboardList,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/cn'

// ── Nav tree ──────────────────────────────────────────────────────────────────
type SubItem = { to: string; label: string }
type NavItem =
  | { kind: 'link';  to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }
  | { kind: 'group'; label: string; icon: typeof LayoutDashboard; children: SubItem[] }

const navItems: NavItem[] = [
  { kind: 'link',  to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  {
    kind: 'group', label: 'Sales', icon: TrendingUp,
    children: [
      { to: '/parties?kind=customer', label: 'Customers' },
      { to: '/sales-orders',          label: 'Sales Orders' },
      { to: '/sales',                 label: 'Invoices' },
      { to: '/payments-received',     label: 'Payments Received' },
    ],
  },
  {
    kind: 'group', label: 'Purchases', icon: ShoppingCart,
    children: [
      { to: '/parties?kind=supplier', label: 'Suppliers' },
      { to: '/purchase-orders',       label: 'Purchase Orders' },
      { to: '/purchases',             label: 'Bills' },
      { to: '/payments-made',         label: 'Payments Made' },
    ],
  },
  {
    kind: 'group', label: 'Inventory', icon: Package,
    children: [
      { to: '/items',       label: 'Items' },
      { to: '/stock',       label: 'Stock' },
      { to: '/manufacture', label: 'Manufacture' },
    ],
  },
  { kind: 'link', to: '/money',   label: 'Money',    icon: Wallet },
  { kind: 'link', to: '/reports', label: 'Reports',  icon: BarChart3 },
  { kind: 'link', to: '/settings',label: 'Settings', icon: Settings },
]

// ── Sidebar content ───────────────────────────────────────────────────────────
function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const loc = useLocation()

  // pathname-only comparison (strip query params from child `to` before matching)
  const toPath = (to: string) => to.split('?')[0]
  const activeGroups = navItems
    .filter((n): n is Extract<NavItem, { kind: 'group' }> => n.kind === 'group')
    .filter((g) => g.children.some((c) => loc.pathname.startsWith(toPath(c.to)) && toPath(c.to) !== '/'))
    .map((g) => g.label)

  const [open, setOpen] = useState<Set<string>>(new Set(activeGroups))

  const toggle = (label: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })

  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3">
      {navItems.map((item) => {
        if (item.kind === 'link') {
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'text-sidebar-ink hover:bg-canvas',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={17} className={cn('shrink-0', isActive ? 'text-white' : 'text-sidebar-dim')} />
                  {item.label}
                </>
              )}
            </NavLink>
          )
        }

        // group
        const isExpanded = open.has(item.label)
        const isGroupActive = item.children.some((c) => loc.pathname.startsWith(toPath(c.to)) && toPath(c.to) !== '/')

        return (
          <div key={item.label} className="mb-0.5">
            <button
              type="button"
              onClick={() => toggle(item.label)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isGroupActive && !isExpanded
                  ? 'text-brand-600'
                  : 'text-sidebar-ink hover:bg-canvas',
              )}
            >
              <item.icon
                size={17}
                className={cn('shrink-0', isGroupActive ? 'text-brand-600' : 'text-sidebar-dim')}
              />
              <span className="flex-1 text-left">{item.label}</span>
              {isExpanded
                ? <ChevronDown size={14} className="text-sidebar-dim" />
                : <ChevronRight size={14} className="text-sidebar-dim" />
              }
            </button>

            {isExpanded && (
              <div className="ml-8 mt-0.5 border-l border-line pl-3">
                {item.children.map((child) => {
                  const isActive = loc.pathname.startsWith(toPath(child.to)) && toPath(child.to) !== '/'
                  return (
                    <NavLink
                      key={child.to + child.label}
                      to={child.to}
                      onClick={onNavigate}
                      className={cn(
                        'block rounded-md px-2 py-1.5 text-sm transition-colors',
                        isActive
                          ? 'font-semibold text-brand-600'
                          : 'text-muted hover:text-ink',
                      )}
                    >
                      {child.label}
                    </NavLink>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

// ── AppShell ──────────────────────────────────────────────────────────────────
export function AppShell() {
  const { memberships, currentOrgId, setCurrentOrgId, role, signOut } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const current = memberships.find((m) => m.org_id === currentOrgId)

  return (
    <div className="min-h-screen bg-paper">

      {/* ── Desktop sidebar ── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-line bg-sidebar shadow-xs md:flex">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
            <BookOpen size={16} />
          </span>
          <span className="text-base font-bold tracking-tight text-ink">Bahi</span>
        </div>

        <SideNav />

        {/* Org / user footer */}
        <div className="border-t border-line px-4 py-3">
          {memberships.length > 1 ? (
            <select
              className="w-full truncate bg-transparent text-xs font-medium text-ink outline-none"
              value={currentOrgId ?? ''}
              onChange={(e) => setCurrentOrgId(e.target.value)}
            >
              {memberships.map((m) => (
                <option key={m.org_id} value={m.org_id}>{m.organizations.name}</option>
              ))}
            </select>
          ) : (
            <p className="truncate text-xs font-medium text-ink">{current?.organizations.name}</p>
          )}
          <p className="mt-0.5 text-[11px] capitalize text-muted">{role}</p>
        </div>
      </aside>

      {/* ── Mobile slide-over sidebar ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside
            className="absolute inset-y-0 left-0 flex w-64 flex-col bg-sidebar shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
                  <BookOpen size={16} />
                </span>
                <span className="text-base font-bold tracking-tight text-ink">Bahi</span>
              </div>
              <button onClick={() => setMobileOpen(false)} className="text-muted hover:text-ink">
                <X size={20} />
              </button>
            </div>
            <SideNav onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* ── Main area ── */}
      <div className="md:pl-56">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur md:px-6">
          {/* Hamburger (mobile) */}
          <button
            onClick={() => setMobileOpen(true)}
            className="text-muted hover:text-ink md:hidden"
          >
            <Menu size={22} />
          </button>

          <div className="min-w-0 flex-1">
            {memberships.length > 1 ? (
              <select
                className="max-w-[55vw] truncate bg-transparent text-sm font-semibold outline-none md:hidden"
                value={currentOrgId ?? ''}
                onChange={(e) => setCurrentOrgId(e.target.value)}
              >
                {memberships.map((m) => (
                  <option key={m.org_id} value={m.org_id}>{m.organizations.name}</option>
                ))}
              </select>
            ) : (
              <h1 className="truncate text-sm font-semibold md:hidden">{current?.organizations.name}</h1>
            )}
          </div>

          <button onClick={signOut} className="ml-auto text-sm text-muted hover:text-ink">
            Sign out
          </button>
        </header>

        <main className="px-4 py-5 pb-10 md:px-8 md:py-7">
          <div className="mx-auto max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
