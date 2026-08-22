export type SpreadsheetCell = string | number | boolean | Date | null | undefined;

export type StockImportRow = {
  rowNumber: number;
  code: string;
  quantity: number | null;
  location: string;
  minimumQuantity: number | null;
};

const headerAliases = {
  code: new Set(["codigo", "cod", "codigo_do_material", "material", "internal_code"]),
  quantity: new Set(["quantidade", "qtd", "saldo", "quantidade_contada", "contagem", "quantity"]),
  location: new Set(["local", "localizacao", "endereco", "location"]),
  minimum: new Set(["minimo", "estoque_minimo", "quantidade_minima", "minimum"]),
};

export function normalizeSpreadsheetHeader(value: SpreadsheetCell) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function parseDecimal(value: SpreadsheetCell) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function findColumn(headers: string[], aliases: Set<string>) {
  return headers.findIndex((header) => aliases.has(header));
}

export function mapSpreadsheetRows(rows: SpreadsheetCell[][]) {
  if (rows.length === 0) return { rows: [] as StockImportRow[], errors: ["A planilha está vazia."] };
  const headers = rows[0].map(normalizeSpreadsheetHeader);
  const codeIndex = findColumn(headers, headerAliases.code);
  const quantityIndex = findColumn(headers, headerAliases.quantity);
  const locationIndex = findColumn(headers, headerAliases.location);
  const minimumIndex = findColumn(headers, headerAliases.minimum);
  const errors: string[] = [];
  if (codeIndex < 0) errors.push("Não encontrei a coluna Código.");
  if (quantityIndex < 0) errors.push("Não encontrei a coluna Quantidade.");
  if (errors.length > 0) return { rows: [] as StockImportRow[], errors };

  const mapped = rows.slice(1).flatMap((row, index) => {
    const code = String(row[codeIndex] ?? "").trim();
    const rawQuantity = row[quantityIndex];
    const hasAnyValue = row.some((cell) => String(cell ?? "").trim());
    if (!hasAnyValue) return [];
    return [{
      rowNumber: index + 2,
      code,
      quantity: parseDecimal(rawQuantity),
      location: locationIndex >= 0 ? String(row[locationIndex] ?? "").trim() : "",
      minimumQuantity: minimumIndex >= 0 && String(row[minimumIndex] ?? "").trim() ? parseDecimal(row[minimumIndex]) : null,
    }];
  });
  return { rows: mapped, errors };
}

export function parseDelimitedText(text: string) {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted && character === '"' && source[index + 1] === '"') { value += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === delimiter) { row.push(value); value = ""; continue; }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value); rows.push(row); row = []; value = ""; continue;
    }
    value += character;
  }
  if (value.length > 0 || row.length > 0) { row.push(value); rows.push(row); }
  return rows;
}

export function stockImportTemplate(mode: "inventario" | "movimentacao") {
  const rows = mode === "inventario"
    ? [["Código", "Quantidade contada", "Local", "Estoque mínimo"], ["452656", "10", "A-01", "3"]]
    : [["Código", "Quantidade"], ["452656", "10"]];
  return `\uFEFF${rows.map((row) => row.join(";")).join("\r\n")}`;
}
