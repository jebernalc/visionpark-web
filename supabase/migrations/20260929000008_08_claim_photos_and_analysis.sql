-- VISIONPARK 2.0 · Fotos de la reclamación etiquetadas por vista y guardado de análisis de visión digital
create table public.claim_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  claim_id uuid not null references public.claims(id) on delete cascade,
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  view_code text references public.canonical_views(code),
  note text check (note is null or length(note) <= 500),
  quality numeric check (quality between 0 and 1),
  usable boolean,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (evidence_id)
);
create index claim_views_claim_idx on public.claim_views(claim_id, view_code);
create index claim_views_org_site_idx on public.claim_views(org_id, site_id);
create index claim_views_view_idx on public.claim_views(view_code);
create index claim_views_created_by_idx on public.claim_views(created_by);

alter table public.claim_views enable row level security;
create policy claim_views_select on public.claim_views for select to authenticated
  using ((select private.can_access(org_id, site_id)));
create policy claim_views_insert on public.claim_views for insert to authenticated
  with check ((select private.has_role(org_id, site_id, array['operador','valet','revisor','supervisor','admin']::public.app_role[])));
create policy claim_views_update on public.claim_views for update to authenticated
  using ((select private.has_role(org_id, site_id, array['operador','valet','revisor','supervisor','admin']::public.app_role[])))
  with check ((select private.has_role(org_id, site_id, array['operador','valet','revisor','supervisor','admin']::public.app_role[])));

-- Las comparaciones calculadas por la visión digital del navegador las guarda el personal de revisión
create policy comparisons_insert on public.ai_comparisons for insert to authenticated
  with check ((select private.has_role(org_id, site_id, array['revisor','supervisor','admin']::public.app_role[])));

-- El aviso de cambios de la reclamación también queda en auditoría
create trigger claim_views_audit after insert or update or delete on public.claim_views
  for each row execute function private.log_change();
