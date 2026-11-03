-- Supabase Auth сначала создаёт пользователя, а app_metadata (с ролью) записывает
-- следующим UPDATE в той же транзакции. Поэтому роль синхронизируем и при изменении app_metadata.
-- Так же работает смена роли: администратор меняет app_metadata.role — меняется профиль.
create function public.sync_user_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
  set role = coalesce((new.raw_app_meta_data ->> 'role')::public.app_role, 'executor')
  where p.id = new.id;
  return null;
end
$$;

create trigger on_auth_user_app_metadata_changed
  after update of raw_app_meta_data on auth.users
  for each row
  when (old.raw_app_meta_data ->> 'role' is distinct from new.raw_app_meta_data ->> 'role')
  execute function public.sync_user_role();

revoke execute on function public.sync_user_role() from public, anon, authenticated;

-- Пользователи, созданные до этой миграции.
update public.profiles p
set role = coalesce((u.raw_app_meta_data ->> 'role')::public.app_role, 'executor')
from auth.users u
where u.id = p.id;
