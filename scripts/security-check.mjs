// Проверка прав доступа «снаружи»: только публичный ключ и логины тестовых пользователей,
// то есть ровно то, что есть у любого человека с открытым приложением.
// Каждая проверка пытается сделать то, что запрещено, и ждёт отказа от базы.
//
// Запуск: SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... TEST_PASSWORD=... node scripts/security-check.mjs

import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TEST_PASSWORD } = process.env
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !TEST_PASSWORD) {
  console.error('Нужны SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY и TEST_PASSWORD')
  process.exit(1)
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } }
const client = () => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, noSession)

async function signIn(email) {
  const c = client()
  const { data, error } = await c.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (error) throw error
  return { c, id: data.user.id }
}

let failed = 0
function report(ok, name, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
// Запрос должен вернуть ошибку.
async function denied(name, query) {
  const { error } = await query
  report(Boolean(error), name, error ? error.message : 'запрос прошёл, а не должен был')
}
// Запрос без ошибки, но ни одна строка не затронута (RLS отфильтровал).
async function noRows(name, query) {
  const { data, error } = await query
  report(!error && (data ?? []).length === 0, name, error ? error.message : `строк: ${(data ?? []).length}`)
}
function must({ data, error }) {
  if (error) throw error
  return data
}

// --- Без входа ---
const anon = client()
for (const table of ['profiles', 'objects', 'tasks', 'task_history', 'status_transitions']) {
  const { data, error } = await anon.from(table).select('*').limit(1)
  report(Boolean(error) || data.length === 0, `аноним не читает ${table}`, error?.message ?? `строк: ${data.length}`)
}
await denied('аноним не вызывает смену статуса',
  anon.rpc('change_task_status', { p_task_id: '00000000-0000-0000-0000-000000000000', p_to_status: 'accepted' }))
{
  const { error } = await anon.auth.signUp({ email: `intruder${Date.now()}@example.com`, password: 'Intruder-12345' })
  report(Boolean(error), 'самостоятельная регистрация закрыта', error?.message ?? 'регистрация прошла')
}

const manager = await signIn('manager@example.com')
const ivanov = await signIn('executor1@example.com')
const smirnov = await signIn('executor2@example.com')

const allTasks = must(await manager.c.from('tasks').select('id, title, status, assignee_id, object_id'))
const allObjects = must(await manager.c.from('objects').select('id, name'))
const ivanovTask = allTasks.find((t) => t.assignee_id === ivanov.id && t.status === 'new')
const smirnovTask = allTasks.find((t) => t.assignee_id === smirnov.id)
const acceptedTask = allTasks.find((t) => t.status === 'accepted')
const reviewTask = allTasks.find((t) => t.status === 'review')

// --- Исполнитель ---
{
  const mine = must(await ivanov.c.from('tasks').select('id, assignee_id, object_id'))
  report(mine.length > 0 && mine.every((t) => t.assignee_id === ivanov.id),
    'исполнитель видит только свои задачи', `${mine.length} из ${allTasks.length}`)

  const objs = must(await ivanov.c.from('objects').select('id'))
  const expected = new Set(mine.map((t) => t.object_id))
  report(objs.length === expected.size && objs.every((o) => expected.has(o.id)),
    'исполнитель видит только объекты со своими задачами', `${objs.length} из ${allObjects.length}`)

  const hist = must(await ivanov.c.from('task_history').select('task_id'))
  const mineIds = new Set(mine.map((t) => t.id))
  report(hist.length > 0 && hist.every((h) => mineIds.has(h.task_id)), 'исполнитель видит историю только своих задач')
}
await noRows('исполнитель не получает чужую задачу по id', ivanov.c.from('tasks').select('id').eq('id', smirnovTask.id))
await denied('исполнитель не меняет статус напрямую',
  ivanov.c.from('tasks').update({ status: 'accepted' }).eq('id', ivanovTask.id).select())
await noRows('исполнитель не меняет название задачи',
  ivanov.c.from('tasks').update({ title: 'Взлом' }).eq('id', ivanovTask.id).select())
await noRows('исполнитель не удаляет задачу', ivanov.c.from('tasks').delete().eq('id', ivanovTask.id).select())
await denied('исполнитель не создаёт задачу',
  ivanov.c.from('tasks').insert({ object_id: ivanovTask.object_id, title: 'Своя задача', assignee_id: ivanov.id }))
await denied('исполнитель не создаёт объект', ivanov.c.from('objects').insert({ name: 'Свой объект', address: 'Где-то' }))
await denied('исполнитель не двигает чужую задачу',
  ivanov.c.rpc('change_task_status', { p_task_id: smirnovTask.id, p_to_status: 'in_progress' }))
await denied('исполнитель не принимает свою задачу сам',
  ivanov.c.rpc('change_task_status', { p_task_id: ivanovTask.id, p_to_status: 'accepted' }))
await denied('исполнитель не перескакивает «Новая» → «На проверке»',
  ivanov.c.rpc('change_task_status', { p_task_id: ivanovTask.id, p_to_status: 'review' }))
await denied('исполнитель не пишет в историю',
  ivanov.c.from('task_history').insert({ task_id: ivanovTask.id, to_status: 'accepted', changed_by: ivanov.id }))
await denied('исполнитель не правит историю',
  ivanov.c.from('task_history').update({ comment: 'x' }).eq('task_id', ivanovTask.id).select())
await denied('исполнитель не удаляет историю', ivanov.c.from('task_history').delete().eq('task_id', ivanovTask.id).select())
await denied('исполнитель не меняет себе роль',
  ivanov.c.from('profiles').update({ role: 'manager' }).eq('id', ivanov.id).select())
{
  const { error } = await ivanov.c.auth.updateUser({ data: { role: 'manager' } })
  const me = must(await ivanov.c.from('profiles').select('role').eq('id', ivanov.id).single())
  report(me.role === 'executor', 'роль не меняется через свои метаданные', error?.message ?? 'метаданные изменены, роль осталась')
  await ivanov.c.auth.updateUser({ data: { role: null } })
}

// --- Постановщик ---
await denied('постановщик не меняет статус напрямую',
  manager.c.from('tasks').update({ status: 'accepted' }).eq('id', reviewTask.id).select())
await denied('постановщик не меняет автора задачи',
  manager.c.from('tasks').update({ author_id: ivanov.id }).eq('id', reviewTask.id).select())
await denied('постановщик не берёт задачу в работу за исполнителя',
  manager.c.rpc('change_task_status', { p_task_id: ivanovTask.id, p_to_status: 'in_progress' }))
await denied('возврат на доработку без комментария',
  manager.c.rpc('change_task_status', { p_task_id: reviewTask.id, p_to_status: 'rework' }))
await denied('возврат на доработку с пустым комментарием',
  manager.c.rpc('change_task_status', { p_task_id: reviewTask.id, p_to_status: 'rework', p_comment: '   ' }))
await denied('исполнителем нельзя назначить постановщика',
  manager.c.from('tasks').insert({ object_id: ivanovTask.object_id, title: 'Тест', assignee_id: manager.id }))
await denied('принятую задачу нельзя изменить',
  manager.c.from('tasks').update({ title: 'Изменено' }).eq('id', acceptedTask.id).select())
await denied('объект с задачами нельзя удалить', manager.c.from('objects').delete().eq('id', ivanovTask.object_id))
await denied('постановщик не пишет в историю',
  manager.c.from('task_history').insert({ task_id: reviewTask.id, to_status: 'accepted', changed_by: manager.id }))
await denied('постановщик не удаляет историю', manager.c.from('task_history').delete().eq('task_id', reviewTask.id).select())

// --- Полный цикл на временной задаче, затем удаление вместе с историей ---
{
  const temp = must(
    await manager.c
      .from('tasks')
      .insert({ object_id: ivanovTask.object_id, title: 'Проверка прав (временная)', assignee_id: ivanov.id })
      .select()
      .single(),
  )
  const steps = [
    [ivanov, 'in_progress'],
    [ivanov, 'review'],
    [manager, 'rework', 'Проверка: нужна доработка'],
    [ivanov, 'in_progress'],
    [ivanov, 'review'],
    [manager, 'accepted'],
  ]
  let ok = true
  for (const [who, to, comment] of steps) {
    const { error } = await who.c.rpc('change_task_status', { p_task_id: temp.id, p_to_status: to, p_comment: comment ?? null })
    if (error) {
      ok = false
      report(false, `разрешённый переход в «${to}»`, error.message)
    }
  }
  const hist = must(await ivanov.c.from('task_history').select('from_status, to_status, comment, changed_by').eq('task_id', temp.id))
  report(ok && hist.length === 7 && hist.find((h) => h.to_status === 'rework')?.comment === 'Проверка: нужна доработка',
    'полный цикл проходит, история пишется', `записей: ${hist.length}`)
  await denied('после «Принята» статус не меняется',
    manager.c.rpc('change_task_status', { p_task_id: temp.id, p_to_status: 'rework', p_comment: 'ещё раз' }))

  const { error: delError } = await manager.c.from('tasks').delete().eq('id', temp.id)
  const left = must(await manager.c.from('tasks').select('id').eq('id', temp.id))
  report(!delError && left.length === 0, 'постановщик удаляет задачу вместе с её историей', delError?.message)
}

console.log(failed ? `\nНе прошло проверок: ${failed}` : '\nВсе проверки пройдены')
process.exit(failed ? 1 : 0)
