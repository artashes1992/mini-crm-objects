import type { Database } from './database.types'

type PublicSchema = Database['public']

export type Role = PublicSchema['Enums']['app_role']
export type TaskStatus = PublicSchema['Enums']['task_status']
export type Profile = PublicSchema['Tables']['profiles']['Row']
export type CrmObject = PublicSchema['Tables']['objects']['Row']
export type Task = PublicSchema['Tables']['tasks']['Row']
export type HistoryEntry = PublicSchema['Tables']['task_history']['Row']
export type Transition = PublicSchema['Tables']['status_transitions']['Row']

export const ROLE_LABEL: Record<Role, string> = {
  manager: 'Постановщик',
  executor: 'Исполнитель',
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  review: 'На проверке',
  accepted: 'Принята',
  rework: 'На доработке',
}

// Порядок в списках: сначала то, что требует действий.
export const STATUS_ORDER: TaskStatus[] = ['rework', 'new', 'in_progress', 'review', 'accepted']

export function actionLabel(t: Transition): string {
  switch (t.to_status) {
    case 'in_progress':
      return t.from_status === 'rework' ? 'Снова в работу' : 'Взять в работу'
    case 'review':
      return 'Отправить на проверку'
    case 'accepted':
      return 'Принять'
    case 'rework':
      return 'Вернуть на доработку'
    default:
      return STATUS_LABEL[t.to_status]
  }
}

// Какие переходы показать пользователю. Это только подсказка интерфейсу:
// ту же проверку база делает сама в change_task_status().
export function availableTransitions(
  all: Transition[],
  task: Task,
  me: Profile,
): Transition[] {
  return all.filter(
    (t) =>
      t.from_status === task.status &&
      t.actor === me.role &&
      (me.role === 'manager' || task.assignee_id === me.id),
  )
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}
