import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const requisitions = readFileSync(new URL("../app/Requisitions.tsx", import.meta.url), "utf8");
const users = readFileSync(new URL("../app/EpiApp.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260820_teams_requests_signed_archive.sql", import.meta.url), "utf8");

test("permite ao administrador reorganizar a dupla com justificativa", () => {
  assert.match(users, /admin_update_team/);
  assert.match(users, /Justificativa da alteração/);
  assert.match(migration, /cardinality\(v_members\) > 2/);
  assert.match(migration, /team_assignment_history/);
});

test("exige equipe válida e salva o vínculo na requisição", () => {
  assert.match(requisitions, /Equipe responsável/);
  assert.match(requisitions, /create_material_request_v2/);
  assert.match(migration, /Selecione uma equipe ativa da UTD informada/);
  assert.match(migration, /v_team\.code,v_team\.id/);
});

test("arquiva somente documentos assinados em armazenamento privado", () => {
  assert.match(requisitions, /completo, legível e assinado/);
  assert.match(requisitions, /request-signed-documents/);
  assert.match(migration, /values\('request-signed-documents','request-signed-documents',false,10485760/);
  assert.match(migration, /r\.status='entregue'/);
});
