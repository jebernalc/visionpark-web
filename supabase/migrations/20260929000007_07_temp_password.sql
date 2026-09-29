-- VISIONPARK 2.0 · Contraseña temporal con cambio obligatorio
-- La marca vive en raw_app_meta_data (el usuario no puede editarla desde el navegador)
-- y se borra sola cuando el usuario cambia de verdad su contraseña.
create function private.clear_temp_flag()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     and coalesce(current_setting('vp.temp_set', true), '') <> '1' then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) - 'must_change_password';
  end if;
  return new;
end;
$$;
create trigger vp_clear_temp_flag before update of encrypted_password on auth.users
  for each row execute function private.clear_temp_flag();

-- El administrador restablece la contraseña de un miembro de su organización.
-- Devuelve la clave temporal una sola vez; nunca se guarda en claro.
create function public.admin_reset_member_password(p_user uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_pw text;
begin
  select us.org_id into v_org from public.user_sites us
   where us.user_id = p_user
     and private.has_role(us.org_id, null, array['admin']::public.app_role[])
   limit 1;
  if v_org is null then raise exception 'Solo el administrador puede restablecer la contraseña de su equipo'; end if;
  v_pw := 'Vp-' || translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', 'xyz') || '-7';
  perform set_config('vp.temp_set', '1', true);
  update auth.users
     set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')),
         raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"must_change_password": true}'::jsonb,
         updated_at = now()
   where id = p_user;
  delete from auth.sessions where user_id = p_user;
  insert into public.audit_log(org_id, site_id, actor, action, table_name, row_id, detail)
    values (v_org, null, (select auth.uid()), 'RESET_PASSWORD', 'auth.users', p_user::text,
            jsonb_build_object('temporal', true));
  return v_pw;
end;
$$;
revoke execute on function public.admin_reset_member_password(uuid) from public, anon;
grant execute on function public.admin_reset_member_password(uuid) to authenticated;
