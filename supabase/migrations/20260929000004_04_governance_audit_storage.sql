-- VISIONPARK 2.0 · Gobierno: auditoría encadenada, retención y almacenamiento privado de evidencia
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid,
  site_id uuid,
  actor uuid,
  action text not null,
  table_name text,
  row_id text,
  detail jsonb,
  prev_hash text,
  hash text not null,
  created_at timestamptz not null default now()
);
create index audit_org_site_idx on public.audit_log(org_id, site_id, id desc);

-- Cada registro incluye el hash del anterior: alterar uno rompe toda la cadena posterior
create function private.audit_chain()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_prev text;
begin
  perform pg_advisory_xact_lock(hashtextextended('visionpark_audit_log', 0));
  select a.hash into v_prev from public.audit_log a order by a.id desc limit 1;
  new.prev_hash := v_prev;
  new.created_at := clock_timestamp();
  new.hash := encode(extensions.digest(
      coalesce(v_prev, '') || '|' || new.action || '|' || coalesce(new.table_name, '') || '|' ||
      coalesce(new.row_id, '') || '|' || coalesce(new.actor::text, '') || '|' ||
      coalesce(new.detail::text, '') || '|' || new.created_at::text, 'sha256'), 'hex');
  return new;
end;
$$;
create trigger audit_log_chain before insert on public.audit_log
  for each row execute function private.audit_chain();

create function private.audit_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'El registro de auditoría es de solo inserción';
end;
$$;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function private.audit_immutable();

-- Registro automático de cambios sensibles
create function private.log_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  insert into public.audit_log(org_id, site_id, actor, action, table_name, row_id, detail)
  values (r.org_id, r.site_id, (select auth.uid()), tg_op, tg_table_name, r.id::text,
          jsonb_build_object('row', to_jsonb(r)));
  return null;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['claims','evidence_files','findings','finding_reviews','reports','report_versions','ai_queries'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.log_change()', t || '_audit', t);
  end loop;
end $$;

alter table public.audit_log enable row level security;
create policy audit_select on public.audit_log for select to authenticated
  using ((select private.has_role(org_id, site_id, array['auditor','supervisor','admin']::public.app_role[])));

-- Retención por tipo de caso (ejecución con doble aprobación)
create table public.retention_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  case_type text not null check (case_type in ('sin_reclamacion','con_reclamacion')),
  days int not null check (days > 0),
  requires_double_approval boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, case_type)
);
alter table public.retention_policies enable row level security;
create policy retention_select on public.retention_policies for select to authenticated
  using ((select private.in_org(org_id)));
create policy retention_admin_write on public.retention_policies for all to authenticated
  using ((select private.has_role(org_id, null, array['admin']::public.app_role[])))
  with check ((select private.has_role(org_id, null, array['admin']::public.app_role[])));

-- Almacenamiento privado: organización/sede/sesión/archivo. Sin UPDATE ni DELETE para usuarios.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 26214400,
        array['image/jpeg','image/png','image/webp','video/mp4','application/pdf'])
on conflict (id) do nothing;

create policy evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and (select private.can_access(
      private.safe_uuid((storage.foldername(name))[1]),
      private.safe_uuid((storage.foldername(name))[2]))));
create policy evidence_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (select private.has_role(
      private.safe_uuid((storage.foldername(name))[1]),
      private.safe_uuid((storage.foldername(name))[2]),
      array['operador','valet','revisor','supervisor','admin']::public.app_role[])));
