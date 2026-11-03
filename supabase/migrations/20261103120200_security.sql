-- Права доступа. Сначала забираем у клиентских ролей всё, что Supabase выдаёт по умолчанию,
-- потом выдаём только нужное. Поверх прав работает RLS: какие строки видит и меняет пользователь.

alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_history enable row level security;
alter table public.status_transitions enable row level security;

revoke all on public.profiles, public.objects, public.tasks, public.task_history, public.status_transitions
  from anon, authenticated;

-- Справочники: только чтение.
grant select on public.profiles, public.status_transitions to authenticated;

-- Объекты: менять можно только название и адрес.
grant select, delete on public.objects to authenticated;
grant insert (name, address), update (name, address) on public.objects to authenticated;

-- Задачи: статус, автора и даты клиент не задаёт и не меняет — их нет в списке колонок.
grant select, delete on public.tasks to authenticated;
grant insert (object_id, title, description, assignee_id),
      update (object_id, title, description, assignee_id)
  on public.tasks to authenticated;

-- История: только чтение. Пишут её только функции базы.
grant select on public.task_history to authenticated;

-- profiles: сотрудники видят имена и роли друг друга — чтобы показать автора, исполнителя и историю.
-- Политик на запись нет: свою роль через API не поменять.
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

create policy "status_transitions_select" on public.status_transitions
  for select to authenticated using (true);

-- objects: постановщик видит все, исполнитель — только те, где у него есть задачи.
create policy "objects_select" on public.objects
  for select to authenticated
  using (
    (select public.is_manager())
    or exists (
      select 1 from public.tasks t
      where t.object_id = objects.id and t.assignee_id = (select auth.uid())
    )
  );

create policy "objects_insert" on public.objects
  for insert to authenticated with check ((select public.is_manager()));

create policy "objects_update" on public.objects
  for update to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));

create policy "objects_delete" on public.objects
  for delete to authenticated using ((select public.is_manager()));

-- tasks: постановщик видит и меняет все, исполнитель только видит свои.
create policy "tasks_select" on public.tasks
  for select to authenticated
  using ((select public.is_manager()) or assignee_id = (select auth.uid()));

create policy "tasks_insert" on public.tasks
  for insert to authenticated with check ((select public.is_manager()));

create policy "tasks_update" on public.tasks
  for update to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));

create policy "tasks_delete" on public.tasks
  for delete to authenticated using ((select public.is_manager()));

-- task_history: видна тому, кто видит саму задачу (подзапрос к tasks идёт через её RLS).
create policy "task_history_select" on public.task_history
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_history.task_id));
