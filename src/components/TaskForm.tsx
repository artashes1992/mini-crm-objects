import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import type { CrmObject } from '../lib/model'

export interface TaskValues {
  title: string
  description: string
  assignee_id: string
  object_id: string
}

interface Props {
  initial: TaskValues
  // Список объектов — только при редактировании: задачу можно перенести на другой объект.
  objects?: Pick<CrmObject, 'id' | 'name'>[]
  submitLabel: string
  onSubmit: (values: TaskValues) => Promise<string | null>
  onCancel?: () => void
}

export function TaskForm({ initial, objects, submitLabel, onSubmit, onCancel }: Props) {
  const { people } = useAuth()
  const executors = people.filter((p) => p.role === 'executor')
  const [values, setValues] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (field: keyof TaskValues) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await onSubmit({ ...values, title: values.title.trim(), description: values.description.trim() })
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <form onSubmit={submit}>
      <label>
        Название
        <input required value={values.title} onChange={set('title')} />
      </label>
      <label>
        Описание
        <textarea rows={3} value={values.description} onChange={set('description')} />
      </label>
      <div className="grid">
        <label>
          Исполнитель
          <select required value={values.assignee_id} onChange={set('assignee_id')}>
            <option value="" disabled>
              Выберите исполнителя
            </option>
            {executors.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </label>
        {objects && (
          <label>
            Объект
            <select required value={values.object_id} onChange={set('object_id')}>
              {objects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" aria-busy={busy} disabled={busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary outline" onClick={onCancel}>
            Отмена
          </button>
        )}
      </div>
    </form>
  )
}
