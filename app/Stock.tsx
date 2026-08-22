"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import jsQR from "jsqr";
import { normalizeScannedCode } from "./domain";
import { Pagination } from "./Pagination";
import StockImportModal from "./StockImportModal";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ChevronDown,
  ClipboardList,
  Camera,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  MapPin,
  PackageCheck,
  Plus,
  QrCode,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  Trash2,
  X,
} from "lucide-react";

type Role = "consulta" | "almoxarife" | "aprovador" | "administrador" | "eletricista";

type Base = {
  id: string;
  name: string;
  abbreviation: string | null;
  city: string | null;
  state: string | null;
  is_active: boolean;
};

type Category = { id: string; code: string; name: string; is_active: boolean };

type Material = {
  id: string;
  internal_code: string;
  name: string;
  category_id: string;
  unit_of_measure: string;
  status: string;
};

type StockItem = {
  id: string;
  base_id: string;
  material_id: string;
  current_quantity: number;
  reserved_quantity: number;
  minimum_quantity: number;
  location: string | null;
  is_active: boolean;
  updated_at: string;
};

type StockMovement = {
  id: string;
  stock_item_id: string;
  base_id: string;
  material_id: string;
  movement_type: "entrada" | "saida" | "ajuste_positivo" | "ajuste_negativo";
  quantity: number;
  effect_quantity: number;
  balance_before: number;
  balance_after: number;
  document_reference: string | null;
  notes: string | null;
  request_id: string | null;
  created_by: string;
  created_at: string;
};

type BatchItem = { material_id: string; quantity: string; scanned: boolean };
type BatchResult = {
  batch_id: string;
  protocol: string;
  item_count: number;
  movement_date: string;
  created_by: string;
  created_at: string;
};

const movementLabels: Record<StockMovement["movement_type"], string> = {
  entrada: "Entrada",
  saida: "Saída",
  ajuste_positivo: "Ajuste +",
  ajuste_negativo: "Ajuste −",
};

const unitLabels: Record<string, string> = {
  unidade: "un",
  par: "par",
  caixa: "cx",
  pacote: "pct",
  kit: "kit",
  outro: "un",
};

function quantity(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(value));
}

function movementDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function localDate() {
  const value = new Date();
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 10);
}

function ScannerModal({ onClose, onRead }: { onClose: () => void; onRead: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onReadRef = useRef(onRead);
  const [manualCode, setManualCode] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => { onReadRef.current = onRead; }, [onRead]);
  useEffect(() => {
    document.documentElement.dataset.scannerOpen = "true";
    return () => { delete document.documentElement.dataset.scannerOpen; };
  }, []);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let lastScan = 0;
    let active = true;
    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera-unavailable");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (!active || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        const Detector = (window as typeof window & { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
        const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
        const scan = async (timestamp = 0) => {
          if (!active || !videoRef.current) return;
          if (timestamp - lastScan < 160) { frame = requestAnimationFrame((next) => void scan(next)); return; }
          lastScan = timestamp;
          try {
            if (detector) {
              const codes = await detector.detect(videoRef.current);
              if (codes[0]?.rawValue) { onReadRef.current(codes[0].rawValue); return; }
            } else if (canvasRef.current && videoRef.current.videoWidth > 0) {
              const canvas = canvasRef.current;
              const scale = Math.min(1, 720 / videoRef.current.videoWidth);
              canvas.width = Math.round(videoRef.current.videoWidth * scale);
              canvas.height = Math.round(videoRef.current.videoHeight * scale);
              const context = canvas.getContext("2d", { willReadFrequently: true });
              context?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
              const image = context?.getImageData(0, 0, canvas.width, canvas.height);
              const code = image ? jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" }) : null;
              if (code?.data) { onReadRef.current(code.data); return; }
            }
          } catch { /* Quadros sem leitura são esperados. */ }
          frame = requestAnimationFrame((next) => void scan(next));
        };
        frame = requestAnimationFrame((timestamp) => void scan(timestamp));
      } catch { setCameraError("Não foi possível acessar a câmera. Libere a permissão ou use o código manual."); }
    };
    void startCamera();
    return () => { active = false; cancelAnimationFrame(frame); stream?.getTracks().forEach((track) => track.stop()); };
  }, []);

  return <div className="modal-layer scanner-layer" role="dialog" aria-modal="true" aria-label="Leitor de QR Code"><button className="modal-backdrop" onClick={onClose} aria-label="Fechar leitor" /><section className="scanner-modal"><header className="scanner-head"><div><span className="eyebrow">MOVIMENTAÇÃO EM MASSA</span><h2>Escanear material</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button></header><div className="scanner-viewport"><video ref={videoRef} autoPlay playsInline muted /><canvas ref={canvasRef} aria-hidden="true" /><span className="scanner-frame" aria-hidden="true" />{!cameraReady && !cameraError && <div className="scanner-loading"><Loader2 className="spin" size={26} /><span>Preparando câmera…</span></div>}</div><p className={`scanner-message ${cameraError ? "error" : ""}`}>{cameraError || "Posicione a etiqueta dentro da área destacada."}</p><form className="scanner-manual" onSubmit={(event) => { event.preventDefault(); if (manualCode.trim()) onRead(manualCode); }}><label>Código manual<input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Ex.: 452656" /></label><button className="secondary-button" disabled={!manualCode.trim()}><Search size={17} /> Localizar</button></form></section></div>;
}

export default function Stock({
  supabase,
  profile,
  bases,
  materials,
  categories,
  showToast,
}: {
  supabase: SupabaseClient;
  profile: { id: string; role: Role; display_name?: string | null; email?: string | null };
  bases: Base[];
  materials: Material[];
  categories: Category[];
  showToast: (kind: "success" | "error", message: string) => void;
}) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState(bases[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [stockPage, setStockPage] = useState(1);
  const [stockPageSize, setStockPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [batchReview, setBatchReview] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [batchSearch, setBatchSearch] = useState("");
  const [batchForm, setBatchForm] = useState({
    base_id: bases[0]?.id ?? "",
    movement_date: localDate(),
    movement_type: "entrada" as StockMovement["movement_type"],
    document_reference: "",
    notes: "",
  });
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [form, setForm] = useState({
    base_id: bases[0]?.id ?? "",
    material_id: "",
    movement_type: "entrada" as StockMovement["movement_type"],
    quantity: "",
    document_reference: "",
    notes: "",
  });

  const canMove = profile.role === "almoxarife" || profile.role === "administrador";
  const activeBases = useMemo(() => bases.filter((base) => base.is_active), [bases]);
  const activeMaterials = useMemo(() => materials.filter((material) => material.status === "ativo"), [materials]);
  const materialById = useMemo(() => new Map(materials.map((item) => [item.id, item])), [materials]);
  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item.name])), [categories]);
  const stockByMaterial = useMemo(() => new Map(items.filter((item) => item.base_id === batchForm.base_id).map((item) => [item.material_id, item])), [batchForm.base_id, items]);
  const batchMatches = useMemo(() => {
    const term = batchSearch.trim().toLocaleLowerCase("pt-BR");
    if (!term) return [];
    return activeMaterials.filter((material) => !batchItems.some((item) => item.material_id === material.id) && (material.internal_code.toLocaleLowerCase("pt-BR").includes(term) || material.name.toLocaleLowerCase("pt-BR").includes(term))).slice(0, 6);
  }, [activeMaterials, batchItems, batchSearch]);

  const loadStock = useCallback(async () => {
    setLoading(true);
    const [itemsResult, movementsResult] = await Promise.all([
      supabase
        .from("stock_items")
        .select("id,base_id,material_id,current_quantity,reserved_quantity,minimum_quantity,location,is_active,updated_at")
        .in("base_id", activeBases.map((base) => base.id))
        .order("updated_at", { ascending: false }),
      supabase
        .from("stock_movements")
        .select("id,stock_item_id,base_id,material_id,movement_type,quantity,effect_quantity,balance_before,balance_after,document_reference,notes,request_id,created_by,created_at")
        .in("base_id", activeBases.map((base) => base.id))
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const error = itemsResult.error || movementsResult.error;
    if (error) showToast("error", `Não foi possível carregar o estoque: ${error.message}`);
    else {
      setItems((itemsResult.data ?? []) as StockItem[]);
      setMovements((movementsResult.data ?? []) as StockMovement[]);
    }
    setLoading(false);
  }, [activeBases, showToast, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!selectedBaseId && activeBases[0]) setSelectedBaseId(activeBases[0].id);
      if (!form.base_id && activeBases[0]) setForm((current) => ({ ...current, base_id: activeBases[0].id }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeBases, form.base_id, selectedBaseId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStock(), 0);
    return () => window.clearTimeout(timer);
  }, [loadStock]);

  const baseItems = items.filter((item) => item.base_id === selectedBaseId && item.is_active);
  const visibleItems = baseItems.filter((item) => {
    const material = materialById.get(item.material_id);
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return !term || material?.internal_code.toLocaleLowerCase("pt-BR").includes(term) || material?.name.toLocaleLowerCase("pt-BR").includes(term) || item.location?.toLocaleLowerCase("pt-BR").includes(term);
  });
  const stockPageCount = Math.max(1, Math.ceil(visibleItems.length / stockPageSize));
  const safeStockPage = Math.min(stockPage, stockPageCount);
  const pagedItems = visibleItems.slice((safeStockPage - 1) * stockPageSize, safeStockPage * stockPageSize);
  const baseMovements = movements.filter((item) => item.base_id === selectedBaseId);
  const totalBalance = baseItems.reduce((sum, item) => sum + Number(item.current_quantity), 0);
  const zeroCount = baseItems.filter((item) => Number(item.current_quantity) === 0).length;
  const lowCount = baseItems.filter((item) => Number(item.minimum_quantity) > 0 && Number(item.current_quantity) <= Number(item.minimum_quantity)).length;

  const openMovement = () => {
    setForm((current) => ({ ...current, base_id: selectedBaseId || activeBases[0]?.id || "" }));
    setMovementOpen(true);
  };

  const submitMovement = async (event: FormEvent) => {
    event.preventDefault();
    const numericQuantity = Number(form.quantity.replace(",", "."));
    if (!form.base_id || !form.material_id || !Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      showToast("error", "Selecione a UTD, o material e informe uma quantidade válida.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.rpc("register_stock_movement", {
      p_base_id: form.base_id,
      p_material_id: form.material_id,
      p_movement_type: form.movement_type,
      p_quantity: numericQuantity,
      p_document_reference: form.document_reference.trim() || null,
      p_notes: form.notes.trim() || null,
    });

    if (error) showToast("error", error.message);
    else {
      setSelectedBaseId(form.base_id);
      setForm((current) => ({ ...current, material_id: "", quantity: "", document_reference: "", notes: "" }));
      setMovementOpen(false);
      showToast("success", `${movementLabels[form.movement_type]} registrada e saldo atualizado.`);
      await loadStock();
    }
    setSaving(false);
  };

  const resetBatch = (baseId = selectedBaseId || activeBases[0]?.id || "") => {
    setBatchForm({ base_id: baseId, movement_date: localDate(), movement_type: "entrada", document_reference: "", notes: "" });
    setBatchItems([]);
    setBatchSearch("");
    setBatchReview(false);
    setBatchResult(null);
  };

  const openBatch = () => {
    resetBatch();
    setBatchOpen(true);
  };

  const addBatchMaterial = (materialId: string, scanned = false) => {
    const material = materialById.get(materialId);
    if (!material) return;
    if (batchItems.length >= 100 && !batchItems.some((item) => item.material_id === materialId)) {
      showToast("error", "O limite por lote é de 100 materiais.");
      return;
    }
    setBatchItems((current) => {
      const existing = current.find((item) => item.material_id === materialId);
      if (existing) return current.map((item) => item.material_id === materialId ? { ...item, scanned: item.scanned || scanned } : item);
      return [...current, { material_id: materialId, quantity: "1", scanned }];
    });
    setBatchSearch("");
    setBatchReview(false);
  };

  const readBatchCode = (rawValue: string) => {
    const code = normalizeScannedCode(rawValue).toLocaleLowerCase("pt-BR");
    const material = activeMaterials.find((item) => item.internal_code.toLocaleLowerCase("pt-BR") === code);
    if (!material) { showToast("error", `Nenhum material ativo encontrado para o código ${code}.`); return; }
    addBatchMaterial(material.id, true);
    setScannerOpen(false);
    showToast("success", `${material.internal_code} adicionado ao lote.`);
  };

  const batchProjection = batchItems.map((entry) => {
    const material = materialById.get(entry.material_id);
    const stock = stockByMaterial.get(entry.material_id);
    const amount = Number(entry.quantity.replace(",", "."));
    const current = Number(stock?.current_quantity ?? 0);
    const reserved = Number(stock?.reserved_quantity ?? 0);
    const positive = batchForm.movement_type === "entrada" || batchForm.movement_type === "ajuste_positivo";
    const after = current + (positive ? amount : -amount);
    const error = !Number.isFinite(amount) || amount <= 0 ? "Quantidade inválida" : !positive && after < 0 ? `Saldo insuficiente: ${quantity(current)}` : after < reserved ? `Reserva mínima: ${quantity(reserved)}` : stock && !stock.is_active ? "Item de estoque inativo" : null;
    return { entry, material, current, reserved, after, error };
  });
  const batchHasErrors = batchProjection.some((item) => item.error);

  const reviewBatch = (event: FormEvent) => {
    event.preventDefault();
    if (!batchForm.base_id || !batchForm.movement_date || batchItems.length === 0) { showToast("error", "Informe a UTD, a data e inclua pelo menos um material."); return; }
    if (batchHasErrors) { showToast("error", "Corrija os itens destacados antes de revisar o lote."); return; }
    setBatchReview(true);
  };

  const submitBatch = async () => {
    if (batchHasErrors || batchItems.length === 0) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("register_stock_movements_batch", {
      p_base_id: batchForm.base_id,
      p_movement_date: batchForm.movement_date,
      p_movement_type: batchForm.movement_type,
      p_document_reference: batchForm.document_reference.trim() || null,
      p_notes: batchForm.notes.trim() || null,
      p_items: batchItems.map((item) => ({ material_id: item.material_id, quantity: Number(item.quantity.replace(",", ".")) })),
    });
    if (error) {
      setBatchReview(false);
      showToast("error", `Lote cancelado sem movimentar itens: ${error.message}`);
    } else {
      setBatchResult(data as BatchResult);
      setSelectedBaseId(batchForm.base_id);
      showToast("success", "Todos os itens do lote foram processados com segurança.");
      await loadStock();
    }
    setSaving(false);
  };

  return (
    <div className="page-stack stock-page">
      <section className="page-heading stock-heading">
        <div>
          <span className="eyebrow">ESTOQUE · BETA</span>
          <h1>Saldos por UTD</h1>
          <p>Consulte a disponibilidade e acompanhe cada entrada, saída e ajuste com histórico rastreável.</p>
        </div>
        <div className="stock-heading-actions">
          <button className="icon-button" onClick={() => void loadStock()} disabled={loading} aria-label="Atualizar estoque" title="Atualizar estoque"><RefreshCcw className={loading ? "spin" : ""} size={19} /></button>
        </div>
      </section>

      <section className="stock-scope panel" aria-label="UTD consultada">
        <div className="stock-scope-copy"><span><MapPin size={18} /></span><div><small>VISUALIZANDO</small><strong>{activeBases.find((base) => base.id === selectedBaseId)?.name || "Selecione uma UTD"}</strong></div></div>
        <label className="stock-base-select">UTD<select value={selectedBaseId} onChange={(event) => { setSelectedBaseId(event.target.value); setStockPage(1); }}>{activeBases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select><ChevronDown size={16} /></label>
      </section>

      {canMove && <section className="stock-actions-panel" aria-label="Ações do estoque">
        <div className="stock-actions-copy"><span className="eyebrow">COMO DESEJA ATUALIZAR?</span><h2>Escolha o fluxo mais rápido para a tarefa</h2><p>As opções mantêm histórico, responsável e validação de saldo.</p></div>
        <div className="stock-action-grid">
          <button type="button" onClick={openMovement}><span className="stock-action-icon quick"><Plus size={21} /></span><span><strong>Registrar 1 item</strong><small>Entrada, saída ou ajuste rápido.</small></span><em>Rápido</em></button>
          <button type="button" onClick={openBatch}><span className="stock-action-icon batch"><Boxes size={21} /></span><span><strong>Movimentar vários</strong><small>Pesquisa, código ou leitura de QR Code.</small></span><em>Até 100</em></button>
          <button type="button" onClick={() => setImportOpen(true)}><span className="stock-action-icon sheet"><FileSpreadsheet size={21} /></span><span><strong>Importar planilha</strong><small>Inventário ou movimentação em lista.</small></span><em>Até 500</em></button>
        </div>
      </section>}

      <section className="stock-metrics" aria-label="Resumo do estoque">
        <article><span className="stock-metric-icon blue"><Boxes size={21} /></span><div><small>Itens vinculados</small><strong>{baseItems.length}</strong><em>SKUs nesta UTD</em></div></article>
        <article><span className="stock-metric-icon green"><PackageCheck size={21} /></span><div><small>Saldo somado</small><strong>{quantity(totalBalance)}</strong><em>todas as unidades</em></div></article>
        <article><span className="stock-metric-icon amber"><TriangleAlert size={21} /></span><div><small>Abaixo do mínimo</small><strong>{lowCount}</strong><em>pedem atenção</em></div></article>
        <article><span className="stock-metric-icon red"><ArrowDownToLine size={21} /></span><div><small>Saldo zerado</small><strong>{zeroCount}</strong><em>sem disponibilidade</em></div></article>
      </section>

      <section className="stock-layout">
        <article className="panel stock-balance-panel">
          <div className="panel-heading stock-panel-heading"><div><span className="eyebrow">POSIÇÃO ATUAL</span><h2>Materiais da UTD</h2></div><div className="stock-search"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setStockPage(1); }} placeholder="Código, descrição ou local" aria-label="Pesquisar no estoque" /></div></div>
          {loading ? <div className="section-loading"><Loader2 className="spin" size={25} /><span>Carregando saldos</span></div> : visibleItems.length === 0 ? <div className="stock-empty"><Boxes size={28} /><h3>Nenhum item nesta visualização</h3><p>{search ? "Tente outro código ou descrição." : canMove ? "Registre a primeira entrada para vincular um material a esta UTD." : "Ainda não há saldos cadastrados para esta UTD."}</p></div> : <><div className="stock-table-wrap"><div className="stock-table-head"><span>Material</span><span>Local</span><span>Saldo</span><span>Mínimo</span><span>Situação</span></div>{pagedItems.map((item) => {
            const material = materialById.get(item.material_id);
            const current = Number(item.current_quantity);
            const minimum = Number(item.minimum_quantity);
            const status = current === 0 ? "zerado" : minimum > 0 && current <= minimum ? "baixo" : "normal";
            return <div className="stock-row" key={item.id}><div className="stock-material"><span><Boxes size={18} /></span><div><strong>{material?.internal_code || "—"} · {material?.name || "Material"}</strong><small>{categoryById.get(material?.category_id || "") || "Sem categoria"}</small></div></div><span className="stock-location">{item.location || "Não definido"}</span><strong className="stock-balance">{quantity(current)} <small>{unitLabels[material?.unit_of_measure || ""] || material?.unit_of_measure}</small></strong><span>{quantity(minimum)}</span><em className={`stock-status stock-${status}`}>{status === "zerado" ? "Zerado" : status === "baixo" ? "Estoque baixo" : "Disponível"}</em></div>;
          })}</div><Pagination page={safeStockPage} pageSize={stockPageSize} total={visibleItems.length} noun="materiais" pageSizeOptions={[10, 25, 50]} onPageChange={setStockPage} onPageSizeChange={(value) => { setStockPageSize(value); setStockPage(1); }} /></>}
        </article>

        <aside className="panel stock-history-panel">
          <div className="panel-heading"><div><span className="eyebrow">RASTREABILIDADE</span><h2>Últimas movimentações</h2></div><ClipboardList size={20} /></div>
          {baseMovements.length === 0 ? <div className="stock-history-empty"><SlidersHorizontal size={25} /><p>Nenhuma movimentação registrada nesta UTD.</p></div> : <div className="stock-history-list">{baseMovements.slice(0, 12).map((movement) => {
            const material = materialById.get(movement.material_id);
            const positive = Number(movement.effect_quantity) > 0;
            return <article key={movement.id}><span className={`movement-icon ${positive ? "positive" : "negative"}`}>{positive ? <ArrowDownToLine size={17} /> : <ArrowUpFromLine size={17} />}</span><div><div><strong>{movement.request_id ? "Saída por requisição" : movementLabels[movement.movement_type]}</strong><em className={positive ? "positive" : "negative"}>{positive ? "+" : "−"}{quantity(movement.quantity)}</em></div><p>{material?.internal_code} · {material?.name}</p><small>{movementDate(movement.created_at)} · saldo {quantity(movement.balance_after)}{movement.document_reference ? ` · ${movement.document_reference}` : ""}</small></div></article>;
          })}</div>}
        </aside>
      </section>

      {!canMove && <section className="stock-readonly-note"><PackageCheck size={19} /><div><strong>Visualização protegida</strong><span>Seu perfil pode consultar os saldos autorizados, mas não registrar movimentações.</span></div></section>}

      {movementOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="stock-movement-title"><button className="modal-backdrop" onClick={() => setMovementOpen(false)} aria-label="Fechar" /><form className="stock-movement-modal" onSubmit={submitMovement}><div className="drawer-head"><div><span className="eyebrow">NOVA MOVIMENTAÇÃO</span><h2 id="stock-movement-title">Atualizar saldo</h2></div><button className="icon-button" type="button" onClick={() => setMovementOpen(false)} aria-label="Fechar"><X size={20} /></button></div><div className="stock-movement-guidance"><Boxes size={19} /><p>A movimentação será gravada no histórico com seu usuário, data, saldo anterior e saldo final.</p></div><div className="form-grid two"><label>UTD<select value={form.base_id} onChange={(event) => setForm({ ...form, base_id: event.target.value })} required>{activeBases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label><label>Tipo<select value={form.movement_type} onChange={(event) => setForm({ ...form, movement_type: event.target.value as StockMovement["movement_type"] })}><option value="entrada">Entrada</option><option value="saida">Saída</option><option value="ajuste_positivo">Ajuste positivo</option><option value="ajuste_negativo">Ajuste negativo</option></select></label><label className="full-field">Material<select value={form.material_id} onChange={(event) => setForm({ ...form, material_id: event.target.value })} required><option value="">Selecione pelo código ou descrição</option>{activeMaterials.map((material) => <option key={material.id} value={material.id}>{material.internal_code} — {material.name}</option>)}</select></label><label>Quantidade<input inputMode="decimal" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} placeholder="Ex.: 10" required /></label><label>Documento / referência<input value={form.document_reference} onChange={(event) => setForm({ ...form, document_reference: event.target.value })} maxLength={120} placeholder="NF, requisição ou OS" /></label><label className="full-field">Observação<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={1000} rows={3} placeholder="Motivo do ajuste ou informação complementar" /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setMovementOpen(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? <Loader2 className="spin" size={18} /> : <PackageCheck size={18} />} Confirmar movimentação</button></div></form></div>}

      {batchOpen && <div className="modal-layer stock-batch-layer" role="dialog" aria-modal="true" aria-labelledby="stock-batch-title"><button className="modal-backdrop" onClick={() => !saving && setBatchOpen(false)} aria-label="Fechar" /><section className="stock-batch-modal"><div className="drawer-head"><div><span className="eyebrow">MOVIMENTAÇÃO EM MASSA</span><h2 id="stock-batch-title">{batchResult ? "Lote concluído" : batchReview ? "Revise antes de confirmar" : "Montar lote de materiais"}</h2></div><button className="icon-button" type="button" onClick={() => !saving && setBatchOpen(false)} aria-label="Fechar"><X size={20} /></button></div>
        {batchResult ? <div className="batch-result"><span className="batch-result-icon"><CheckCircle2 size={34} /></span><h3>Movimentação concluída</h3><p>Os {batchResult.item_count} itens foram atualizados na mesma operação.</p><dl><div><dt>Protocolo único</dt><dd>{batchResult.protocol}</dd></div><div><dt>Responsável</dt><dd>{profile.display_name || profile.email || "Usuário autenticado"}</dd></div><div><dt>Data do lote</dt><dd>{new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${batchResult.movement_date}T12:00:00Z`))}</dd></div><div><dt>Registrado em</dt><dd>{movementDate(batchResult.created_at)}</dd></div></dl><div className="modal-actions"><button className="secondary-button" onClick={() => { resetBatch(batchForm.base_id); }}>Novo lote</button><button className="primary-button" onClick={() => setBatchOpen(false)}>Concluir</button></div></div> : batchReview ? <div className="batch-review"><div className="stock-movement-guidance"><CheckCircle2 size={19} /><p>Todos os saldos foram validados. O banco repetirá a validação no instante da confirmação e, se algum item falhar, nenhum será movimentado.</p></div><div className="batch-summary"><span><small>UTD</small><strong>{activeBases.find((base) => base.id === batchForm.base_id)?.name}</strong></span><span><small>Data</small><strong>{new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${batchForm.movement_date}T12:00:00Z`))}</strong></span><span><small>Tipo</small><strong>{movementLabels[batchForm.movement_type]}</strong></span><span><small>Itens</small><strong>{batchItems.length}</strong></span></div><div className="batch-review-list">{batchProjection.map(({ entry, material, current, after }) => <article key={entry.material_id}><div><strong>{material?.internal_code} · {material?.name}</strong><small>Saldo {quantity(current)} → {quantity(after)} {unitLabels[material?.unit_of_measure || ""]}</small></div><b>{quantity(Number(entry.quantity.replace(",", ".")))}</b></article>)}</div>{batchForm.document_reference && <p className="batch-reference"><strong>Referência:</strong> {batchForm.document_reference}</p>}<div className="modal-actions"><button className="secondary-button" onClick={() => setBatchReview(false)} disabled={saving}>Voltar e editar</button><button className="primary-button" onClick={() => void submitBatch()} disabled={saving}>{saving ? <Loader2 className="spin" size={18} /> : <PackageCheck size={18} />} Confirmar lote atômico</button></div></div> : <form onSubmit={reviewBatch}><div className="batch-form-body"><div className="form-grid two"><label>UTD<select value={batchForm.base_id} onChange={(event) => { setBatchForm({ ...batchForm, base_id: event.target.value }); setBatchReview(false); }} required>{activeBases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label><label>Data da movimentação<input type="date" value={batchForm.movement_date} onChange={(event) => setBatchForm({ ...batchForm, movement_date: event.target.value })} required /></label><label>Tipo<select value={batchForm.movement_type} onChange={(event) => { setBatchForm({ ...batchForm, movement_type: event.target.value as StockMovement["movement_type"] }); setBatchReview(false); }}><option value="entrada">Entrada</option><option value="saida">Saída</option><option value="ajuste_positivo">Ajuste positivo</option><option value="ajuste_negativo">Ajuste negativo</option></select></label><label>Referência do lote<input value={batchForm.document_reference} onChange={(event) => setBatchForm({ ...batchForm, document_reference: event.target.value })} maxLength={120} placeholder="NF, OS ou requisição" /></label></div><div className="batch-add"><div><label>Pesquisar por código ou descrição<div className="batch-search-input"><Search size={17} /><input value={batchSearch} onChange={(event) => setBatchSearch(event.target.value)} placeholder="Digite para localizar um material" /></div></label>{batchMatches.length > 0 && <div className="batch-search-results">{batchMatches.map((material) => <button type="button" key={material.id} onClick={() => addBatchMaterial(material.id)}><strong>{material.internal_code}</strong><span>{material.name}</span><Plus size={16} /></button>)}</div>}</div><button type="button" className="scan-button" onClick={() => setScannerOpen(true)}><Camera size={19} /> Ler QR Code</button></div><div className="batch-items"><div className="batch-items-head"><strong>Materiais do lote</strong><span>{batchItems.length}/100</span></div>{batchItems.length === 0 ? <div className="stock-empty compact"><QrCode size={28} /><h3>Nenhum material incluído</h3><p>Pesquise pelo código ou leia uma etiqueta.</p></div> : batchProjection.map(({ entry, material, current, after, error }) => <article className={error ? "has-error" : ""} key={entry.material_id}><span className={`request-item-icon ${entry.scanned ? "scanned" : ""}`}>{entry.scanned ? <QrCode size={20} /> : <Boxes size={20} />}</span><div><strong>{material?.internal_code} · {material?.name}</strong><small>{error || `Saldo previsto: ${quantity(current)} → ${quantity(after)}`}</small></div><label><span>Quantidade</span><input inputMode="decimal" value={entry.quantity} onChange={(event) => { setBatchItems((currentItems) => currentItems.map((item) => item.material_id === entry.material_id ? { ...item, quantity: event.target.value } : item)); setBatchReview(false); }} /></label><button type="button" className="remove-item" onClick={() => setBatchItems((current) => current.filter((item) => item.material_id !== entry.material_id))} aria-label={`Remover ${material?.name}`}><Trash2 size={18} /></button></article>)}</div><label className="batch-notes">Observação do lote<textarea value={batchForm.notes} onChange={(event) => setBatchForm({ ...batchForm, notes: event.target.value })} maxLength={1000} rows={2} placeholder="Informação complementar (opcional)" /></label><div className="atomic-note"><PackageCheck size={19} /><span><strong>Tudo ou nada.</strong> Se qualquer saldo mudar ou apresentar erro, o lote inteiro será cancelado.</span></div></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setBatchOpen(false)}>Cancelar</button><button className="primary-button" disabled={batchItems.length === 0 || batchHasErrors}><CheckCircle2 size={18} /> Pré-visualizar lote</button></div></form>}
      </section></div>}
      {importOpen && <StockImportModal supabase={supabase} bases={activeBases} materials={activeMaterials} stockItems={items} defaultBaseId={selectedBaseId} showToast={showToast} onClose={() => setImportOpen(false)} onSuccess={async (baseId) => { setSelectedBaseId(baseId); await loadStock(); }} />}
      {scannerOpen && <ScannerModal onClose={() => setScannerOpen(false)} onRead={readBatchCode} />}
    </div>
  );
}
