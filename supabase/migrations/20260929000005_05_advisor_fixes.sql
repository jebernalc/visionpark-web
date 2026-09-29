-- Correcciones de los avisos de rendimiento: índices en site_id y una política permisiva por acción
do $$
declare t text;
begin
  foreach t in array array['ai_comparisons','ai_detections','ai_queries','authenticity_checks','cameras','capture_views','case_memory','claim_events','claims','evidence_files','finding_evidence','finding_reviews','findings','image_derivatives','inference_jobs','parking_sessions','report_versions','reports'] loop
    execute format('create index if not exists %I on public.%I(site_id)', t || '_site_fk_idx', t);
  end loop;
end $$;

-- Separar las políticas "for all" para que no dupliquen la de lectura
drop policy sites_admin_write on public.sites;
create policy sites_admin_insert on public.sites for insert to authenticated
  with check ((select private.has_role(org_id, id, array['admin']::public.app_role[])));
create policy sites_admin_update on public.sites for update to authenticated
  using ((select private.has_role(org_id, id, array['admin']::public.app_role[])))
  with check ((select private.has_role(org_id, id, array['admin']::public.app_role[])));
create policy sites_admin_delete on public.sites for delete to authenticated
  using ((select private.has_role(org_id, id, array['admin']::public.app_role[])));

drop policy user_sites_admin_write on public.user_sites;
create policy user_sites_admin_insert on public.user_sites for insert to authenticated
  with check ((select private.has_role(org_id, site_id, array['admin']::public.app_role[])));
create policy user_sites_admin_update on public.user_sites for update to authenticated
  using ((select private.has_role(org_id, site_id, array['admin']::public.app_role[])))
  with check ((select private.has_role(org_id, site_id, array['admin']::public.app_role[])));
create policy user_sites_admin_delete on public.user_sites for delete to authenticated
  using ((select private.has_role(org_id, site_id, array['admin']::public.app_role[])));

drop policy cameras_admin_write on public.cameras;
create policy cameras_admin_insert on public.cameras for insert to authenticated
  with check ((select private.has_role(org_id, site_id, array['admin']::public.app_role[])));
create policy cameras_admin_update on public.cameras for update to authenticated
  using ((select private.has_role(org_id, site_id, array['admin']::public.app_role[])))
  with check ((select private.has_role(org_id, site_id, array['admin']::public.app_role[])));
create policy cameras_admin_delete on public.cameras for delete to authenticated
  using ((select private.has_role(org_id, site_id, array['admin']::public.app_role[])));

drop policy prompt_library_write on public.prompt_library;
create policy prompt_library_insert on public.prompt_library for insert to authenticated
  with check ((select private.has_role(org_id, null, array['supervisor','admin']::public.app_role[])));
create policy prompt_library_update on public.prompt_library for update to authenticated
  using ((select private.has_role(org_id, null, array['supervisor','admin']::public.app_role[])))
  with check ((select private.has_role(org_id, null, array['supervisor','admin']::public.app_role[])));
create policy prompt_library_delete on public.prompt_library for delete to authenticated
  using ((select private.has_role(org_id, null, array['supervisor','admin']::public.app_role[])));

drop policy retention_admin_write on public.retention_policies;
create policy retention_insert on public.retention_policies for insert to authenticated
  with check ((select private.has_role(org_id, null, array['admin']::public.app_role[])));
create policy retention_update on public.retention_policies for update to authenticated
  using ((select private.has_role(org_id, null, array['admin']::public.app_role[])))
  with check ((select private.has_role(org_id, null, array['admin']::public.app_role[])));
create policy retention_delete on public.retention_policies for delete to authenticated
  using ((select private.has_role(org_id, null, array['admin']::public.app_role[])));
