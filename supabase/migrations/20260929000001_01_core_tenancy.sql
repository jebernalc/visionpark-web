-- VISIONPARK 2.0 · Núcleo: extensiones, tenencia (organización / sede / rol) y helpers de seguridad
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create type public.app_role as enum ('operador','valet','revisor','supervisor','auditor','perito','admin');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  timezone text not null default 'America/Bogota',
  retention_days_no_claim int not null default 30 check (retention_days_no_claim > 0),
  created_at timestamptz not null default now()
);
create index sites_org_idx on public.sites(org_id);

-- site_id null = acceso a todas las sedes de la organización
create table public.user_sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (user_id, org_id, site_id, role)
);
create index user_sites_user_idx on public.user_sites(user_id);
create index user_sites_org_idx on public.user_sites(org_id);
create index user_sites_site_idx on public.user_sites(site_id);

-- Helpers (schema privado, no expuesto por la API). Las políticas RLS los usan.
create function private.in_org(p_org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.user_sites us
                 where us.user_id = (select auth.uid()) and us.org_id = p_org);
$$;

create function private.can_access(p_org uuid, p_site uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.user_sites us
                 where us.user_id = (select auth.uid())
                   and us.org_id = p_org
                   and (us.site_id is null or us.site_id = p_site));
$$;

create function private.has_role(p_org uuid, p_site uuid, p_roles public.app_role[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.user_sites us
                 where us.user_id = (select auth.uid())
                   and us.org_id = p_org
                   and (us.site_id is null or us.site_id = p_site)
                   and us.role = any (p_roles));
$$;

create function private.safe_uuid(p text)
returns uuid language plpgsql immutable set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create function private.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- Primer uso: un usuario sin membresías crea su organización y queda como administrador
create function public.bootstrap_org(p_name text, p_site_name text default 'Sede principal')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_site uuid; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Autenticación requerida'; end if;
  if exists (select 1 from public.user_sites where user_id = v_uid) then
    raise exception 'El usuario ya pertenece a una organización';
  end if;
  insert into public.organizations(name) values (p_name) returning id into v_org;
  insert into public.sites(org_id, name) values (v_org, p_site_name) returning id into v_site;
  insert into public.user_sites(user_id, org_id, site_id, role) values (v_uid, v_org, null, 'admin');
  return v_org;
end;
$$;
revoke execute on function public.bootstrap_org(text, text) from public, anon;
grant execute on function public.bootstrap_org(text, text) to authenticated;

alter table public.organizations enable row level security;
alter table public.sites enable row level security;
alter table public.user_sites enable row level security;

create policy organizations_select on public.organizations for select to authenticated
  using ((select private.in_org(id)));
create policy sites_select on public.sites for select to authenticated
  using ((select private.can_access(org_id, id)));
create policy sites_admin_write on public.sites for all to authenticated
  using ((select private.has_role(org_id, id, array['admin']::public.app_role[])))
  with check ((select private.has_role(org_id, id, array['admin']::public.app_role[])));
create policy user_sites_select on public.user_sites for select to authenticated
  using (user_id = (select auth.uid())
         or (select private.has_role(org_id, site_id, array['admin']::public.app_role[])));
create policy user_sites_admin_write on public.user_sites for all to authenticated
  using ((select private.has_role(org_id, site_id, array['admin']::public.app_role[])))
  with check ((select private.has_role(org_id, site_id, array['admin']::public.app_role[])));
