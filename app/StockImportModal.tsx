"use client";

import { ChangeEvent, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, PackageCheck, TriangleAlert, Upload, X } from "lucide-react";
import { mapSpreadsheetRows, parseDelimitedText, stockImportTemplate, type SpreadsheetCell, type StockImportRow } from "./stockImport";

type Base = { id: string; name: string; is_active: boolean };
type Material = { id: string; internal_code: string; name: string; status: string; unit_of_measure: string };
type StockItem = { material_id: string; base_id: string; current_quantity: number; reserved_quantity: number; location: string | null; minimum_quantity: number; is_active: boolean };
type ImportMode = "inventario" | "movimentacao";
type MovementType = "entrada" | "saida" | "ajuste_positivo" | "ajuste_negativo";
type ImportResult = { protocol: string; item_count: number; movements_created: number; updated_metadata: number; created_at: string };

type ProjectedRow = StockImportRow & {
  material?: Material;
  current: number;
  after: number;
  delta: number;
  error: string | null;
};

const movementLabels: Record<MovementType, string> = {
  entrada: "Entrada",
  saida: "Saída",
  ajuste_positivo: "Ajuste positivo",
  ajuste_negativo: "Ajuste negativo",
};

function formatQuantity(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}

function downloadTemplate(mode: ImportMode) {
  const blob = new Blob([stockImportTemplate(mode)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = mode === "inventario" ? "modelo-inventario.csv" : "modelo-movimentacao.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function StockImportModal({
  supabase,
  bases,
  materials,
  stockItems,
  defaultBaseId,
  onClose,
  onSuccess,
  showToast,
}: {
  supabase: SupabaseClient;
  bases: Base[];
  materials: Material[];
  stockItems: StockItem[];
  defaultBaseId: string;
  onClose: () => void;
  onSuccess: (baseId: string) => Promise<void>;
  showToast: (kind: "success" | "error", message: string) => void;
}) {
  const [mode, setMode] = useState<ImportMode>("inventario");
  const [baseId, setBaseId] = useState(defaultBaseId || bases[0]?.id || "");
  const [movementType, setMovementType] = useState<MovementType>("entrada");
  const [movementDate, setMovementDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<StockImportRow[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const materialByCode = useMemo(() => new Map(materials.filter((item) => item.status === "ativo").map((item) => [item.internal_code.trim().toLocaleLowerCase("pt-BR"), item])), [materials]);
  const stockByMaterial = useMemo(() => new Map(stockItems.filter((item) => item.base_id === baseId).map((item) => [item.material_id, item])), [baseId, stockItems]);
  const duplicateCodes = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => { const key = row.code.toLocaleLowerCase("pt-BR"); counts.set(key, (counts.get(key) ?? 0) + 1); });
    return new Set([...counts].filter(([, count]) => count > 1).map(([code]) => code));
  }, [rows]);

  const projected = useMemo<ProjectedRow[]>(() => rows.map((row) => {
    const codeKey = row.code.toLocaleLowerCase("pt-BR");
    const material = materialByCode.get(codeKey);
    const stock = material ? stockByMaterial.get(material.id) : undefined;
    const current = Number(stock?.current_quantity ?? 0);
    const amount = Number(row.quantity);
    const positive = movementType === "entrada" || movementType === "ajuste_positivo";
    const after = mode === "inventario" ? amount : current + (positive ? amount : -amount);
    const delta = after - current;
    let error: string | null = null;
    if (!row.code) error = "Código vazio";
    else if (!material) error = "Material não encontrado ou inativo";
    else if (duplicateCodes.has(codeKey)) error = "Código repetido na planilha";
    else if (row.quantity === null || !Number.isFinite(amount) || amount < 0 || (mode === "movimentacao" && amount === 0)) error = "Quantidade inválida";
    else if (row.minimumQuantity !== null && (!Number.isFinite(row.minimumQuantity) || row.minimumQuantity < 0)) error = "Estoque mínimo inválido";
    else if (row.location.length > 120) error = "Local deve ter até 120 caracteres";
    else if (stock && !stock.is_active) error = "Item de estoque inativo";
    else if (after < 0) error = `Saldo insuficiente: ${formatQuantity(current)}`;
    else if (after < Number(stock?.reserved_quantity ?? 0)) error = `Abaixo da reserva: ${formatQuantity(Number(stock?.reserved_quantity ?? 0))}`;
    return { ...row, material, current, after, delta, error };
  }), [duplicateCodes, materialByCode, mode, movementType, rows, stockByMaterial]);

  const invalidRows = projected.filter((row) => row.error);
  const visibleRows = invalidRows.length > 0 ? invalidRows.slice(0, 120) : projected.slice(0, 120);
  const canReview = rows.length > 0 && rows.length <= 500 && fileErrors.length === 0 && invalidRows.length === 0 && Boolean(baseId && movementDate);

  const resetFile = () => {
    setRows([]);
    setFilename("");
    setFileErrors([]);
    setReviewing(false);
    setResult(null);
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setParsing(true);
    setFileErrors([]);
    setReviewing(false);
    try {
      let matrix: SpreadsheetCell[][];
      if (/\.csv$/i.test(file.name)) matrix = parseDelimitedText(await file.text());
      else {
        const { default: readXlsxFile } = await import("read-excel-file/browser");
        matrix = await readXlsxFile(file) as SpreadsheetCell[][];
      }
      const mapped = mapSpreadsheetRows(matrix);
      const errors = [...mapped.errors];
      if (mapped.rows.length > 500) errors.push("A planilha ultrapassa o limite de 500 itens por importação.");
      setRows(mapped.rows);
      setFilename(file.name.slice(0, 180));
      setFileErrors(errors);
      if (errors.length === 0) showToast("success", `${mapped.rows.length} linhas carregadas para conferência.`);
    } catch {
      setRows([]);
      setFilename("");
      setFileErrors(["Não foi possível ler o arquivo. Use XLSX, XLS ou CSV no modelo indicado."]);
    }
    setParsing(false);
  };

  const confirmImport = async () => {
    if (!canReview) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("import_stock_spreadsheet", {
      p_base_id: baseId,
      p_movement_date: movementDate,
      p_operation_kind: mode,
      p_movement_type: mode === "movimentacao" ? movementType : null,
      p_document_reference: reference.trim() || null,
      p_notes: notes.trim() || null,
      p_source_file_name: filename,
      p_items: projected.map((row) => ({
        material_id: row.material?.id,
        quantity: row.quantity,
        location: row.location || null,
        minimum_quantity: row.minimumQuantity,
      })),
    });
    if (error) {
      setReviewing(false);
      showToast("error", `Importação cancelada sem alterar saldos: ${error.message}`);
    } else {
      setResult(data as ImportResult);
      showToast("success", "Planilha processada em uma única operação segura.");
      await onSuccess(baseId);
    }
    setSaving(false);
  };

  return <div className="modal-layer stock-import-layer" role="dialog" aria-modal="true" aria-labelledby="stock-import-title">
    <button className="modal-backdrop" onClick={() => !saving && onClose()} aria-label="Fechar importação" />
    <section className="stock-import-modal">
      <div className="drawer-head"><div><span className="eyebrow">PLANILHA DE ESTOQUE</span><h2 id="stock-import-title">{result ? "Importação concluída" : reviewing ? "Conferência final" : "Importar lista de itens"}</h2></div><button className="icon-button" type="button" onClick={() => !saving && onClose()} aria-label="Fechar"><X size={20} /></button></div>
      {result ? <div className="batch-result"><span className="batch-result-icon"><CheckCircle2 size={34} /></span><h3>Dados processados com sucesso</h3><p>O lote foi validado e registrado sem atualizações parciais.</p><dl><div><dt>Protocolo</dt><dd>{result.protocol}</dd></div><div><dt>Itens conferidos</dt><dd>{result.item_count}</dd></div><div><dt>Saldos movimentados</dt><dd>{result.movements_created}</dd></div><div><dt>Cadastros atualizados</dt><dd>{result.updated_metadata}</dd></div></dl><div className="modal-actions"><button className="secondary-button" onClick={resetFile}>Importar outra planilha</button><button className="primary-button" onClick={onClose}>Concluir</button></div></div> : reviewing ? <div className="stock-import-review"><div className="stock-movement-guidance"><PackageCheck size={19} /><p>O banco validará novamente todos os {rows.length} itens. Se uma linha estiver incorreta ou o saldo tiver mudado, nenhuma alteração será aplicada.</p></div><div className="batch-summary"><span><small>Operação</small><strong>{mode === "inventario" ? "Inventário físico" : movementLabels[movementType]}</strong></span><span><small>UTD</small><strong>{bases.find((base) => base.id === baseId)?.name}</strong></span><span><small>Arquivo</small><strong title={filename}>{filename}</strong></span><span><small>Itens</small><strong>{rows.length}</strong></span></div><div className="import-review-stats"><span><strong>{projected.filter((row) => row.delta !== 0).length}</strong> saldos alterados</span><span><strong>{projected.filter((row) => row.delta === 0).length}</strong> sem divergência</span><span><strong>{projected.filter((row) => row.location || row.minimumQuantity !== null).length}</strong> com dados de endereço/mínimo</span></div><div className="modal-actions"><button className="secondary-button" onClick={() => setReviewing(false)} disabled={saving}>Voltar e revisar</button><button className="primary-button" onClick={() => void confirmImport()} disabled={saving}>{saving ? <Loader2 className="spin" size={18} /> : <PackageCheck size={18} />} Confirmar importação</button></div></div> : <div className="stock-import-body">
        <div className="import-mode-grid"><button type="button" className={mode === "inventario" ? "active" : ""} onClick={() => { setMode("inventario"); resetFile(); }}><FileSpreadsheet size={22} /><span><strong>Inventário físico</strong><small>Compara a contagem e ajusta o saldo para o valor informado.</small></span></button><button type="button" className={mode === "movimentacao" ? "active" : ""} onClick={() => { setMode("movimentacao"); resetFile(); }}><Upload size={22} /><span><strong>Movimentação por planilha</strong><small>Aplica entrada, saída ou ajuste com a quantidade de cada linha.</small></span></button></div>
        <div className="form-grid three import-settings"><label>UTD<select value={baseId} onChange={(event) => { setBaseId(event.target.value); setReviewing(false); }}>{bases.filter((base) => base.is_active).map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label><label>Data<input type="date" value={movementDate} onChange={(event) => setMovementDate(event.target.value)} /></label>{mode === "movimentacao" ? <label>Tipo<select value={movementType} onChange={(event) => setMovementType(event.target.value as MovementType)}><option value="entrada">Entrada</option><option value="saida">Saída</option><option value="ajuste_positivo">Ajuste positivo</option><option value="ajuste_negativo">Ajuste negativo</option></select></label> : <label>Comportamento<input value="Saldo final = quantidade contada" disabled /></label>}<label>Referência<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} placeholder="Ex.: Inventário agosto/2026" /></label><label className="span-two">Observação<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Informação complementar (opcional)" /></label></div>
        <div className={`import-dropzone ${filename ? "has-file" : ""}`}><span className="import-file-icon">{parsing ? <Loader2 className="spin" size={27} /> : <FileSpreadsheet size={27} />}</span><div><strong>{filename || "Selecione sua planilha"}</strong><small>{filename ? `${rows.length} linhas identificadas` : "Formatos aceitos: XLSX, XLS e CSV · até 500 itens"}</small></div><label className="primary-button"><Upload size={17} /> {filename ? "Trocar arquivo" : "Escolher arquivo"}<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void readFile(event)} disabled={parsing} /></label><button type="button" className="text-button" onClick={() => downloadTemplate(mode)}><Download size={16} /> Baixar modelo</button></div>
        {fileErrors.length > 0 && <div className="import-errors"><TriangleAlert size={19} /><div>{fileErrors.map((error) => <p key={error}>{error}</p>)}</div></div>}
        {rows.length > 0 && <div className="import-preview"><div className="import-preview-head"><div><strong>Pré-validação</strong><small>{invalidRows.length > 0 ? `${invalidRows.length} linhas precisam de correção` : `${rows.length} linhas prontas para importar`}</small></div><span className={invalidRows.length ? "invalid" : "valid"}>{invalidRows.length ? "Revisar arquivo" : "Arquivo válido"}</span></div><div className="import-table"><div className="import-row import-row-head"><span>Linha</span><span>Material</span><span>Quantidade</span><span>Saldo previsto</span><span>Validação</span></div>{visibleRows.map((row) => <div className={`import-row ${row.error ? "has-error" : ""}`} key={row.rowNumber}><span data-label="Linha">{row.rowNumber}</span><span data-label="Material"><strong>{row.code || "—"}</strong><small>{row.material?.name || "Material não identificado"}</small></span><span data-label="Quantidade">{row.quantity === null ? "—" : formatQuantity(row.quantity)}</span><span data-label="Saldo previsto">{row.error ? "—" : `${formatQuantity(row.current)} → ${formatQuantity(row.after)}`}</span><span data-label="Validação">{row.error || (row.delta === 0 ? "Sem divergência" : row.delta > 0 ? `+${formatQuantity(row.delta)}` : formatQuantity(row.delta))}</span></div>)}</div>{(invalidRows.length > 120 || (!invalidRows.length && rows.length > 120)) && <p className="import-preview-limit">Exibindo 120 de {invalidRows.length || rows.length} linhas. Todas serão validadas na confirmação.</p>}</div>}
        <div className="atomic-note"><PackageCheck size={19} /><span><strong>Importação atômica.</strong> Se qualquer item falhar, nenhum saldo, endereço ou mínimo será alterado.</span></div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={() => setReviewing(true)} disabled={!canReview}><CheckCircle2 size={18} /> Revisar importação</button></div>
      </div>}
    </section>
  </div>;
}
