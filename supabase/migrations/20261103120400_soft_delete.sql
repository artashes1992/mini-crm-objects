-- Мягкое удаление объектов и задач.
-- Раньше задача удалялась из базы вместе с историей, то есть постановщик мог стереть историю,
-- удалив задачу. Теперь удаление только скрывает строку: задача и её история остаются в базе,
-- но через API их больше не видно. Удалить строки по-настоящему клиент не может — права DELETE нет.

alter table public.objects
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id);

alter table public.tasks
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id);

-- Новых колонок нет в списках из grant insert/update, так что напрямую клиент их не изменит.
revoke delete on public.objects, public.tasks from authenticated;
drop policy "objects_delete" on public.objects;
drop policy "tasks_delete" on public.tasks;

-- Удалённое не видно никому и не меняется.
alter policy "objects_select" on public.objects
  using (
    deleted_at is null
    and (
      (select public.is_manager())
      or exists (
        select 1 from public.tasks t
        where t.object_id = objects.id and t.assignee_id = (select auth.uid()) and t.deleted_at is null
      )
    )
  );

alter policy "objects_update" on public.objects
  using ((select public.is_manager()) and deleted_at is null)
  with check ((select public.is_manager()));

alter policy "tasks_select" on public.tasks
  using (deleted_at is null and ((select public.is_manager()) or assignee_id = (select auth.uid())));

alter policy "tasks_update" on public.tasks
  using ((select public.is_manager()) and deleted_at is null)
  with check ((select public.is_manager()));

-- Задачу нельзя создать в удалённом объекте или перенести туда.
create function public.tasks_check_object()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.object_id is distinct from old.object_id then
    -- Условие «есть живой объект», а не «объект удалён»: удалённый объект скрыт от пользователя через RLS.
    if not exists (select 1 from public.objects o where o.id = new.object_id and o.deleted_at is null) then
      raise exception 'Объект не найден или удалён' using errcode = '23503';
    end if;
  end if;
  return new;
end
$$;

create trigger tasks_check_object
  before insert or update on public.tasks
  for each row execute function public.tasks_check_object();

-- Смена статуса удалённой задачи: такой задачи для пользователя больше нет.
create or replace function public.change_task_status(
  p_task_id uuid,
  p_to_status public.task_status,
  p_comment text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_task public.tasks;
  v_rule public.status_transitions;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is null then
    raise exception 'Нет доступа' using errcode = '42501';
  end if;

  select * into v_task from public.tasks t where t.id = p_task_id and t.deleted_at is null for update;
  -- Про чужую задачу исполнитель получает тот же ответ, что и про несуществующую.
  if not found or (v_role = 'executor' and v_task.assignee_id <> v_uid) then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;

  select * into v_rule
  from public.status_transitions st
  where st.from_status = v_task.status and st.to_status = p_to_status;

  if not found or v_rule.actor <> v_role then
    raise exception 'Переход «%» → «%» вам недоступен',
      public.status_label(v_task.status), public.status_label(p_to_status)
      using errcode = '42501';
  end if;

  if v_rule.comment_required and v_comment is null then
    raise exception 'Для этого действия нужен комментарий' using errcode = '23514';
  end if;

  perform set_config('app.status_change', 'on', true);
  update public.tasks set status = p_to_status where id = p_task_id returning * into v_task;
  perform set_config('app.status_change', '', true);

  insert into public.task_history (task_id, from_status, to_status, comment, changed_by)
  values (v_task.id, v_rule.from_status, p_to_status, v_comment, v_uid);

  return v_task;
end
$$;

-- Удаление задачи постановщиком. История остаётся.
create function public.delete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'Удалять задачи может только постановщик' using errcode = '42501';
  end if;
  update public.tasks set deleted_at = now(), deleted_by = auth.uid()
  where id = p_task_id and deleted_at is null;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;
end
$$;

-- Удаление объекта постановщиком: только когда в нём не осталось задач.
create function public.delete_object(p_object_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'Удалять объекты может только постановщик' using errcode = '42501';
  end if;
  perform 1 from public.objects o where o.id = p_object_id and o.deleted_at is null for update;
  if not found then
    raise exception 'Объект не найден' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.tasks t where t.object_id = p_object_id and t.deleted_at is null) then
    raise exception 'В объекте есть задачи: сначала удалите их или перенесите в другой объект'
      using errcode = '23503';
  end if;
  update public.objects set deleted_at = now(), deleted_by = auth.uid() where id = p_object_id;
end
$$;

revoke execute on function public.delete_task(uuid) from public, anon;
grant execute on function public.delete_task(uuid) to authenticated;
revoke execute on function public.delete_object(uuid) from public, anon;
grant execute on function public.delete_object(uuid) to authenticated;
revoke execute on function public.tasks_check_object() from public, anon, authenticated;
