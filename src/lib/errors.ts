// Понятный текст ошибки для пользователя.
// Сообщения из наших функций базы уже на русском — их показываем как есть.
export function errorText(error: unknown): string {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)

  if (/[а-яё]/i.test(message)) return message
  if (message.includes('Invalid login credentials')) return 'Неверный email или пароль'
  if (message.includes('tasks_object_id_fkey')) return 'Нельзя удалить объект, пока в нём есть задачи'
  if (message.includes('row-level security') || message.includes('permission denied')) {
    return 'Недостаточно прав для этого действия'
  }
  if (message.includes('violates check constraint')) return 'Заполните обязательные поля'
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'Нет связи с сервером, попробуйте ещё раз'
  }
  return `Ошибка: ${message}`
}
