import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPassword,
  authErrorMessage,
  canArchiveVariant,
  canAccessBase,
  canTransitionRequestStatus,
  filterApprovedCatalog,
  isValidArchiveReason,
  materialLabelPayload,
  normalizeScannedCode,
  requestCode,
  roleHasGlobalBaseAccess,
  roleRequiresAssignedBase,
} from "../app/domain.ts";
import { mapSpreadsheetRows, parseDelimitedText, stockImportTemplate } from "../app/stockImport.ts";

test("mantém no catálogo somente C.A.s aprovados", () => {
  const catalog = filterApprovedCatalog([
    { id: "aprovado", registration_status: "aprovado" },
    { id: "pendente", registration_status: "aguardando_validacao" },
    { id: "rejeitado", registration_status: "rejeitado" },
  ]);

  assert.deepEqual(catalog.map((item) => item.id), ["aprovado"]);
});

test("permite exclusão de C.A. somente ao administrador", () => {
  assert.equal(canArchiveVariant("administrador"), true);
  assert.equal(canArchiveVariant("aprovador"), false);
  assert.equal(canArchiveVariant("almoxarife"), false);
  assert.equal(canArchiveVariant("consulta"), false);
});

test("exige justificativa detalhada para excluir um C.A.", () => {
  assert.equal(isValidArchiveReason("curta"), false);
  assert.equal(isValidArchiveReason("Cadastro duplicado confirmado durante a revisão."), true);
  assert.equal(isValidArchiveReason("a".repeat(1001)), false);
});

test("restringe consulta e almoxarife às UTDs atribuídas", () => {
  assert.equal(roleRequiresAssignedBase("consulta"), true);
  assert.equal(roleRequiresAssignedBase("almoxarife"), true);
  assert.equal(canAccessBase("consulta", ["piedade"], "piedade"), true);
  assert.equal(canAccessBase("consulta", ["piedade"], "cabo"), false);
});

test("mantém eletricista restrito à UTD atribuída", () => {
  assert.equal(roleRequiresAssignedBase("eletricista"), true);
  assert.equal(roleHasGlobalBaseAccess("eletricista"), false);
  assert.equal(canAccessBase("eletricista", ["piedade"], "piedade"), true);
  assert.equal(canAccessBase("eletricista", ["piedade"], "cabo"), false);
});

test("mantém acesso global somente para aprovador e administrador", () => {
  assert.equal(roleHasGlobalBaseAccess("aprovador"), true);
  assert.equal(roleHasGlobalBaseAccess("administrador"), true);
  assert.equal(roleHasGlobalBaseAccess("almoxarife"), false);
  assert.equal(canAccessBase("administrador", [], "rio-formoso"), true);
});

test("aceita senha forte com todos os requisitos", () => {
  const result = assessPassword("Central@2026Segura");
  assert.equal(result.valid, true);
  assert.equal(result.label, "Forte");
  assert.equal(result.rules.every((rule) => rule.met), true);
});

test("rejeita senha comum mesmo quando é longa", () => {
  const result = assessPassword("administrador");
  assert.equal(result.valid, false);
  assert.equal(result.rules.at(-1)?.met, false);
});

test("traduz erros conhecidos do login sem expor detalhes técnicos", () => {
  assert.equal(authErrorMessage("Invalid login credentials"), "E-mail ou senha incorretos.");
  assert.equal(authErrorMessage("Email not confirmed"), "Confirme seu e-mail antes de entrar.");
  assert.equal(authErrorMessage("Too many requests"), "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
});

test("gera payload de etiqueta com código e origem", () => {
  const payload = JSON.parse(materialLabelPayload({ source_type: "material", source_id: "mat-1", code: "2412003" }));
  assert.deepEqual(payload, { v: 1, type: "material", source: "material", id: "mat-1", code: "2412003" });
});

test("lê código de QR em JSON, URL e conteúdo simples", () => {
  assert.equal(normalizeScannedCode('{"code":" 452656 "}'), "452656");
  assert.equal(normalizeScannedCode('{"codigo":336}'), "336");
  assert.equal(normalizeScannedCode("https://example.test/item?material=2412003"), "2412003");
  assert.equal(normalizeScannedCode("  778899  "), "778899");
});

test("formata o número da requisição para impressão", () => {
  assert.equal(requestCode(7), "REQ-00007");
  assert.equal(requestCode(123456), "REQ-123456");
});

test("permite somente a sequência operacional da requisição", () => {
  assert.equal(canTransitionRequestStatus("aberta", "separada"), true);
  assert.equal(canTransitionRequestStatus("separada", "entregue"), true);
  assert.equal(canTransitionRequestStatus("aberta", "entregue"), false);
  assert.equal(canTransitionRequestStatus("entregue", "aberta"), false);
});

test("exige justificativa para cancelar e bloqueia alteração após cancelamento", () => {
  assert.equal(canTransitionRequestStatus("aberta", "cancelada"), false);
  assert.equal(canTransitionRequestStatus("aberta", "cancelada", "Material indisponível"), true);
  assert.equal(canTransitionRequestStatus("cancelada", "separada"), false);
});

test("lê planilha CSV com separador e conteúdo entre aspas", () => {
  const rows = parseDelimitedText('Código;Quantidade;Local\r\n452656;10;"Rua A; prateleira 2"');
  assert.deepEqual(rows, [["Código", "Quantidade", "Local"], ["452656", "10", "Rua A; prateleira 2"]]);
});

test("reconhece colunas usuais de inventário e números brasileiros", () => {
  const result = mapSpreadsheetRows([
    ["CÓDIGO", "Quantidade contada", "Localização", "Estoque mínimo"],
    ["452656", "1.234,5", "A-01", "10"],
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows[0], { rowNumber: 2, code: "452656", quantity: 1234.5, location: "A-01", minimumQuantity: 10 });
});

test("gera modelo de importação compatível com Excel", () => {
  assert.match(stockImportTemplate("inventario"), /^\uFEFFCódigo;Quantidade contada;Local;Estoque mínimo/);
  assert.match(stockImportTemplate("movimentacao"), /Código;Quantidade/);
});
