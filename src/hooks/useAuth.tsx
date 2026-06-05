import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type Membership = {
  org_id: string
  role: 'owner' | 'accountant' | 'staff'
  organizations: { id: string; name: string; fy_start_month: number }
}

type AuthState = {
  session: Session | null
  loading: boolean
  memberships: Membership[]
  currentOrgId: string | null
  setCurrentOrgId: (id: string) => void
  role: Membership['role'] | null
  refreshMemberships: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(
    () => localStorage.getItem('currentOrgId'),
  )

  const setCurrentOrgId = (id: string) => {
    localStorage.setItem('currentOrgId', id)
    setCurrentOrgIdState(id)
  }

  async function refreshMemberships() {
    const { data, error } = await supabase
      .from('memberships')
      .select('org_id, role, organizations(id, name, fy_start_month)')
    if (error) {
      console.error(error)
      return
    }
    const rows = (data ?? []) as unknown as Membership[]
    setMemberships(rows)
    if (rows.length && !rows.find((m) => m.org_id === currentOrgId)) {
      setCurrentOrgId(rows[0].org_id)
    }
  }

  useEffect(() => {
    async function init() {
      const { data } = await supabase.auth.getSession()
      const s = data.session
      setSession(s)
      if (s) await refreshMemberships()
      setLoading(false)
    }
    init()

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s) refreshMemberships()
      else setMemberships([])
    })
    return () => sub.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const role = memberships.find((m) => m.org_id === currentOrgId)?.role ?? null

  const signOut = async () => {
    await supabase.auth.signOut()
    localStorage.removeItem('currentOrgId')
    setCurrentOrgIdState(null)
  }

  return (
    <Ctx.Provider
      value={{ session, loading, memberships, currentOrgId, setCurrentOrgId, role, refreshMemberships, signOut }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used within AuthProvider')
  return v
}
