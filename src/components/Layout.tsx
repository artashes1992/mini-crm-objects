import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL } from '../lib/model'

export function RequireAuth() {
  const { session, me, loading, error } = useAuth()
  const location = useLocation()

  if (loading) return <main className="container" aria-busy="true">Загрузка…</main>
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!me) {
    return (
      <main className="container">
        <article>
          <p>{error ?? 'Профиль сотрудника не найден. Обратитесь к администратору.'}</p>
          <button onClick={() => supabase.auth.signOut()}>Выйти</button>
        </article>
      </main>
    )
  }

  return (
    <>
      <header className="container">
        <nav>
          <ul>
            <li>
              <Link to="/" className="brand">
                <strong>Объекты и задачи</strong>
              </Link>
            </li>
            <li>
              <NavLink to="/objects">Объекты</NavLink>
            </li>
            {me.role === 'executor' && (
              <li>
                <NavLink to="/my">Мои задачи</NavLink>
              </li>
            )}
          </ul>
          <ul>
            <li>
              <span>
                {me.full_name} <small className="muted">· {ROLE_LABEL[me.role]}</small>
              </span>
            </li>
            <li>
              <button className="outline secondary small" onClick={() => supabase.auth.signOut()}>
                Выйти
              </button>
            </li>
          </ul>
        </nav>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </>
  )
}

export function Home() {
  const { me } = useAuth()
  return <Navigate to={me?.role === 'executor' ? '/my' : '/objects'} replace />
}
