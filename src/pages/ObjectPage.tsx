import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth, useMe } from '../auth'
import { supabase } from '../lib/supabase'
import { errorText } from '../lib/errors'
import { must, useLoad } from '../lib/useLoad'
import { formatDate, STATUS_ORDER, type CrmObject } from '../lib/model'
import { StatusBadge } from '../components/StatusBadge'
import { TaskForm } from '../components/TaskForm'

// Объект вместе с задачами. Исполнителю база отдаст только его задачи.
// Ответ сохраняем в переменную: внутри must(await …) TypeScript выводит тип maybeSingle() как null.
async function loadObject(id: string) {
  const result = await supabase.from('objects').select('*, tasks(*)').eq('id', id).maybeSingle()
  return must(result)
}

export function ObjectPage() {
  const { id = '' } = useParams()
  const me = useMe()
  const { nameOf } = useAuth()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const { data: object, error, loading, reload } = useLoad(() => loadObject(id), [id])

  if (loading && !object) return <p aria-busy="true">Загрузка…</p>
  if (error) return <p className="error">{error}</p>
  if (!object) return <NotFound />

  const tasks = [...object.tasks].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.created_at.localeCompare(a.created_at),
  )

  async function remove() {
    if (!object || !confirm(`Удалить объект «${object.name}»?`)) return
    const { error } = await supabase.rpc('delete_object', { p_object_id: id })
    if (error) return setDeleteError(errorText(error))
    navigate('/objects')
  }

  return (
    <>
      <p>
        <Link to="/objects">← Все объекты</Link>
      </p>
      {editing ? (
        <ObjectEditForm
          object={object}
          onDone={() => {
            setEditing(false)
            reload()
          }}
        />
      ) : (
        <hgroup>
          <h2>{object.name}</h2>
          <p>{object.address}</p>
        </hgroup>
      )}
      {me.role === 'manager' && !editing && (
        <div className="actions">
          <button className="outline small" onClick={() => setEditing(true)}>
            Редактировать
          </button>
          <button className="outline secondary small" onClick={remove}>
            Удалить объект
          </button>
        </div>
      )}
      {deleteError && <p className="error">{deleteError}</p>}

      <h3>{me.role === 'executor' ? 'Мои задачи на объекте' : 'Задачи'}</h3>
      {tasks.length === 0 ? (
        <p className="muted">Задач пока нет.</p>
      ) : (
        <div className="overflow-auto">
          <table className="striped">
            <thead>
              <tr>
                <th>Задача</th>
                <th>Статус</th>
                <th>Исполнитель</th>
                <th>Создана</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                  </td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td>{nameOf(t.assignee_id)}</td>
                  <td>{formatDate(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {me.role === 'manager' && (
        <details>
          <summary role="button" className="outline">
            + Новая задача
          </summary>
          <TaskForm
            initial={{ title: '', description: '', assignee_id: '', object_id: id }}
            submitLabel="Создать задачу"
            onSubmit={async (v) => {
              const { data, error } = await supabase.from('tasks').insert(v).select('id').single()
              if (error) return errorText(error)
              navigate(`/tasks/${data.id}`)
              return null
            }}
          />
        </details>
      )}
    </>
  )
}

function ObjectEditForm({ object, onDone }: { object: CrmObject; onDone: () => void }) {
  const [name, setName] = useState(object.name)
  const [address, setAddress] = useState(object.address)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase
      .from('objects')
      .update({ name: name.trim(), address: address.trim() })
      .eq('id', object.id)
    setBusy(false)
    if (error) return setError(errorText(error))
    onDone()
  }

  return (
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
      <div className="actions">
        <button type="submit" aria-busy={busy} disabled={busy}>
          Сохранить
        </button>
        <button type="button" className="secondary outline" onClick={onDone}>
          Отмена
        </button>
      </div>
    </form>
  )
}

export function NotFound() {
  return (
    <article>
      <p>Не найдено или у вас нет доступа.</p>
      <Link to="/">На главную</Link>
    </article>
  )
}
