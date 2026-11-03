import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { Profile, Transition } from './lib/model'
import { errorText } from './lib/errors'

interface AuthContextValue {
  session: Session | null
  me: Profile | null
  // Все сотрудники — чтобы показывать имена автора, исполнителя и участников истории.
  people: Profile[]
  transitions: Transition[]
  loading: boolean
  error: string | null
  nameOf: (id: string | null | undefined) => string
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [people, setPeople] = useState<Profile[]>([])
  const [transitions, setTransitions] = useState<Transition[]>([])
  // Для какого пользователя уже загружены сотрудники и переходы.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  useEffect(() => {
    // Без входа данные не нужны. После выхода me = null, а старый список заменится при следующем входе.
    if (!userId) return
    let cancelled = false
    Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('status_transitions').select('*'),
    ]).then(([p, t]) => {
      if (cancelled) return
      if (p.error || t.error) setError(errorText(p.error ?? t.error))
      else setError(null)
      setPeople(p.data ?? [])
      setTransitions(t.data ?? [])
      setLoadedFor(userId)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const value = useMemo<AuthContextValue>(() => {
    const byId = new Map(people.map((p) => [p.id, p]))
    return {
      session,
      me: userId ? (byId.get(userId) ?? null) : null,
      people,
      transitions,
      loading: !sessionReady || (userId !== null && loadedFor !== userId),
      error,
      nameOf: (id) => (id ? (byId.get(id)?.full_name ?? 'Неизвестный сотрудник') : '—'),
    }
  }, [session, userId, people, transitions, sessionReady, loadedFor, error])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth вне AuthProvider')
  return ctx
}

// Для страниц внутри RequireAuth: пользователь точно вошёл и профиль загружен.
export function useMe(): Profile {
  const { me } = useAuth()
  if (!me) throw new Error('useMe без входа')
  return me
}
