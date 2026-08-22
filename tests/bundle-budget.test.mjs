import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../dist/client/.vite/manifest.json", import.meta.url);

test("mantém o módulo pesado de QR Code fora do carregamento inicial", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const appEntry = manifest["app/EpiApp.tsx"];
  const requisitionsEntry = manifest["app/Requisitions.tsx"];

  assert.ok(appEntry, "O bundle principal da aplicação deve existir");
  assert.ok(requisitionsEntry, "Requisições deve possuir um bundle independente");
  assert.ok(appEntry.dynamicImports?.includes("app/Requisitions.tsx"), "O QR Code deve ser carregado somente ao abrir Requisições");
  assert.equal(requisitionsEntry.isDynamicEntry, true);
});

test("protege o orçamento do bundle principal", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const appEntry = manifest["app/EpiApp.tsx"];
  const bundle = new URL(`../dist/client/${appEntry.file}`, import.meta.url);
  const { size } = await stat(bundle);

  assert.ok(size <= 360 * 1024, `Bundle principal acima do limite: ${Math.round(size / 1024)} KB`);
});
