-- Endurecimento após os advisors: opção pública mínima de UTD e índices de FKs.
create or replace function public.registration_base_options()
returns table(id uuid,name text,abbreviation text)
language sql stable security invoker set search_path=''
as $$ select b.id,b.name,b.abbreviation from public.bases b where b.is_active order by b.name $$;
revoke all on function public.registration_base_options() from public;
grant execute on function public.registration_base_options() to anon,authenticated,service_role;

drop policy if exists bases_registration_select on public.bases;
create policy bases_registration_select on public.bases for select to anon using (is_active);
grant select(id,name,abbreviation,is_active) on public.bases to anon;

create index if not exists profiles_access_reviewed_by_idx on public.profiles(access_reviewed_by);
create index if not exists team_custody_material_id_idx on public.team_material_custody(material_id);
create index if not exists team_custody_received_by_idx on public.team_material_custody(received_by);
create index if not exists team_custody_source_request_idx on public.team_material_custody(source_request_id);
create index if not exists team_usage_base_id_idx on public.team_material_usage(base_id);
create index if not exists team_usage_created_by_idx on public.team_material_usage(created_by);
create index if not exists team_members_assigned_by_idx on public.team_members(assigned_by);
create index if not exists team_meter_history_changed_by_idx on public.team_meter_history(changed_by);
create index if not exists team_meters_created_by_idx on public.team_meters(created_by);
create index if not exists team_meters_material_id_idx on public.team_meters(material_id);
create index if not exists team_meters_source_request_idx on public.team_meters(source_request_id);
create index if not exists team_meters_updated_by_idx on public.team_meters(updated_by);
create index if not exists teams_created_by_idx on public.teams(created_by);
create index if not exists teams_updated_by_idx on public.teams(updated_by);
