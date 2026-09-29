-- VISIONPARK 2.0 · Gestión de equipo: el administrador agrega miembros por correo (sin exponer auth.users)
create function public.list_members()
returns table (id uuid, user_id uuid, email text, site_id uuid, site_name text, role public.app_role, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select us.id, us.user_id, u.email::text, us.site_id, s.name, us.role, us.created_at
    from public.user_sites us
    join auth.users u on u.id = us.user_id
    left join public.sites s on s.id = us.site_id
   where private.has_role(us.org_id, null, array['admin']::public.app_role[])
   order by u.email, us.created_at;
$$;

create function public.add_member(p_email text, p_role public.app_role, p_site uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_user uuid; v_id uuid;
begin
  select us.org_id into v_org from public.user_sites us
   where us.user_id = (select auth.uid()) and us.site_id is null and us.role = 'admin' limit 1;
  if v_org is null then raise exception 'Solo el administrador de la organización puede agregar miembros'; end if;
  if p_site is not null and not exists (select 1 from public.sites where id = p_site and org_id = v_org) then
    raise exception 'La sede no pertenece a tu organización';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then raise exception 'Ese correo aún no está registrado. Pídele que abra la pestaña «Soy del equipo» y cree su cuenta.'; end if;
  if exists (select 1 from public.user_sites x where x.user_id = v_user and x.org_id <> v_org) then
    raise exception 'Ese usuario ya pertenece a otra organización';
  end if;
  insert into public.user_sites(user_id, org_id, site_id, role) values (v_user, v_org, p_site, p_role)
    on conflict do nothing returning id into v_id;
  insert into public.audit_log(org_id, site_id, actor, action, table_name, row_id, detail)
    values (v_org, p_site, (select auth.uid()), 'ADD_MEMBER', 'user_sites', v_id::text,
            jsonb_build_object('email', lower(trim(p_email)), 'role', p_role));
  return v_id;
end;
$$;

create function public.remove_member(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.user_sites; v_admins int;
begin
  select * into r from public.user_sites where id = p_id;
  if r.id is null then raise exception 'Membresía no encontrada'; end if;
  if not private.has_role(r.org_id, null, array['admin']::public.app_role[]) then
    raise exception 'Solo el administrador puede quitar miembros';
  end if;
  if r.role = 'admin' then
    select count(*) into v_admins from public.user_sites where org_id = r.org_id and role = 'admin';
    if v_admins <= 1 then raise exception 'No se puede quitar al último administrador'; end if;
  end if;
  delete from public.user_sites where id = p_id;
  insert into public.audit_log(org_id, site_id, actor, action, table_name, row_id, detail)
    values (r.org_id, r.site_id, (select auth.uid()), 'REMOVE_MEMBER', 'user_sites', p_id::text,
            jsonb_build_object('user_id', r.user_id, 'role', r.role));
end;
$$;

revoke execute on function public.list_members() from public, anon;
revoke execute on function public.add_member(text, public.app_role, uuid) from public, anon;
revoke execute on function public.remove_member(uuid) from public, anon;
grant execute on function public.list_members() to authenticated;
grant execute on function public.add_member(text, public.app_role, uuid) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
