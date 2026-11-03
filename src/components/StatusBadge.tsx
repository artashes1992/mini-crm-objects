import { STATUS_LABEL, type TaskStatus } from '../lib/model'

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>
}
