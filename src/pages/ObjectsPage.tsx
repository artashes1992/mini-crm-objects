import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMe } from '../auth'
import { supabase } from '../lib/supabase'
import { errorText } from '../lib/errors'
import { must, useLoad } from '../lib/useLoad'
import { STATUS_ORDER, type TaskStatus } from '../lib/model'
import { StatusBadge } from '../components/StatusBadge'

export function ObjectsPage() {
  const me = useMe()
  // Вместе с объектами приходят статусы их задач. RLS сам отдаёт исполнителю
  // только его объекты и только его задачи в них.
  const { data, error, loading, reload } = useLoad(
    async () => must(await supabase.from('objects').select('id, name, address, tasks(status)').order('name')),
    [],
  )

  return (
    <>
      <h2>Объекты</h2>
      {me.role === 'executor' && <p className="muted">Показаны объекты, где у вас есть задачи.</p>}
      {error && <p className="error">{error}</p>}
      {loading && !data && <p aria-busy="true">Загрузка…</p>}
      {data && data.length === 0 && <p>Объектов пока нет.</p>}
      {data && data.length > 0 && (
        <div className="overflow-auto">
          <table className="striped">
            <thead>
              <tr>
                <th>Название</th>
                <th>Адрес</th>
                <th>{me.role === 'executor' ? 'Мои задачи' : 'Задачи'}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`/objects/${o.id}`}>{o.name}</Link>
                  </td>
                  <td>{o.address}</td>
                  <td>
                    <StatusSummary statuses={o.tasks.map((t) => t.status)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {me.role === 'manager' && <NewObjectForm onCreated={reload} />}
    </>
  )
}

function StatusSummary({ statuses }: { statuses: TaskStatus[] }) {
  if (statuses.length === 0) return <span className="muted">нет задач</span>
  return (
    <span className="badges">
      {STATUS_ORDER.filter((s) => statuses.includes(s)).map((s) => (
        <span key={s}>
          <StatusBadge status={s} /> {statuses.filter((x) => x === s).length}
        </span>
      ))}
    </span>
  )
}

function NewObjectForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('objects').insert({ name: name.trim(), address: address.trim() })
    setBusy(false)
    if (error) return setError(errorText(error))
    setName('')
    setAddress('')
    onCreated()
  }

  return (
    <details>
      <summary role="button" className="outline">
        + Новый объект
      </summary>
      <form onSubmit={submit}>
        <div className="grid">
          <label>
            Название
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Адрес
            <input required value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" aria-busy={busy} disabled={busy}>
          Создать объект
        </button>
      </form>
    </details>
  )
}
