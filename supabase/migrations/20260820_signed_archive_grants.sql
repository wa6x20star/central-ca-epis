revoke all on public.team_assignment_history, public.material_request_documents from anon;
grant select on public.team_assignment_history to authenticated;
grant select,insert on public.material_request_documents to authenticated;
grant all on public.team_assignment_history, public.material_request_documents to service_role;
