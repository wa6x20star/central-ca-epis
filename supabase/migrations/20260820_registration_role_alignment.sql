-- Mantem o perfil solicitado visivel ao administrador enquanto a conta permanece pendente.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_role text; v_base uuid;
begin
  v_role:=case when new.raw_user_meta_data->>'requested_role' in ('consulta','almoxarife','eletricista') then new.raw_user_meta_data->>'requested_role' else 'consulta' end;
  begin v_base:=nullif(new.raw_user_meta_data->>'requested_base_id','')::uuid; exception when others then v_base:=null; end;
  if v_base is not null and not exists(select 1 from public.bases where id=v_base and is_active) then v_base:=null; end if;
  insert into public.profiles(id,email,display_name,role,account_status,requested_role,requested_base_id,employee_number,requested_team_code,requested_partner_name)
  values(new.id,lower(new.email),nullif(btrim(new.raw_user_meta_data->>'full_name'),''),v_role,'pendente',v_role,v_base,
    nullif(btrim(new.raw_user_meta_data->>'employee_number'),''),nullif(btrim(new.raw_user_meta_data->>'team_code'),''),nullif(btrim(new.raw_user_meta_data->>'partner_name'),''))
  on conflict(id) do update set email=excluded.email;
  return new;
end $$;
