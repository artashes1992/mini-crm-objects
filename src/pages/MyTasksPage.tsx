import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMe } from '../auth'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { formatDate, STATUS_LABEL, STATUS_ORDER, type TaskStatus } from '../lib/model'
import { StatusBadge } from '../components/StatusBadge'

export function MyTasksPage() {
  const me = useMe()
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all')

  // Фильтр по исполнителю здесь для удобства. Чужие задачи база не отдаст и без него.
  const { data, error, loading } = useLoad(
    async () =>
      must(
        await supabase
          .from('tasks')
          .select('*, objects(id, name)')
          .eq('assignee_id', me.id)
          .order('created_at', { ascending: false }),
      ),
    [me.id],
  )

  const tasks = (data ?? [])
    .filter((t) => filter === 'all' || t.status === filter)
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))

  return (
    <>
      <h2>Мои задачи</h2>
      <div className="filters" role="group">
        <button className={filter === 'all' ? '' : 'outline'} onClick={() => setFilter('all')}>
          Все {data ? `(${data.length})` : ''}
        </button>
        {STATUS_ORDER.map((s) => (
          <button key={s} className={filter === s ? '' : 'outline'} onClick={() => setFilter(s)}>
            {STATUS_LABEL[s]} ({(data ?? []).filter((t) => t.status === s).length})
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {loading && !data && <p aria-busy="true">Загрузка…</p>}
      {data && tasks.length === 0 && <p className="muted">Задач нет.</p>}
      {tasks.length > 0 && (
        <div className="overflow-auto">
          <table className="striped">
            <thead>
              <tr>
                <th>Задача</th>
                <th>Статус</th>
                <th>Объект</th>
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
                  <td>{t.objects ? <Link to={`/objects/${t.objects.id}`}>{t.objects.name}</Link> : '—'}</td>
                  <td>{formatDate(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
