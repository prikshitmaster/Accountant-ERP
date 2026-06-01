import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anonKey) {
  // Surfaced early so misconfiguration is obvious in dev.
  console.warn('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local')
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: { persistSession: true, autoRefreshToken: true },
})
