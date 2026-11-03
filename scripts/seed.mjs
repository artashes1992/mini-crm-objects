// Тестовые пользователи и данные.
// Пользователей создаёт администратор (секретный ключ, только локально).
// Объекты, задачи и смены статусов идут через обычный API от имени самих пользователей,
// поэтому история в базе настоящая и проходит все проверки.
//
// Запуск: SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... SUPABASE_SECRET_KEY=... TEST_PASSWORD=... node scripts/seed.mjs

import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, TEST_PASSWORD } = process.env
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY || !TEST_PASSWORD) {
  console.error('Нужны SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY и TEST_PASSWORD')
  process.exit(1)
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, noSession)

const users = [
  { key: 'manager', email: 'manager@example.com', full_name: 'Ирина Соколова', role: 'manager' },
  { key: 'ivanov', email: 'executor1@example.com', full_name: 'Пётр Иванов', role: 'executor' },
  { key: 'smirnov', email: 'executor2@example.com', full_name: 'Алексей Смирнов', role: 'executor' },
]

async function ensureUsers() {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error
  const ids = {}
  for (const u of users) {
    const existing = data.users.find((x) => x.email === u.email)
    if (existing) {
      ids[u.key] = existing.id
      continue
    }
    const { data: created, error: e } = await admin.auth.admin.createUser({
      email: u.email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.full_name },
      app_metadata: { role: u.role },
    })
    if (e) throw e
    ids[u.key] = created.user.id
    console.log('создан пользователь', u.email)
  }
  return ids
}

async function signIn(email) {
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, noSession)
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (error) throw error
  return client
}

function must({ data, error }) {
  if (error) throw error
  return data
}

const ids = await ensureUsers()
const manager = await signIn('manager@example.com')
const executors = { ivanov: await signIn('executor1@example.com'), smirnov: await signIn('executor2@example.com') }

const existing = must(await manager.from('objects').select('id'))
if (existing.length > 0) {
  console.log('Данные уже есть, пропускаю')
  process.exit(0)
}

const objects = must(
  await manager
    .from('objects')
    .insert([
      { name: 'ЖК «Северный парк», корпус 2', address: 'г. Москва, ул. Лесная, 12' },
      { name: 'Склад «Логистик-Юг»', address: 'Московская обл., г. Подольск, Индустриальная ул., 5' },
      { name: 'Частный дом в Истре', address: 'Московская обл., Истринский р-н, д. Лешково, уч. 48' },
    ])
    .select(),
)
const [park, sklad, dom] = objects

// path — цепочка переходов после создания: [статус, кто, комментарий]
const tasks = [
  {
    object: park, who: 'ivanov', title: 'Залить фундамент секции Б',
    description: 'Бетон М300, после заливки — фото и акт скрытых работ.',
    path: [['in_progress', 'ivanov'], ['review', 'ivanov', 'Залили, акт приложен в общей папке'], ['accepted', 'manager']],
  },
  {
    object: park, who: 'ivanov', title: 'Опалубка 3-го этажа',
    description: 'Смонтировать опалубку перекрытия 3-го этажа по проекту КЖ-3.',
    path: [
      ['in_progress', 'ivanov'],
      ['review', 'ivanov'],
      ['rework', 'manager', 'Не хватает стоек у лестничной клетки, проверьте по КЖ-3, лист 4'],
      ['in_progress', 'ivanov'],
    ],
  },
  {
    object: park, who: 'smirnov', title: 'Принять поставку арматуры',
    description: 'Проверить количество и сертификаты, расписаться в накладной.',
    path: [],
  },
  {
    object: sklad, who: 'smirnov', title: 'Демонтаж старой кровли',
    description: 'Снять профлист над пролётами 1–3, мусор — в контейнер у ворот.',
    path: [['in_progress', 'smirnov']],
  },
  {
    object: sklad, who: 'smirnov', title: 'Установка секционных ворот',
    description: 'Ворота 4×4 м, проём №2. Проверить автоматику после монтажа.',
    path: [['in_progress', 'smirnov'], ['review', 'smirnov', 'Ворота стоят, автоматика работает']],
  },
  {
    object: dom, who: 'ivanov', title: 'Разметка участка под фундамент',
    description: 'Вынести оси по плану, забить колышки, сдать геодезисту.',
    path: [
      ['in_progress', 'ivanov'],
      ['review', 'ivanov'],
      ['rework', 'manager', 'Ось А смещена на 20 см относительно плана, переделайте'],
    ],
  },
  {
    object: dom, who: 'ivanov', title: 'Согласовать смету по электрике',
    description: 'Сверить смету с проектом ЭОМ и прислать замечания.',
    path: [],
  },
]

const actors = { manager, ...executors }
for (const t of tasks) {
  const task = must(
    await manager
      .from('tasks')
      .insert({ object_id: t.object.id, title: t.title, description: t.description, assignee_id: ids[t.who] })
      .select()
      .single(),
  )
  for (const [to, who, comment] of t.path) {
    must(await actors[who].rpc('change_task_status', { p_task_id: task.id, p_to_status: to, p_comment: comment ?? null }))
  }
  console.log('задача:', t.title)
}

console.log('Готово')
