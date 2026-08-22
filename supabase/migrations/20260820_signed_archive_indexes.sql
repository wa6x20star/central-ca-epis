create index if not exists material_request_documents_base_idx on public.material_request_documents(base_id);
create index if not exists material_request_documents_team_idx on public.material_request_documents(team_id);
create index if not exists material_request_documents_uploader_idx on public.material_request_documents(uploaded_by);
create index if not exists team_assignment_history_team_idx on public.team_assignment_history(team_id,changed_at desc);
create index if not exists team_assignment_history_actor_idx on public.team_assignment_history(changed_by);
