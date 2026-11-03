import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth, useMe } from '../auth'
import { supabase } from '../lib/supabase'
import { errorText } from '../lib/errors'
import { must, useLoad } from '../lib/useLoad'
import {
  actionLabel,
  availableTransitions,
  formatDate,
  STATUS_LABEL,
  type HistoryEntry,
  type Task,
  type Transition,
} from '../lib/model'
import { StatusBadge } from '../components/StatusBadge'
import { TaskForm } from '../components/TaskForm'
import { NotFound } from './ObjectPage'

export function TaskPage() {
  const { id = '' } = useParams()
  const me = useMe()
  const { nameOf } = useAuth()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const { data, error, loading, reload } = useLoad(async () => {
    const [task, history] = await Promise.all([
      supabase.from('tasks').select('*, objects(id, name, address)').eq('id', id).maybeSingle(),
      supabase.from('task_history').select('*').eq('task_id', id).order('changed_at').order('id'),
    ])
    return { task: must(task), history: must(history) }
  }, [id])

  // Объекты для переноса задачи — только постановщику и только в режиме правки.
  const { data: objects } = useLoad(
    async () => (editing ? must(await supabase.from('objects').select('id, name').order('name')) : []),
    [editing],
  )

  if (loading && !data) return <p aria-busy="true">Загрузка…</p>
  if (error) return <p className="error">{error}</p>
  if (!data?.task) return <NotFound />

  const { task, history } = data
  const object = task.objects

  async function remove() {
    // Удаление мягкое: задача пропадёт из списков, а история останется в базе.
    if (!confirm(`Удалить задачу «${task.title}»?`)) return
    const { error } = await supabase.rpc('delete_task', { p_task_id: task.id })
    if (error) return setDeleteError(errorText(error))
    navigate(`/objects/${task.object_id}`)
  }

  return (
    <>
      <p>
        <Link to={`/objects/${task.object_id}`}>← {object?.name ?? 'Объект'}</Link>
      </p>

      {editing ? (
        <article>
          <TaskForm
            initial={{
              title: task.title,
              description: task.description,
              assignee_id: task.assignee_id,
              object_id: task.object_id,
            }}
            objects={objects ?? [{ id: task.object_id, name: object?.name ?? '' }]}
            submitLabel="Сохранить"
            onCancel={() => setEditing(false)}
            onSubmit={async (v) => {
              const { error } = await supabase.from('tasks').update(v).eq('id', task.id)
              if (error) return errorText(error)
              setEditing(false)
              reload()
              return null
            }}
          />
        </article>
      ) : (
        <article>
          <header>
            <hgroup>
              <h2>{task.title}</h2>
              <p>
                <StatusBadge status={task.status} />
              </p>
            </hgroup>
          </header>
          {task.description ? <p className="pre">{task.description}</p> : <p className="muted">Без описания</p>}
          <dl className="fields">
            <dt>Объект</dt>
            <dd>
              {object ? (
                <>
                  <Link to={`/objects/${object.id}`}>{object.name}</Link>, {object.address}
                </>
              ) : (
                '—'
              )}
            </dd>
            <dt>Исполнитель</dt>
            <dd>{nameOf(task.assignee_id)}</dd>
            <dt>Автор</dt>
            <dd>{nameOf(task.author_id)}</dd>
            <dt>Создана</dt>
            <dd>{formatDate(task.created_at)}</dd>
          </dl>
          {me.role === 'manager' && (
            <footer className="actions">
              {task.status === 'accepted' ? (
                <span className="muted">Принятую задачу изменить нельзя.</span>
              ) : (
                <button className="outline small" onClick={() => setEditing(true)}>
                  Редактировать
                </button>
              )}
              <button className="outline secondary small" onClick={remove}>
                Удалить задачу
              </button>
            </footer>
          )}
          {deleteError && <p className="error">{deleteError}</p>}
        </article>
      )}

      <Actions task={task} onChanged={reload} />

      <h3>История</h3>
      <History history={history} nameOf={nameOf} />
    </>
  )
}

function Actions({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const me = useMe()
  const { transitions } = useAuth()
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const actions = availableTransitions(transitions, task, me)
  if (actions.length === 0) {
    const text = waitingText(task, me.role)
    return text ? <p className="muted">{text}</p> : null
  }
  const needsComment = actions.some((a) => a.comment_required)

  async function run(t: Transition) {
    if (t.comment_required && !comment.trim()) {
      return setError(`Для действия «${actionLabel(t)}» напишите комментарий`)
    }
    setBusy(t.to_status)
    setError(null)
    const { error } = await supabase.rpc('change_task_status', {
      p_task_id: task.id,
      p_to_status: t.to_status,
      p_comment: comment.trim() || undefined,
    })
    setBusy(null)
    if (error) return setError(errorText(error))
    setComment('')
    onChanged()
  }

  return (
    <article>
      <h4>Действия</h4>
      <label>
        Комментарий {needsComment ? '(обязателен при возврате на доработку)' : '(необязательно)'}
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {actions.map((t) => (
          <button
            key={t.to_status}
            className={t.to_status === 'rework' ? 'secondary' : undefined}
            aria-busy={busy === t.to_status}
            disabled={busy !== null}
            onClick={() => run(t)}
          >
            {actionLabel(t)}
          </button>
        ))}
      </div>
    </article>
  )
}

function waitingText(task: Task, role: 'manager' | 'executor'): string {
  // Постановщику о принятой задаче уже сказано в карточке.
  if (task.status === 'accepted') return role === 'executor' ? 'Задача принята.' : ''
  if (role === 'executor') return 'Задача на проверке у постановщика.'
  return task.status === 'review' ? '' : 'Ждём действий исполнителя.'
}

function History({ history, nameOf }: { history: HistoryEntry[]; nameOf: (id: string) => string }) {
  if (history.length === 0) return <p className="muted">История пуста.</p>
  return (
    <div className="overflow-auto">
      <table>
        <thead>
          <tr>
            <th>Когда</th>
            <th>Кто</th>
            <th>Изменение</th>
            <th>Комментарий</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id}>
              <td>{formatDate(h.changed_at)}</td>
              <td>{nameOf(h.changed_by)}</td>
              <td>
                {h.from_status ? STATUS_LABEL[h.from_status] : '—'} → {STATUS_LABEL[h.to_status]}
              </td>
              <td className="pre">{h.comment ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
