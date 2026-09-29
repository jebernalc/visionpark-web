-- VISIONPARK 2.0 · Motor de IA: ontología, modelos, cola de trabajos, hallazgos, prompts, memoria y aprendizaje
create table public.damage_types (
  code text primary key,
  name text not null,
  severity_class text not null check (severity_class in ('leve','moderado','mayor'))
);
insert into public.damage_types(code, name, severity_class) values
 ('rayon','Rayón','leve'),
 ('raspon','Raspón','leve'),
 ('pintura_desprendida','Pintura desprendida','moderado'),
 ('golpe','Golpe','moderado'),
 ('abolladura','Abolladura','mayor'),
 ('fisura','Fisura','moderado'),
 ('rotura','Rotura o faltante','mayor'),
 ('rin_raspado','Rin raspado','leve'),
 ('rin_deformado','Rin deformado','mayor'),
 ('cristal_impacto','Impacto en cristal','moderado'),
 ('cristal_roto','Cristal roto','mayor');

create table public.vehicle_parts (
  code text primary key,
  name text not null,
  parent_code text references public.vehicle_parts(code)
);
create index vehicle_parts_parent_idx on public.vehicle_parts(parent_code);
insert into public.vehicle_parts(code, name, parent_code) values
 ('bomper_del','Bómper delantero',null),
 ('bomper_tras','Bómper trasero',null),
 ('capo','Capó',null),
 ('baul','Baúl o compuerta',null),
 ('techo','Techo',null),
 ('parabrisas','Parabrisas',null),
 ('luneta','Luneta posterior',null),
 ('guardabarros_del_izq','Guardabarros delantero izquierdo',null),
 ('guardabarros_del_der','Guardabarros delantero derecho',null),
 ('guardabarros_tras_izq','Guardabarros trasero izquierdo',null),
 ('guardabarros_tras_der','Guardabarros trasero derecho',null),
 ('puerta_del_izq','Puerta delantera izquierda',null),
 ('puerta_del_der','Puerta delantera derecha',null),
 ('puerta_tras_izq','Puerta trasera izquierda',null),
 ('puerta_tras_der','Puerta trasera derecha',null),
 ('espejo_izq','Espejo izquierdo',null),
 ('espejo_der','Espejo derecho',null),
 ('rin_del_izq','Rin delantero izquierdo',null),
 ('rin_del_der','Rin delantero derecho',null),
 ('rin_tras_izq','Rin trasero izquierdo',null),
 ('rin_tras_der','Rin trasero derecho',null),
 ('bomper_tras_der','Bómper trasero, sector derecho','bomper_tras'),
 ('bomper_tras_izq','Bómper trasero, sector izquierdo','bomper_tras'),
 ('bomper_del_der','Bómper delantero, sector derecho','bomper_del'),
 ('bomper_del_izq','Bómper delantero, sector izquierdo','bomper_del');

create table public.model_registry (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  task text not null,
  status text not null default 'retador' check (status in ('campeon','retador','archivado')),
  license text,
  card jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (name, version)
);
-- Un solo campeón por tarea
create unique index model_one_champion_per_task on public.model_registry(task) where status = 'campeon';

create table public.dataset_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  notes text,
  n_cases int not null default 0,
  created_at timestamptz not null default now()
);

create table public.inference_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  evidence_id uuid references public.evidence_files(id) on delete cascade,
  session_id uuid references public.parking_sessions(id) on delete cascade,
  task text not null,
  status text not null default 'pendiente' check (status in ('pendiente','procesando','completado','error')),
  attempts int not null default 0,
  locked_by text,
  locked_at timestamptz,
  error text,
  result_summary jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_pending_idx on public.inference_jobs(created_at) where status = 'pendiente';
create index jobs_org_site_idx on public.inference_jobs(org_id, site_id);
create index jobs_evidence_idx on public.inference_jobs(evidence_id);
create index jobs_session_idx on public.inference_jobs(session_id);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  session_id uuid not null references public.parking_sessions(id) on delete cascade,
  part_code text references public.vehicle_parts(code),
  damage_code text references public.damage_types(code),
  polygon jsonb,  -- polígono en coordenadas del panel rectificado
  state text not null default 'E0' check (state in ('E0','E1','E2','E3','E4','E5','E6','E7','E8')),
  confidence_label text check (confidence_label in ('alta','media','baja','abstencion')),
  confidence numeric check (confidence between 0 and 1),
  validation text not null default 'AI_GENERATED' check (validation in ('AI_GENERATED','HUMAN_REVIEWED','APPROVED')),
  model_id uuid references public.model_registry(id),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index findings_session_idx on public.findings(session_id);
create index findings_org_site_idx on public.findings(org_id, site_id);
create index findings_part_idx on public.findings(part_code);
create index findings_damage_idx on public.findings(damage_code);
create index findings_model_idx on public.findings(model_id);
create index findings_created_by_idx on public.findings(created_by);
create trigger findings_touch before update on public.findings
  for each row execute function private.touch_updated_at();

create table public.finding_evidence (
  finding_id uuid not null references public.findings(id) on delete cascade,
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  role text not null check (role in ('ingreso','salida','reclamacion')),
  region jsonb,
  primary key (finding_id, evidence_id)
);
create index finding_evidence_evidence_idx on public.finding_evidence(evidence_id);
create index finding_evidence_org_site_idx on public.finding_evidence(org_id, site_id);

create table public.finding_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  finding_id uuid not null references public.findings(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('aceptar','corregir','rechazar')),
  corrected_state text check (corrected_state in ('E0','E1','E2','E3','E4','E5','E6','E7','E8')),
  corrected_damage_code text references public.damage_types(code),
  note text,
  created_at timestamptz not null default now()
);
create index finding_reviews_finding_idx on public.finding_reviews(finding_id);
create index finding_reviews_reviewer_idx on public.finding_reviews(reviewer_id);
create index finding_reviews_org_site_idx on public.finding_reviews(org_id, site_id);
create index finding_reviews_damage_idx on public.finding_reviews(corrected_damage_code);

create table public.ai_detections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  evidence_id uuid not null references public.evidence_files(id) on delete cascade,
  job_id uuid references public.inference_jobs(id) on delete set null,
  model_id uuid references public.model_registry(id),
  label text not null,
  score numeric check (score between 0 and 1),
  bbox jsonb,
  mask_ref text,
  created_at timestamptz not null default now()
);
create index detections_evidence_idx on public.ai_detections(evidence_id);
create index detections_job_idx on public.ai_detections(job_id);
create index detections_model_idx on public.ai_detections(model_id);
create index detections_org_site_idx on public.ai_detections(org_id, site_id);

create table public.ai_comparisons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  session_id uuid not null references public.parking_sessions(id) on delete cascade,
  part_code text references public.vehicle_parts(code),
  evidence_in uuid references public.evidence_files(id) on delete restrict,
  evidence_out uuid references public.evidence_files(id) on delete restrict,
  result jsonb not null default '{}'::jsonb,
  model_id uuid references public.model_registry(id),
  created_at timestamptz not null default now()
);
create index comparisons_session_idx on public.ai_comparisons(session_id);
create index comparisons_part_idx on public.ai_comparisons(part_code);
create index comparisons_in_idx on public.ai_comparisons(evidence_in);
create index comparisons_out_idx on public.ai_comparisons(evidence_out);
create index comparisons_model_idx on public.ai_comparisons(model_id);
create index comparisons_org_site_idx on public.ai_comparisons(org_id, site_id);

-- Espacio de prompts por adjunto: cada pregunta, con su alcance, respuesta, citas y decisión del revisor
create table public.ai_queries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  session_id uuid references public.parking_sessions(id) on delete cascade,
  evidence_id uuid references public.evidence_files(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  scope text not null check (scope in ('imagen','panel','caja','expediente','similares')),
  prompt text not null check (length(prompt) between 1 and 4000),
  region jsonb,
  answer text,
  citations jsonb not null default '[]'::jsonb,
  proposed_state text check (proposed_state in ('E0','E1','E2','E3','E4','E5','E6','E7','E8')),
  confidence_label text check (confidence_label in ('alta','media','baja','abstencion')),
  model_id uuid references public.model_registry(id),
  decision text check (decision in ('aceptada','corregida','rechazada')),
  decided_at timestamptz,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index queries_session_idx on public.ai_queries(session_id);
create index queries_evidence_idx on public.ai_queries(evidence_id);
create index queries_user_idx on public.ai_queries(user_id);
create index queries_model_idx on public.ai_queries(model_id);
create index queries_org_site_idx on public.ai_queries(org_id, site_id, created_at desc);

create table public.prompt_library (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  template text not null,
  scope text not null check (scope in ('imagen','panel','caja','expediente','similares')),
  version int not null default 1,
  approved_by uuid references auth.users(id) on delete set null,
  uses int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index prompt_library_org_idx on public.prompt_library(org_id);
create index prompt_library_approved_idx on public.prompt_library(approved_by);

-- Embeddings visuales y memoria de casos (sin datos personales)
create table public.image_embeddings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  evidence_id uuid not null references public.evidence_files(id) on delete cascade,
  region jsonb,
  model_id uuid references public.model_registry(id),
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now()
);
create index embeddings_evidence_idx on public.image_embeddings(evidence_id);
create index embeddings_org_idx on public.image_embeddings(org_id);
create index embeddings_model_idx on public.image_embeddings(model_id);
create index embeddings_hnsw_idx on public.image_embeddings using hnsw (embedding extensions.vector_cosine_ops);

create table public.case_memory (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  finding_id uuid references public.findings(id) on delete set null,
  summary text not null,
  outcome text,
  embedding extensions.vector(768),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index case_memory_finding_idx on public.case_memory(finding_id);
create index case_memory_org_site_idx on public.case_memory(org_id, site_id);
create index case_memory_hnsw_idx on public.case_memory using hnsw (embedding extensions.vector_cosine_ops);

create table public.learning_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('etiqueta_validada','reentrenamiento','calibracion','promocion','reversion')),
  model_id uuid references public.model_registry(id),
  dataset_version_id uuid references public.dataset_versions(id),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index learning_events_org_idx on public.learning_events(org_id, created_at desc);
create index learning_events_model_idx on public.learning_events(model_id);
create index learning_events_dataset_idx on public.learning_events(dataset_version_id);

create table public.model_evaluations (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.model_registry(id) on delete cascade,
  dataset_version_id uuid references public.dataset_versions(id),
  metrics jsonb not null,
  gates_passed boolean not null default false,
  created_at timestamptz not null default now()
);
create index model_evaluations_model_idx on public.model_evaluations(model_id);
create index model_evaluations_dataset_idx on public.model_evaluations(dataset_version_id);

create table public.authenticity_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  evidence_id uuid not null references public.evidence_files(id) on delete cascade,
  claim_id uuid references public.claims(id) on delete cascade,
  verdict text not null check (verdict in ('sin_indicios','indicios','no_concluyente')),
  signals jsonb not null default '{}'::jsonb,
  model_id uuid references public.model_registry(id),
  created_at timestamptz not null default now()
);
create index authenticity_evidence_idx on public.authenticity_checks(evidence_id);
create index authenticity_claim_idx on public.authenticity_checks(claim_id);
create index authenticity_model_idx on public.authenticity_checks(model_id);
create index authenticity_org_site_idx on public.authenticity_checks(org_id, site_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  session_id uuid not null references public.parking_sessions(id) on delete restrict,
  claim_id uuid references public.claims(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index reports_session_idx on public.reports(session_id);
create index reports_claim_idx on public.reports(claim_id);
create index reports_org_site_idx on public.reports(org_id, site_id);

create table public.report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  version int not null,
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  evidence_ids uuid[] not null default '{}',
  model_versions jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (report_id, version)
);
create index report_versions_org_site_idx on public.report_versions(org_id, site_id);
create index report_versions_approved_idx on public.report_versions(approved_by);

-- Encolar análisis al recibir una foto
create function private.enqueue_photo_jobs()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'foto' then
    insert into public.inference_jobs(org_id, site_id, evidence_id, session_id, task)
    values (new.org_id, new.site_id, new.id, new.session_id, 'calidad_y_vehiculo');
  end if;
  return new;
end;
$$;
create trigger evidence_enqueue after insert on public.evidence_files
  for each row execute function private.enqueue_photo_jobs();

-- Los trabajadores de GPU toman trabajos con bloqueo de fila (solo service_role)
create function public.claim_next_job(p_worker text, p_task text default null)
returns setof public.inference_jobs language plpgsql security definer set search_path = ''
as $$
begin
  return query
  update public.inference_jobs j
     set status = 'procesando', locked_by = p_worker, locked_at = now(), attempts = j.attempts + 1
   where j.id = (select id from public.inference_jobs
                  where status = 'pendiente' and (p_task is null or task = p_task)
                  order by created_at
                  for update skip locked
                  limit 1)
  returning j.*;
end;
$$;
revoke execute on function public.claim_next_job(text, text) from public, anon, authenticated;
grant execute on function public.claim_next_job(text, text) to service_role;

-- RLS
do $$
declare t text;
begin
  foreach t in array array['damage_types','vehicle_parts','model_registry','dataset_versions','model_evaluations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
  end loop;

  foreach t in array array['inference_jobs','findings','finding_evidence','finding_reviews','ai_detections','ai_comparisons','ai_queries','authenticity_checks','case_memory','reports','report_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.can_access(org_id, site_id)))', t || '_select', t);
  end loop;

  foreach t in array array['findings','finding_evidence','finding_reviews','reports','report_versions'] loop
    execute format($f$create policy %I on public.%I for insert to authenticated
      with check ((select private.has_role(org_id, site_id, array['revisor','supervisor','admin']::public.app_role[])))$f$, t || '_insert', t);
  end loop;

  foreach t in array array['findings','reports'] loop
    execute format($f$create policy %I on public.%I for update to authenticated
      using ((select private.has_role(org_id, site_id, array['revisor','supervisor','admin']::public.app_role[])))
      with check ((select private.has_role(org_id, site_id, array['revisor','supervisor','admin']::public.app_role[])))$f$, t || '_update', t);
  end loop;
end $$;

alter table public.prompt_library enable row level security;
alter table public.image_embeddings enable row level security;
alter table public.learning_events enable row level security;

create policy prompt_library_select on public.prompt_library for select to authenticated
  using ((select private.in_org(org_id)));
create policy prompt_library_write on public.prompt_library for all to authenticated
  using ((select private.has_role(org_id, null, array['supervisor','admin']::public.app_role[])))
  with check ((select private.has_role(org_id, null, array['supervisor','admin']::public.app_role[])));
create policy embeddings_select on public.image_embeddings for select to authenticated
  using ((select private.in_org(org_id)));
create policy learning_events_select on public.learning_events for select to authenticated
  using (org_id is null or (select private.in_org(org_id)));

create policy queries_insert on public.ai_queries for insert to authenticated
  with check (user_id = (select auth.uid())
    and (select private.has_role(org_id, site_id, array['operador','valet','revisor','supervisor','admin']::public.app_role[])));
create policy queries_update_own on public.ai_queries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.inference_jobs, public.findings;
