alter table public.stock_movement_batches
  drop constraint if exists stock_movement_batches_item_count_check;

alter table public.stock_movement_batches
  add constraint stock_movement_batches_item_count_check check (item_count between 1 and 500),
  add column if not exists operation_kind text not null default 'movimentacao'
    check (operation_kind in ('movimentacao','inventario')),
  add column if not exists source_file_name text
    check (source_file_name is null or char_length(btrim(source_file_name)) between 1 and 200);

comment on column public.stock_movement_batches.operation_kind is 'Distingue lote manual/importado de uma contagem de inventario.';
comment on column public.stock_movement_batches.source_file_name is 'Nome do arquivo de origem, sem armazenar o conteudo da planilha.';

create or replace function private.import_stock_spreadsheet(
  p_base_id uuid,
  p_movement_date date,
  p_operation_kind text,
  p_movement_type text,
  p_document_reference text,
  p_notes text,
  p_source_file_name text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_batch_id uuid := gen_random_uuid();
  v_protocol text;
  v_created_at timestamptz := now();
  v_count integer;
  v_movement_count integer := 0;
  v_metadata_count integer := 0;
  v_entry record;
  v_stock public.stock_items%rowtype;
  v_effect numeric(14,3);
  v_after numeric(14,3);
  v_row_movement_type text;
begin
  if v_user_id is null then raise exception 'Autenticacao obrigatoria.'; end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_user_id and p.account_status = 'ativo';

  if v_role not in ('almoxarife','administrador') then
    raise exception 'Seu perfil nao pode importar dados de estoque.';
  end if;
  if v_role = 'almoxarife' and not exists (
    select 1 from public.user_bases ub
    where ub.user_id = v_user_id and ub.base_id = p_base_id
  ) then
    raise exception 'Voce nao possui acesso a esta UTD.';
  end if;
  if not exists (select 1 from public.bases b where b.id = p_base_id and b.is_active) then
    raise exception 'UTD invalida ou inativa.';
  end if;
  if p_movement_date is null then raise exception 'Informe a data da operacao.'; end if;
  if p_operation_kind not in ('movimentacao','inventario') then raise exception 'Tipo de importacao invalido.'; end if;
  if p_operation_kind = 'movimentacao' and p_movement_type not in ('entrada','saida','ajuste_positivo','ajuste_negativo') then
    raise exception 'Tipo de movimentacao invalido.';
  end if;
  if p_document_reference is not null and char_length(btrim(p_document_reference)) > 120 then
    raise exception 'A referencia deve ter no maximo 120 caracteres.';
  end if;
  if p_notes is not null and char_length(btrim(p_notes)) > 1000 then
    raise exception 'A observacao deve ter no maximo 1000 caracteres.';
  end if;
  if p_source_file_name is null or char_length(btrim(p_source_file_name)) not between 1 and 200 then
    raise exception 'Nome do arquivo de origem invalido.';
  end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'A lista importada e invalida.'; end if;

  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 500 then raise exception 'A importacao deve conter entre 1 e 500 materiais.'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) item
    where coalesce(item->>'material_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(item->>'quantity','') !~ '^[0-9]+([.][0-9]{1,3})?$'
       or (item->>'quantity')::numeric < 0
       or (item->>'quantity')::numeric > 99999999999.999
       or (p_operation_kind = 'movimentacao' and (item->>'quantity')::numeric = 0)
       or (item->>'minimum_quantity' is not null and (
         coalesce(item->>'minimum_quantity','') !~ '^[0-9]+([.][0-9]{1,3})?$'
         or (item->>'minimum_quantity')::numeric < 0
         or (item->>'minimum_quantity')::numeric > 99999999999.999
       ))
       or char_length(coalesce(item->>'location','')) > 120
  ) then
    raise exception 'Existem materiais, quantidades, locais ou minimos invalidos na planilha.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) item
    group by item->>'material_id' having count(*) > 1
  ) then raise exception 'O mesmo material aparece mais de uma vez na planilha.'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    left join public.materials m on m.id = (item->>'material_id')::uuid and m.status = 'ativo'
    where m.id is null
  ) then raise exception 'A planilha contem material inexistente ou inativo.'; end if;

  insert into public.stock_items (base_id, material_id, created_by, updated_by)
  select p_base_id, (item->>'material_id')::uuid, v_user_id, v_user_id
  from jsonb_array_elements(p_items) item
  on conflict (base_id, material_id) do nothing;

  perform 1
  from public.stock_items si
  where si.base_id = p_base_id
    and si.material_id in (select (item->>'material_id')::uuid from jsonb_array_elements(p_items) item)
  order by si.material_id
  for update;

  for v_entry in
    select (item->>'material_id')::uuid as material_id,
           (item->>'quantity')::numeric(14,3) as quantity,
           nullif(btrim(item->>'location'),'') as location,
           (item->>'minimum_quantity')::numeric(14,3) as minimum_quantity
    from jsonb_array_elements(p_items) item
    order by (item->>'material_id')::uuid
  loop
    select * into strict v_stock from public.stock_items
    where base_id = p_base_id and material_id = v_entry.material_id;
    if not v_stock.is_active then raise exception 'Um dos itens de estoque esta inativo.'; end if;
    if p_operation_kind = 'inventario' then
      v_after := v_entry.quantity;
      v_effect := v_after - v_stock.current_quantity;
    else
      v_effect := case when p_movement_type in ('entrada','ajuste_positivo') then v_entry.quantity else -v_entry.quantity end;
      v_after := v_stock.current_quantity + v_effect;
    end if;
    if v_after < 0 then raise exception 'Saldo insuficiente para o material %. Disponivel: %.', v_entry.material_id, v_stock.current_quantity; end if;
    if v_after < v_stock.reserved_quantity then raise exception 'O material % ficaria abaixo da quantidade reservada (%).', v_entry.material_id, v_stock.reserved_quantity; end if;
  end loop;

  v_protocol := case when p_operation_kind = 'inventario' then 'INV-' else 'IMP-' end
    || to_char(p_movement_date, 'YYYYMMDD') || '-' || upper(substr(replace(v_batch_id::text, '-', ''), 1, 8));

  insert into public.stock_movement_batches (
    id, protocol, base_id, movement_date, movement_type, document_reference,
    notes, item_count, created_by, created_at, operation_kind, source_file_name
  ) values (
    v_batch_id, v_protocol, p_base_id, p_movement_date,
    case when p_operation_kind = 'inventario' then 'ajuste_positivo' else p_movement_type end,
    nullif(btrim(p_document_reference), ''), nullif(btrim(p_notes), ''),
    v_count, v_user_id, v_created_at, p_operation_kind, btrim(p_source_file_name)
  );

  for v_entry in
    select (item->>'material_id')::uuid as material_id,
           (item->>'quantity')::numeric(14,3) as quantity,
           nullif(btrim(item->>'location'),'') as location,
           (item->>'minimum_quantity')::numeric(14,3) as minimum_quantity
    from jsonb_array_elements(p_items) item
    order by (item->>'material_id')::uuid
  loop
    select * into strict v_stock from public.stock_items
    where base_id = p_base_id and material_id = v_entry.material_id;

    if p_operation_kind = 'inventario' then
      v_after := v_entry.quantity;
      v_effect := v_after - v_stock.current_quantity;
      v_row_movement_type := case when v_effect >= 0 then 'ajuste_positivo' else 'ajuste_negativo' end;
    else
      v_effect := case when p_movement_type in ('entrada','ajuste_positivo') then v_entry.quantity else -v_entry.quantity end;
      v_after := v_stock.current_quantity + v_effect;
      v_row_movement_type := p_movement_type;
    end if;

    update public.stock_items
    set current_quantity = v_after,
        location = coalesce(v_entry.location, location),
        minimum_quantity = coalesce(v_entry.minimum_quantity, minimum_quantity),
        updated_by = v_user_id,
        updated_at = v_created_at
    where id = v_stock.id;

    if v_entry.location is not null or v_entry.minimum_quantity is not null then
      v_metadata_count := v_metadata_count + 1;
    end if;

    if v_effect <> 0 then
      insert into public.stock_movements (
        stock_item_id, base_id, material_id, movement_type, quantity, effect_quantity,
        balance_before, balance_after, document_reference, notes, created_by, created_at, batch_id
      ) values (
        v_stock.id, p_base_id, v_entry.material_id, v_row_movement_type, abs(v_effect), v_effect,
        v_stock.current_quantity, v_after,
        left(v_protocol || case when nullif(btrim(p_document_reference), '') is not null then ' · ' || btrim(p_document_reference) else '' end, 120),
        nullif(btrim(p_notes), ''), v_user_id, v_created_at, v_batch_id
      );
      v_movement_count := v_movement_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'protocol', v_protocol,
    'item_count', v_count,
    'movements_created', v_movement_count,
    'updated_metadata', v_metadata_count,
    'created_by', v_user_id,
    'created_at', v_created_at
  );
end;
$$;

revoke all on function private.import_stock_spreadsheet(uuid,date,text,text,text,text,text,jsonb) from public, anon, service_role;
grant execute on function private.import_stock_spreadsheet(uuid,date,text,text,text,text,text,jsonb) to authenticated;

create or replace function public.import_stock_spreadsheet(
  p_base_id uuid,
  p_movement_date date,
  p_operation_kind text,
  p_movement_type text,
  p_document_reference text,
  p_notes text,
  p_source_file_name text,
  p_items jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.import_stock_spreadsheet(
    p_base_id, p_movement_date, p_operation_kind, p_movement_type,
    p_document_reference, p_notes, p_source_file_name, p_items
  )
$$;

revoke all on function public.import_stock_spreadsheet(uuid,date,text,text,text,text,text,jsonb) from public, anon;
grant execute on function public.import_stock_spreadsheet(uuid,date,text,text,text,text,text,jsonb) to authenticated, service_role;
