-- VISIONPARK 2.0 · Operación: vehículos, sesiones, reclamaciones, evidencia inmutable y las 24 vistas canónicas
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plate text not null,
  brand text, model text, color text,
  created_at timestamptz not null default now(),
  unique (org_id, plate)
);

create table public.cameras (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null,
  location text,
  kind text not null check (kind in ('movil','fija','cctv','visiongate')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index cameras_org_site_idx on public.cameras(org_id, site_id);

create table public.parking_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  plate text not null,
  modality text not null check (modality in ('autoservicio','valet')),
  status text not null default 'abierta' check (status in ('abierta','cerrada')),
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  operator_id uuid references auth.users(id) on delete set null,
  coverage_in numeric check (coverage_in between 0 and 1),
  coverage_out numeric check (coverage_out between 0 and 1),
  created_at timestamptz not null default now()
);
create index sessions_org_site_idx on public.parking_sessions(org_id, site_id, entered_at desc);
create index sessions_plate_idx on public.parking_sessions(org_id, plate);
create index sessions_vehicle_idx on public.parking_sessions(vehicle_id);
create index sessions_operator_idx on public.parking_sessions(operator_id);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  session_id uuid not null references public.parking_sessions(id) on delete restrict,
  claimant_name text,
  description text,
  status text not null default 'abierta' check (status in ('abierta','en_revision','cerrada')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null
);
create index claims_org_site_idx on public.claims(org_id, site_id, opened_at desc);
create index claims_session_idx on public.claims(session_id);
create index claims_created_by_idx on public.claims(created_by);

create table public.claim_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  claim_id uuid not null references public.claims(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  actor uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index claim_events_claim_idx on public.claim_events(claim_id, created_at);
create index claim_events_org_site_idx on public.claim_events(org_id, site_id);
create index claim_events_actor_idx on public.claim_events(actor);

-- Evidencia: el original nunca se modifica ni se borra desde la aplicación
create table public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  session_id uuid references public.parking_sessions(id) on delete restrict,
  claim_id uuid references public.claims(id) on delete restrict,
  kind text not null check (kind in ('foto','video','documento')),
  phase text not null check (phase in ('ingreso','salida','reclamacion')),
  storage_path text not null unique,
  mime text,
  bytes bigint check (bytes >= 0),
  sha256_client text not null check (sha256_client ~ '^[0-9a-f]{64}$'),
  sha256_server text check (sha256_server ~ '^[0-9a-f]{64}$'),
  tsa_token text,
  tsa_at timestamptz,
  captured_at timestamptz not null default now(),
  device text,
  captured_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (session_id is not null or claim_id is not null)
);
create index evidence_org_site_idx on public.evidence_files(org_id, site_id);
create index evidence_session_idx on public.evidence_files(session_id, phase);
create index evidence_claim_idx on public.evidence_files(claim_id);
create index evidence_captured_by_idx on public.evidence_files(captured_by);

create function private.evidence_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'La evidencia es inmutable: no se puede borrar desde la aplicación';
  end if;
  if (to_jsonb(new) - array['sha256_server','tsa_token','tsa_at'])
     is distinct from (to_jsonb(old) - array['sha256_server','tsa_token','tsa_at']) then
    raise exception 'La evidencia es inmutable: solo se completan el hash del servidor y el sello de tiempo';
  end if;
  return new;
end;
$$;
create trigger evidence_files_immutable before update or delete on public.evidence_files
  for each row execute function private.evidence_immutable();

-- Las 24 vistas canónicas del Pasaporte Visual 360°
create table public.canonical_views (
  code text primary key,
  name text not null,
  group_name text not null,
  sort_order int not null unique
);
insert into public.canonical_views(code, name, group_name, sort_order) values
 ('V01','Frontal','Perímetro',1),
 ('V02','Esquina delantera izquierda','Perímetro',2),
 ('V03','Lateral izquierdo','Perímetro',3),
 ('V04','Esquina trasera izquierda','Perímetro',4),
 ('V05','Posterior','Perímetro',5),
 ('V06','Esquina trasera derecha','Perímetro',6),
 ('V07','Lateral derecho','Perímetro',7),
 ('V08','Esquina delantera derecha','Perímetro',8),
 ('V09','Rin delantero derecho','Ruedas',9),
 ('V10','Rin trasero derecho','Ruedas',10),
 ('V11','Rin trasero izquierdo','Ruedas',11),
 ('V12','Rin delantero izquierdo','Ruedas',12),
 ('V13','Detalle esquina delantera izquierda','Esquinas',13),
 ('V14','Detalle esquina delantera derecha','Esquinas',14),
 ('V15','Detalle esquina trasera derecha','Esquinas',15),
 ('V16','Detalle esquina trasera izquierda','Esquinas',16),
 ('V17','Parabrisas','Cristales y techo',17),
 ('V18','Luneta posterior','Cristales y techo',18),
 ('V19','Techo','Cristales y techo',19),
 ('V20','Espejo izquierdo','Espejos',20),
 ('V21','Espejo derecho','Espejos',21),
 ('V22','Placa frontal','Placas',22),
 ('V23','Placa posterior','Placas',23),
 ('V24','Tablero y odómetro','Interior',24);

create table public.capture_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  session_id uuid not null references public.parking_sessions(id) on delete cascade,
  phase text not null check (phase in ('ingreso','salida')),
  view_code text references public.canonical_views(code),
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  quality numeric check (quality between 0 and 1),
  usable boolean,
  created_at timestamptz not null default now()
);
create index capture_views_session_idx on public.capture_views(session_id, phase, view_code);
create index capture_views_org_site_idx on public.capture_views(org_id, site_id);
create index capture_views_view_idx on public.capture_views(view_code);
create index capture_views_evidence_idx on public.capture_views(evidence_id);

create table public.image_derivatives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  evidence_id uuid not null references public.evidence_files(id) on delete cascade,
  kind text not null check (kind in ('miniatura','mosaico','ajuste')),
  params jsonb not null default '{}'::jsonb,
  storage_path text not null,
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index derivatives_evidence_idx on public.image_derivatives(evidence_id);
create index derivatives_org_site_idx on public.image_derivatives(org_id, site_id);
create index derivatives_created_by_idx on public.image_derivatives(created_by);

alter table public.vehicles enable row level security;
alter table public.cameras enable row level security;
alter table public.parking_sessions enable row level security;
alter table public.claims enable row level security;
alter table public.claim_events enable row level security;
alter table public.evidence_files enable row level security;
alter table public.canonical_views enable row level security;
alter table public.capture_views enable row level security;
alter table public.image_derivatives enable row level security;

create policy canonical_views_read on public.canonical_views for select to authenticated using (true);
create policy vehicles_select on public.vehicles for select to authenticated
  using ((select private.in_org(org_id)));
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check ((select private.in_org(org_id)));
create policy vehicles_update on public.vehicles for update to authenticated
  using ((select private.in_org(org_id))) with check ((select private.in_org(org_id)));

-- Lectura por sede + escritura por rol operativo (sin políticas de DELETE: nada se borra desde la app)
do $$
declare t text;
begin
  foreach t in array array['cameras','parking_sessions','claims','claim_events','evidence_files','capture_views','image_derivatives'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.can_access(org_id, site_id)))', t || '_select', t);
  end loop;
  foreach t in array array['parking_sessions','claims','claim_events','evidence_files','capture_views','image_derivatives'] loop
    execute format($f$create policy %I on public.%I for insert to authenticated
      with check ((select private.has_role(org_id, site_id, array['operador','valet','revisor','supervisor','admin']::public.app_role[])))$f$, t || '_insert', t);
  end loop;
  foreach t in array array['parking_sessions','capture_views'] loop
    execute format($f$create policy %I on public.%I for update to authenticated
      using ((select private.has_role(org_id, site_id, array['operador','valet','revisor','supervisor','admin']::public.app_role[])))
      with check ((select private.has_role(org_id, site_id, array['operador','valet','revisor','supervisor','admin']::public.app_role[])))$f$, t || '_update', t);
  end loop;
end $$;
create policy claims_update on public.claims for update to authenticated
  using ((select private.has_role(org_id, site_id, array['revisor','supervisor','admin']::public.app_role[])))
  with check ((select private.has_role(org_id, site_id, array['revisor','supervisor','admin']::public.app_role[])));
create policy cameras_admin_write on public.cameras for all to authenticated
  using ((select private.has_role(org_id, site_id, array['admin']::public.app_role[])))
  with check ((select private.has_role(org_id, site_id, array['admin']::public.app_role[])));
