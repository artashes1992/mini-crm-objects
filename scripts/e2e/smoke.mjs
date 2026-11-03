// Сквозная проверка интерфейса в headless Chrome: вход под тремя пользователями,
// временная задача проходит весь цикл статусов и удаляется. Скриншоты — в scripts/e2e/shots.
//
// Запуск: TEST_PASSWORD=... [APP_URL=http://localhost:5173] [CHROME_PATH=...] node scripts/e2e/smoke.mjs
import { launch, helpers } from './cdp.mjs'

const BASE = process.env.APP_URL ?? 'https://mini-crm-objects.vercel.app'
const PW = process.env.TEST_PASSWORD
if (!PW) throw new Error('Нужен TEST_PASSWORD')

const b = await launch()
const { send, evaluate, goto, waitText, shot, sleep } = b
await send('Page.addScriptToEvaluateOnNewDocument', { source: helpers })
const ok = (m) => console.log('OK  ', m)

async function login(email) {
  await goto(BASE + '/login')
  await evaluate('localStorage.clear(); true')
  await goto(BASE + '/login')
  await waitText('Регистрации нет')
  await evaluate(`__set(document.querySelector('input[type=email]'), ${JSON.stringify(email)});
    __set(document.querySelector('input[type=password]'), ${JSON.stringify(PW)});
    document.querySelector('form').requestSubmit(); true`)
  await waitText('Выйти')
  await sleep(800)
}
const path = () => evaluate('location.pathname')

try {
  await goto(BASE + '/login')
  await evaluate('localStorage.clear(); true')
  await goto(BASE + '/objects')
  await waitText('Регистрации нет')
  if ((await path()) !== '/login') throw new Error('без входа нет редиректа на /login')
  await shot('01-login')
  ok('без входа → /login')

  await login('manager@example.com')
  await waitText('Ирина Соколова')
  if ((await path()) !== '/objects') throw new Error('постановщик попал не на /objects: ' + (await path()))
  await shot('02-objects-manager')
  ok('постановщик: список объектов')

  await evaluate(`document.querySelector('table a').click(); true`)
  await waitText('Новая задача')
  const objectPath = await path()
  await shot('03-object-manager')
  ok('карточка объекта ' + objectPath)

  await evaluate(`__click('Новая задача'); true`)
  await sleep(300)
  await evaluate(`const f = document.querySelector('details form');
    __set(f.querySelector('input'), 'Проверка интерфейса (временная)');
    __set(f.querySelector('textarea'), 'Создана автотестом, будет удалена.');
    const s = f.querySelector('select'); __set(s, [...s.options].find(o => o.text.includes('Пётр')).value);
    f.requestSubmit(); true`)
  await waitText('История')
  const taskPath = await path()
  if (!taskPath.startsWith('/tasks/')) throw new Error('после создания не открылась задача')
  await waitText('Ждём действий исполнителя')
  await shot('04-task-created')
  ok('постановщик создал задачу ' + taskPath + ', кнопок смены статуса нет')

  await login('executor1@example.com')
  if ((await path()) !== '/my') throw new Error('исполнитель попал не на /my: ' + (await path()))
  await waitText('Проверка интерфейса (временная)')
  await shot('05-my-tasks')
  ok('исполнитель: «Мои задачи», новая задача видна')

  await goto(BASE + taskPath)
  await waitText('Взять в работу')
  await shot('06-task-executor-new')
  await evaluate(`__click('Взять в работу'); true`)
  await waitText('Отправить на проверку')
  await evaluate(`__click('Отправить на проверку'); true`)
  await waitText('Задача на проверке у постановщика')
  ok('исполнитель: Новая → В работе → На проверке')

  await goto(BASE + '/objects')
  await waitText('Мои задачи')
  await shot('07-objects-executor')
  const rows = await evaluate(`document.querySelectorAll('tbody tr').length`)
  ok(`исполнитель видит объектов: ${rows}`)

  await login('executor2@example.com')
  await goto(BASE + taskPath)
  await waitText('Не найдено')
  await shot('08-foreign-task')
  ok('другой исполнитель: чужая задача → «Не найдено»')

  await login('manager@example.com')
  await goto(BASE + taskPath)
  await waitText('Вернуть на доработку')
  await evaluate(`__click('Вернуть на доработку'); true`)
  await waitText('напишите комментарий')
  await shot('09-rework-needs-comment')
  ok('доработка без комментария не отправляется')
  await evaluate(`__set(document.querySelector('article textarea'), 'Добавьте фото до и после.');
    __click('Вернуть на доработку'); true`)
  await waitText('Добавьте фото до и после.')
  await waitText('Ждём действий исполнителя')
  ok('постановщик: На проверке → На доработке с комментарием')

  await login('executor1@example.com')
  await goto(BASE + taskPath)
  await waitText('Снова в работу')
  await evaluate(`__click('Снова в работу'); true`)
  await waitText('Отправить на проверку')
  await evaluate(`__set(document.querySelector('article textarea'), 'Фото добавил.'); __click('Отправить на проверку'); true`)
  await waitText('Задача на проверке у постановщика')
  ok('исполнитель: На доработке → В работе → На проверке')

  await login('manager@example.com')
  await goto(BASE + taskPath)
  await waitText('Принять')
  await evaluate(`__click('Принять'); true`)
  await waitText('Принятую задачу изменить нельзя')
  await shot('10-accepted-history')
  const history = await evaluate(`document.querySelectorAll('table tbody tr').length`)
  if (history !== 7) throw new Error('в истории не 7 записей: ' + history)
  ok('постановщик принял задачу, в истории 7 записей')

  await evaluate(`__click('Удалить задачу'); true`)
  await sleep(2000)
  if ((await path()) !== objectPath) throw new Error('после удаления не вернулись на объект')
  ok('временная задача удалена')
  await goto(BASE + taskPath)
  await waitText('Не найдено')
  ok('удалённая задача больше не открывается')

  await goto(BASE + objectPath)
  await waitText('Удалить объект')
  await evaluate(`__click('Удалить объект'); true`)
  await waitText('В объекте есть задачи')
  await shot('11-object-with-tasks')
  ok('объект с задачами не удаляется, понятная ошибка')

  await goto(BASE + '/objects')
  await waitText('Ирина Соколова')
  await evaluate(`__click('Выйти'); true`)
  await waitText('Регистрации нет')
  ok('выход → /login')
} catch (e) {
  console.log('FAIL', e.message)
  await shot('99-fail')
  console.log('URL', await path(), '\n', (await b.text()).slice(0, 600))
} finally {
  if (b.logs.length) console.log('CONSOLE:\n' + b.logs.join('\n'))
  await b.close()
}
