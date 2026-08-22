"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { QRCodeSVG } from "qrcode.react";
import jsQR from "jsqr";
import { canTransitionRequestStatus, materialLabelPayload, normalizeScannedCode, requestCode } from "./domain";
import { Pagination } from "./Pagination";
import {
  Camera,
  Ban,
  Boxes,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileText,
  Hash,
  History,
  Loader2,
  ListPlus,
  MapPin,
  PackageCheck,
  Printer,
  QrCode,
  Search,
  Save,
  SlidersHorizontal,
  Smartphone,
  Tags,
  TriangleAlert,
  Trash2,
  UploadCloud,
  UserRound,
  Users,
  Warehouse,
  X,
  Ruler,
} from "lucide-react";

type Role = "consulta" | "almoxarife" | "aprovador" | "administrador" | "eletricista";

export type RequisitionProfile = {
  display_name: string | null;
  email: string | null;
  role: Role;
};

export type RequisitionBase = {
  id: string;
  name: string;
  abbreviation: string | null;
  is_active: boolean;
};

export type RequisitionMaterial = {
  id: string;
  internal_code: string;
  name: string;
  category_id: string;
  unit_of_measure: string;
  status: string;
  description: string | null;
  notes: string | null;
};

export type RequisitionCategory = {
  id: string;
  name: string;
  is_active: boolean;
};

export type RequisitionTechnicalItem = {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  status: "ativo" | "arquivado";
};

export type MaterialRequest = {
  id: string;
  request_number: number;
  base_id: string;
  withdrawal_date: string;
  team_number: string | null;
  team_id: string | null;
  participant_one: string;
  participant_two: string | null;
  separator_name: string;
  notes: string | null;
  status: "aberta" | "separada" | "entregue" | "cancelada";
  status_note: string | null;
  stock_reserved_at: string | null;
  stock_posted_at: string | null;
  stock_posted_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type TeamOption = { team_id: string; base_id: string; code: string; name: string; member_ids: string[]; member_names: string[] };
type RequestDocument = { id: string; request_id: string; storage_path: string; file_name: string; mime_type: string; size_bytes: number; uploaded_at: string; status: string };

type RequestStockItem = {
  id: string;
  base_id: string;
  material_id: string;
  current_quantity: number;
  reserved_quantity: number;
  is_active: boolean;
};

type RequestStockReservation = {
  id: string;
  request_id: string;
  request_item_id: string;
  quantity: number;
  status: "ativa" | "consumida" | "liberada";
};

type MaterialRequestStatusHistory = {
  id: string;
  request_id: string;
  from_status: MaterialRequest["status"] | null;
  to_status: MaterialRequest["status"];
  note: string | null;
  changed_by: string | null;
  changed_at: string;
};

type RequestFilters = {
  base_id: string;
  status: "" | MaterialRequest["status"];
  date_from: string;
  date_to: string;
  team: string;
  participant: string;
  separator: string;
};

export type MaterialRequestItem = {
  id: string;
  request_id: string;
  source_type: "material" | "tecnico" | "manual";
  source_id: string | null;
  material_code: string;
  description: string;
  unit_of_measure: string;
  quantity: number;
  scanned: boolean;
  notes: string | null;
};

type CatalogItem = {
  source_type: "material" | "tecnico";
  source_id: string;
  code: string;
  name: string;
  description: string;
  unit: string;
  category: string;
};

export type LabelSeed = Pick<CatalogItem, "source_type" | "source_id">;

type LabelBatch = CatalogItem & {
  copies: number;
};

type LabelSize = "small" | "medium" | "large";

const labelSizes: Record<LabelSize, { label: string; dimensions: string; description: string }> = {
  small: { label: "Compacta", dimensions: "50 × 30 mm", description: "Caixas e gavetas" },
  medium: { label: "Média", dimensions: "70 × 40 mm", description: "Prateleiras" },
  large: { label: "Grande", dimensions: "100 × 60 mm", description: "Volumes maiores" },
};

const MAX_LABELS_PER_PRINT = 120;

function materialCategoryName(material: RequisitionMaterial, categories: RequisitionCategory[]) {
  return categories.find((category) => category.id === material.category_id)?.name || "Materiais cadastrados";
}

function materialUnitLabel(material: RequisitionMaterial) {
  const importedUnit = material.notes?.match(/Unidade original:\s*([^·]+)/i)?.[1]?.trim();
  if (importedUnit) return importedUnit.toUpperCase();
  const labels: Record<string, string> = {
    unidade: "UN",
    par: "PAR",
    caixa: "CX",
    pacote: "PCT",
    kit: "KIT",
    outro: "OUTRO",
  };
  return (labels[material.unit_of_measure] || material.unit_of_measure).toUpperCase();
}

function MaterialQrLabel({
  item,
  size,
  base,
}: {
  item: CatalogItem;
  size: LabelSize;
  base?: RequisitionBase;
}) {
  return (
    <article className={`qr-label qr-label-${size}`} aria-label={`Etiqueta do material ${item.code} ${item.name}`}>
      <div className="qr-label-visual">
        <div className="qr-label-code-frame">
          <QRCodeSVG value={materialLabelPayload(item)} level="M" className="qr-label-code" />
        </div>
        <span className="qr-label-scan"><QrCode /> <b>ESCANEIE PARA REQUISITAR</b></span>
      </div>
      <div className="qr-label-content">
        <header className="qr-label-brand"><span><Warehouse /></span><b>CENTRAL DO<br />ALMOXARIFADO</b></header>
        <div className="qr-label-rule" />
        <div className="qr-label-field qr-label-number"><small>CÓDIGO</small><strong>{item.code}</strong></div>
        <div className="qr-label-field qr-label-description"><small>DESCRIÇÃO</small><span>{item.name}</span></div>
        <footer className="qr-label-meta">
          {base && <span className="qr-label-utd"><MapPin /> <b>{size === "small" ? (base.abbreviation || base.name) : base.name}</b></span>}
          <span className="qr-label-category"><Tags /> <b>{item.category}</b></span>
          <span className="qr-label-unit"><PackageCheck /> <b>{size === "small" ? item.unit : `UNIDADE: ${item.unit}`}</b></span>
        </footer>
      </div>
    </article>
  );
}

type DraftItem = CatalogItem & {
  quantity: number;
  scanned: boolean;
  notes: string;
};

type BarcodeDetectorInstance = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorInstance;

const statusLabels: Record<MaterialRequest["status"], string> = {
  aberta: "Aberta",
  separada: "Separada",
  entregue: "Entregue",
  cancelada: "Cancelada",
};

function localDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${value.slice(0, 10)}T12:00:00Z`),
  );
}

function localDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function ScannerModal({
  onClose,
  onRead,
}: {
  onClose: () => void;
  onRead: (value: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onReadRef = useRef(onRead);
  const [manualCode, setManualCode] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);

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
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (!active || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;

        const scan = async (timestamp = 0) => {
          if (!active || !videoRef.current) return;
          if (timestamp - lastScan < 160) {
            frame = window.requestAnimationFrame((nextTimestamp) => void scan(nextTimestamp));
            return;
          }
          lastScan = timestamp;
          try {
            if (detector) {
              const codes = await detector.detect(videoRef.current);
              if (codes[0]?.rawValue) {
                onReadRef.current(codes[0].rawValue);
                return;
              }
            } else if (canvasRef.current && videoRef.current.videoWidth > 0) {
              const canvas = canvasRef.current;
              const maxWidth = 720;
              const scale = Math.min(1, maxWidth / videoRef.current.videoWidth);
              canvas.width = Math.round(videoRef.current.videoWidth * scale);
              canvas.height = Math.round(videoRef.current.videoHeight * scale);
              const context = canvas.getContext("2d", { willReadFrequently: true });
              context?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
              const image = context?.getImageData(0, 0, canvas.width, canvas.height);
              if (image) {
                const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
                if (code?.data) {
                  onReadRef.current(code.data);
                  return;
                }
              }
            }
          } catch {
            // Quadros sem leitura são esperados enquanto o usuário posiciona o QR.
          }
          frame = window.requestAnimationFrame((nextTimestamp) => void scan(nextTimestamp));
        };
        frame = window.requestAnimationFrame((timestamp) => void scan(timestamp));
      } catch {
        setCameraError("Não foi possível acessar a câmera. Libere a permissão no navegador ou use o código manual.");
      }
    };

    void startCamera();
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    if (manualCode.trim()) onRead(manualCode.trim());
  };

  return (
    <div className="modal-layer scanner-layer" role="dialog" aria-modal="true" aria-label="Leitor de QR Code">
      <button className="modal-backdrop" onClick={onClose} aria-label="Fechar leitor" />
      <section className="scanner-modal">
        <header className="scanner-head">
          <div><span className="eyebrow">LEITURA PELO CELULAR</span><h2>Escanear material</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>
        <div className="scanner-viewport">
          <video ref={videoRef} autoPlay playsInline muted aria-label="Imagem da câmera" />
          <canvas ref={canvasRef} aria-hidden="true" />
          <span className="scanner-frame" aria-hidden="true" />
          {!cameraReady && !cameraError && <div className="scanner-loading"><Loader2 className="spin" size={26} /><span>Preparando câmera…</span></div>}
        </div>
        <p className={`scanner-message ${cameraError ? "error" : ""}`}>
          {cameraError || "Posicione o QR Code dentro da área destacada. Compatível com Android, iPhone e iPad."}
        </p>
        <form className="scanner-manual" onSubmit={submitManual}>
          <label>Código manual<input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Ex.: 452656" inputMode="text" /></label>
          <button className="secondary-button" disabled={!manualCode.trim()}><Search size={17} /> Localizar</button>
        </form>
      </section>
    </div>
  );
}

export default function Requisitions({
  supabase,
  userId,
  profile,
  bases,
  categories,
  materials,
  technicalItems,
  requests,
  requestItems,
  showToast,
  refresh,
  initialLabelSeed,
}: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  profile: RequisitionProfile;
  bases: RequisitionBase[];
  categories: RequisitionCategory[];
  materials: RequisitionMaterial[];
  technicalItems: RequisitionTechnicalItem[];
  requests: MaterialRequest[];
  requestItems: MaterialRequestItem[];
  showToast: (kind: "success" | "error", message: string) => void;
  refresh: () => Promise<void>;
  initialLabelSeed?: LabelSeed | null;
}) {
  const canCreateRequest = profile.role !== "aprovador";
  const canManage = profile.role === "almoxarife" || profile.role === "administrador";
  const displayName = profile.display_name || profile.email || "Almoxarife";
  const [tab, setTab] = useState<"new" | "history" | "labels">(
    canCreateRequest ? (initialLabelSeed && canManage ? "labels" : "new") : "history",
  );
  const [scannerOpen, setScannerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [statusHistory, setStatusHistory] = useState<MaterialRequestStatusHistory[]>([]);
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [deliveryMode, setDeliveryMode] = useState(false);
  const [stockItems, setStockItems] = useState<RequestStockItem[]>([]);
  const [stockReservations, setStockReservations] = useState<RequestStockReservation[]>([]);
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([]);
  const [requestDocuments, setRequestDocuments] = useState<RequestDocument[]>([]);
  const [signedFiles, setSignedFiles] = useState<File[]>([]);
  const [signedConfirmed, setSignedConfirmed] = useState(false);
  const [uploadingSigned, setUploadingSigned] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | null>(null);
  const [printTarget, setPrintTarget] = useState<MaterialRequest | null>(null);
  const [labelsPrintReady, setLabelsPrintReady] = useState(false);
  const [calibrationPrintReady, setCalibrationPrintReady] = useState(false);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [labelSearch, setLabelSearch] = useState("");
  const [labelSize, setLabelSize] = useState<LabelSize>("small");
  const [labelBaseId, setLabelBaseId] = useState(bases[0]?.id ?? "");
  const [bulkCategory, setBulkCategory] = useState("");
  const [labelBatches, setLabelBatches] = useState<LabelBatch[]>(() => {
    if (!initialLabelSeed) return [];
    if (initialLabelSeed.source_type === "material") {
      const item = materials.find((entry) => entry.id === initialLabelSeed.source_id);
      return item ? [{ source_type: "material", source_id: item.id, code: item.internal_code, name: item.name, description: item.description || item.name, unit: materialUnitLabel(item), category: materialCategoryName(item, categories), copies: 1 }] : [];
    }
    const item = technicalItems.find((entry) => entry.id === initialLabelSeed.source_id);
    return item ? [{ source_type: "tecnico", source_id: item.id, code: item.code, name: item.name, description: item.description, unit: "unidade", category: item.category || "Item técnico", copies: 1 }] : [];
  });
  const [form, setForm] = useState({
    base_id: bases[0]?.id ?? "",
    withdrawal_date: new Date().toISOString().slice(0, 10),
    team_number: "",
    team_id: "",
    participant_one: "",
    participant_two: "",
    separator_name: displayName,
    notes: "",
  });
  const [lastSavedSignature, setLastSavedSignature] = useState(() => JSON.stringify({
    form: {
      base_id: bases[0]?.id ?? "",
      withdrawal_date: new Date().toISOString().slice(0, 10),
      team_number: "",
      team_id: "",
      participant_one: "",
      participant_two: "",
      separator_name: displayName,
      notes: "",
    },
    draftItems: [],
  }));
  const [filters, setFilters] = useState<RequestFilters>({
    base_id: "",
    status: "",
    date_from: "",
    date_to: "",
    team: "",
    participant: "",
    separator: "",
  });
  const draftLoaded = useRef(false);

  const draftSignature = JSON.stringify({ form, draftItems });
  const hasMeaningfulDraft = draftItems.length > 0 || Boolean(
    form.team_number.trim() || form.participant_one.trim() || form.participant_two.trim() || form.notes.trim(),
  );
  const draftDirty = hasMeaningfulDraft && draftSignature !== lastSavedSignature;

  const loadStatusHistory = useCallback(async () => {
    const { data, error } = await supabase
      .from("material_request_status_history")
      .select("*")
      .order("changed_at", { ascending: true });
    if (!error) setStatusHistory((data ?? []) as MaterialRequestStatusHistory[]);
  }, [supabase]);

  const loadRequestStock = useCallback(async () => {
    const [itemsResult, reservationsResult] = await Promise.all([
      supabase
        .from("stock_items")
        .select("id,base_id,material_id,current_quantity,reserved_quantity,is_active"),
      supabase
        .from("stock_reservations")
        .select("id,request_id,request_item_id,quantity,status"),
    ]);
    if (!itemsResult.error) setStockItems((itemsResult.data ?? []) as RequestStockItem[]);
    if (!reservationsResult.error) setStockReservations((reservationsResult.data ?? []) as RequestStockReservation[]);
  }, [supabase]);

  const loadDocuments = useCallback(async () => {
    const { data, error } = await supabase.from("material_request_documents").select("id,request_id,storage_path,file_name,mime_type,size_bytes,uploaded_at,status").eq("status", "ativo").order("uploaded_at", { ascending: false });
    if (!error) setRequestDocuments((data ?? []) as RequestDocument[]);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStatusHistory(), 0);
    return () => window.clearTimeout(timer);
  }, [loadStatusHistory]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRequestStock(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRequestStock]);

  useEffect(() => { void loadDocuments(); }, [loadDocuments]);

  useEffect(() => {
    if (!form.base_id) { setTeamOptions([]); return; }
    void supabase.rpc("request_team_options", { p_base_id: form.base_id }).then(({ data, error }) => {
      if (error) { setTeamOptions([]); return; }
      const options = (data ?? []) as TeamOption[];
      setTeamOptions(options);
      if (options.length === 1 && !form.team_id) {
        const team = options[0];
        setForm((current) => ({ ...current, team_id: team.team_id, team_number: team.code, participant_one: team.member_names[0] ?? "", participant_two: team.member_names[1] ?? "" }));
      }
    });
  }, [form.base_id, form.team_id, supabase]);

  useEffect(() => {
    if (draftLoaded.current || !userId) return;
    draftLoaded.current = true;
    const loadDraft = async () => {
      const { data, error } = await supabase
        .from("material_request_drafts")
        .select("form_data, items, updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data) return;
      const savedForm = data.form_data as typeof form;
      const savedItems = Array.isArray(data.items) ? data.items as DraftItem[] : [];
      if (!savedForm || typeof savedForm !== "object") return;
      const restoredForm = {
        ...form,
        ...savedForm,
        base_id: bases.some((base) => base.id === savedForm.base_id) ? savedForm.base_id : (bases[0]?.id ?? ""),
      };
      setForm(restoredForm);
      setDraftItems(savedItems);
      setDraftUpdatedAt(data.updated_at as string);
      setLastSavedSignature(JSON.stringify({ form: restoredForm, draftItems: savedItems }));
      showToast("success", "Seu rascunho de requisição foi recuperado.");
    };
    void loadDraft();
  }, [bases, form, showToast, supabase, userId]);

  useEffect(() => {
    if (!draftDirty) return;
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeClose);
    return () => window.removeEventListener("beforeunload", warnBeforeClose);
  }, [draftDirty]);

  const catalog = useMemo(() => {
    const byCode = new Map<string, CatalogItem>();
    materials.filter((item) => item.status === "ativo").forEach((item) => {
      byCode.set(item.internal_code.trim().toLowerCase(), {
        source_type: "material",
        source_id: item.id,
        code: item.internal_code,
        name: item.name,
        description: item.description || item.name,
        unit: materialUnitLabel(item),
        category: materialCategoryName(item, categories),
      });
    });
    technicalItems.filter((item) => item.status === "ativo").forEach((item) => {
      const key = item.code.trim().toLowerCase();
      if (!byCode.has(key)) {
        byCode.set(key, {
          source_type: "tecnico",
          source_id: item.id,
          code: item.code,
          name: item.name,
          description: item.description,
          unit: "unidade",
          category: item.category || "Itens técnicos",
        });
      }
    });
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
  }, [categories, materials, technicalItems]);

  const filteredCatalog = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return [];
    return catalog.filter((item) => `${item.code} ${item.name} ${item.description}`.toLowerCase().includes(normalized)).slice(0, 7);
  }, [catalog, search]);

  const filteredLabelCatalog = useMemo(() => {
    const normalized = labelSearch.trim().toLowerCase();
    if (!normalized) return [];
    return catalog
      .filter((item) => `${item.code} ${item.name} ${item.description}`.toLowerCase().includes(normalized))
      .slice(0, 8);
  }, [catalog, labelSearch]);

  const labelCount = labelBatches.reduce((total, item) => total + item.copies, 0);
  const labelCategories = useMemo(
    () => [...new Set(catalog.map((item) => item.category))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [catalog],
  );
  const selectedLabelBase = bases.find((base) => base.id === labelBaseId);
  const printableLabels = useMemo(
    () => labelBatches.flatMap((item) => Array.from({ length: item.copies }, (_, copy) => ({ ...item, copy }))),
    [labelBatches],
  );

  const itemsByRequest = useMemo(() => {
    const result = new Map<string, MaterialRequestItem[]>();
    requestItems.forEach((item) => result.set(item.request_id, [...(result.get(item.request_id) ?? []), item]));
    return result;
  }, [requestItems]);

  const filteredRequests = useMemo(() => {
    const normalized = historySearch.trim().toLowerCase();
    return requests.filter((request) => {
      const items = itemsByRequest.get(request.id) ?? [];
      const baseName = bases.find((base) => base.id === request.base_id)?.name ?? "";
      const haystack = [
        requestCode(request.request_number),
        request.team_number,
        request.participant_one,
        request.participant_two,
        request.separator_name,
        baseName,
        ...items.flatMap((item) => [item.material_code, item.description]),
      ].filter(Boolean).join(" ").toLowerCase();
      const participant = `${request.participant_one} ${request.participant_two ?? ""}`.toLowerCase();
      return (!normalized || haystack.includes(normalized))
        && (!filters.base_id || request.base_id === filters.base_id)
        && (!filters.status || request.status === filters.status)
        && (!filters.date_from || request.withdrawal_date >= filters.date_from)
        && (!filters.date_to || request.withdrawal_date <= filters.date_to)
        && (!filters.team || (request.team_number ?? "").toLowerCase().includes(filters.team.toLowerCase()))
        && (!filters.participant || participant.includes(filters.participant.toLowerCase()))
        && (!filters.separator || request.separator_name.toLowerCase().includes(filters.separator.toLowerCase()));
    });
  }, [bases, filters, historySearch, itemsByRequest, requests]);

  const historyPageCount = Math.max(1, Math.ceil(filteredRequests.length / historyPageSize));
  const safeHistoryPage = Math.min(historyPage, historyPageCount);
  const pagedRequests = filteredRequests.slice((safeHistoryPage - 1) * historyPageSize, safeHistoryPage * historyPageSize);

  const clearFilters = () => { setFilters({ base_id: "", status: "", date_from: "", date_to: "", team: "", participant: "", separator: "" }); setHistoryPage(1); };
  const updateHistoryFilter = <K extends keyof RequestFilters>(key: K, value: RequestFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setHistoryPage(1);
  };

  const changeTab = (next: "new" | "history" | "labels") => {
    if (tab === "new" && next !== "new" && draftDirty && !window.confirm("Há alterações ainda não salvas. Deseja sair desta requisição?")) return;
    setTab(next);
  };

  const addItem = (item: CatalogItem, scanned: boolean) => {
    setDraftItems((current) => {
      const existing = current.find((entry) => entry.code.toLowerCase() === item.code.toLowerCase());
      if (existing) return current.map((entry) => entry === existing ? { ...entry, quantity: entry.quantity + 1, scanned: entry.scanned || scanned } : entry);
      return [...current, { ...item, quantity: 1, scanned, notes: "" }];
    });
    setSearch("");
    setScannerOpen(false);
  };

  const addLabelBatch = (item: CatalogItem) => {
    if (labelCount >= MAX_LABELS_PER_PRINT) {
      showToast("error", `O limite por impressão é de ${MAX_LABELS_PER_PRINT} etiquetas.`);
      return;
    }
    setLabelBatches((current) => {
      const exists = current.some((entry) => entry.source_type === item.source_type && entry.source_id === item.source_id);
      return exists ? current : [...current, { ...item, copies: 1 }];
    });
    setLabelSearch("");
  };

  const addCategoryLabels = () => {
    if (!bulkCategory) {
      showToast("error", "Escolha uma categoria para a seleção em massa.");
      return;
    }
    const selectedKeys = new Set(labelBatches.map((item) => `${item.source_type}-${item.source_id}`));
    const remaining = MAX_LABELS_PER_PRINT - labelCount;
    const matchesBulkSelection = (item: CatalogItem) => bulkCategory === "__all__" || item.category === bulkCategory;
    const candidates = catalog
      .filter((item) => matchesBulkSelection(item) && !selectedKeys.has(`${item.source_type}-${item.source_id}`))
      .slice(0, Math.max(0, remaining));
    if (!candidates.length) {
      showToast("error", remaining <= 0 ? `O limite de ${MAX_LABELS_PER_PRINT} etiquetas foi atingido.` : "Todos os itens desta categoria já foram selecionados.");
      return;
    }
    setLabelBatches((current) => [...current, ...candidates.map((item) => ({ ...item, copies: 1 }))]);
    const totalInCategory = catalog.filter((item) => matchesBulkSelection(item) && !selectedKeys.has(`${item.source_type}-${item.source_id}`)).length;
    const selectionLabel = bulkCategory === "__all__" ? "todos os catálogos" : bulkCategory;
    showToast("success", totalInCategory > candidates.length
      ? `${candidates.length} itens adicionados; o restante ficou de fora para respeitar o limite de impressão.`
      : `${candidates.length} itens de ${selectionLabel} adicionados.`);
  };

  const updateLabelCopies = (item: LabelBatch, requested: number) => {
    const currentCopies = item.copies;
    const available = MAX_LABELS_PER_PRINT - (labelCount - currentCopies);
    const copies = Math.min(50, Math.max(1, requested || 1), available);
    setLabelBatches((current) => current.map((entry) => entry.source_id === item.source_id && entry.source_type === item.source_type ? { ...entry, copies } : entry));
    if (requested > available) showToast("error", `Quantidade ajustada para manter o limite de ${MAX_LABELS_PER_PRINT} etiquetas.`);
  };

  const printLabels = () => {
    if (!labelBatches.length) {
      showToast("error", "Selecione pelo menos um material para gerar as etiquetas.");
      return;
    }
    if (!labelBaseId) {
      showToast("error", "Selecione a UTD que será exibida nas etiquetas.");
      return;
    }
    setPrintTarget(null);
    setCalibrationPrintReady(false);
    setLabelsPrintReady(true);
    const finish = () => setLabelsPrintReady(false);
    window.addEventListener("afterprint", finish, { once: true });
    window.setTimeout(() => window.print(), 100);
  };

  const printCalibration = () => {
    setPrintTarget(null);
    setLabelsPrintReady(false);
    setCalibrationPrintReady(true);
    const finish = () => setCalibrationPrintReady(false);
    window.addEventListener("afterprint", finish, { once: true });
    window.setTimeout(() => window.print(), 100);
  };

  const locateCode = (rawValue: string) => {
    const code = normalizeScannedCode(rawValue);
    const item = catalog.find((entry) => entry.code.trim().toLowerCase() === code.toLowerCase());
    if (!item) {
      setScannerOpen(false);
      setSearch(code);
      showToast("error", `O código ${code || "lido"} não foi encontrado nos catálogos.`);
      return;
    }
    addItem(item, true);
    showToast("success", `${item.code} adicionado à requisição.`);
  };

  const saveDraft = async () => {
    if (!hasMeaningfulDraft) {
      showToast("error", "Preencha algum dado ou adicione um item antes de salvar o rascunho.");
      return;
    }
    setDraftSaving(true);
    const savedAt = new Date().toISOString();
    const { error } = await supabase.from("material_request_drafts").upsert({
      user_id: userId,
      base_id: form.base_id || null,
      form_data: form,
      items: draftItems,
      updated_at: savedAt,
    }, { onConflict: "user_id" });
    setDraftSaving(false);
    if (error) {
      showToast("error", `Não foi possível salvar o rascunho: ${error.message}`);
      return;
    }
    setDraftUpdatedAt(savedAt);
    setLastSavedSignature(draftSignature);
    showToast("success", "Rascunho salvo. Você pode continuar depois, inclusive em outro dispositivo.");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.base_id || !form.team_id || !form.participant_one.trim() || !form.separator_name.trim() || draftItems.length === 0) {
      showToast("error", "Selecione a UTD, a equipe responsável, informe o separador e pelo menos um item.");
      return;
    }
    if (draftItems.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0)) {
      showToast("error", "Todas as quantidades precisam ser maiores que zero.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.rpc("create_material_request_v2", {
      p_base_id: form.base_id,
      p_withdrawal_date: form.withdrawal_date,
      p_team_id: form.team_id,
      p_participant_one: form.participant_one,
      p_participant_two: form.participant_two,
      p_separator_name: form.separator_name,
      p_notes: form.notes,
      p_items: draftItems.map((item) => ({
        source_type: item.source_type,
        source_id: item.source_id,
        material_code: item.code,
        description: item.name,
        unit_of_measure: item.unit,
        quantity: item.quantity,
        scanned: item.scanned,
        notes: item.notes,
      })),
    });

    if (error) {
      showToast("error", `Não foi possível salvar a requisição: ${error.message}`);
    } else {
      showToast("success", "Requisição aberta e registrada no histórico.");
      setDraftItems([]);
      const emptyForm = {
        base_id: bases[0]?.id ?? "",
        withdrawal_date: new Date().toISOString().slice(0, 10),
        team_number: "",
        team_id: "",
        participant_one: "",
        participant_two: "",
        separator_name: displayName,
        notes: "",
      };
      setForm(emptyForm);
      setDraftUpdatedAt(null);
      setLastSavedSignature(JSON.stringify({ form: emptyForm, draftItems: [] }));
      await refresh();
      await loadStatusHistory();
      setTab("history");
    }
    setLoading(false);
  };

  const updateStatus = async (request: MaterialRequest, status: MaterialRequest["status"], note?: string) => {
    if (!canTransitionRequestStatus(request.status, status, note)) {
      showToast("error", status === "cancelada" ? "Informe o motivo do cancelamento." : "Essa mudança de situação não é permitida.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.rpc("transition_material_request", {
      p_request_id: request.id,
      p_to_status: status,
      p_note: note?.trim() || null,
    });
    setLoading(false);
    if (error) showToast("error", error.message);
    else {
      const successMessage = status === "separada"
        ? "Materiais separados e saldo reservado com sucesso."
        : status === "entregue"
          ? "Entrega confirmada e baixa realizada no estoque."
          : "Requisição cancelada e reservas liberadas.";
      showToast("success", successMessage);
      setSelectedRequest(null);
      setCancelMode(false);
      setCancelReason("");
      setDeliveryMode(false);
      await refresh();
      await loadStatusHistory();
      await loadRequestStock();
    }
  };

  const printRequest = (request: MaterialRequest) => {
    setLabelsPrintReady(false);
    setCalibrationPrintReady(false);
    setPrintTarget(request);
    window.setTimeout(() => window.print(), 80);
  };

  const uploadSignedRequest = async () => {
    if (!selectedRequest || selectedRequest.status !== "entregue" || !signedConfirmed || signedFiles.length === 0) return;
    const invalid = signedFiles.find((file) => !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024);
    if (invalid) { showToast("error", `${invalid.name}: use PDF, JPG, PNG ou WebP com até 10 MB.`); return; }
    setUploadingSigned(true);
    for (const file of signedFiles) {
      const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
      const path = `${selectedRequest.base_id}/${selectedRequest.id}/${crypto.randomUUID()}.${extension}`;
      const uploaded = await supabase.storage.from("request-signed-documents").upload(path, file, { contentType: file.type, upsert: false });
      if (uploaded.error) { showToast("error", `Falha ao enviar ${file.name}: ${uploaded.error.message}`); setUploadingSigned(false); return; }
      const saved = await supabase.from("material_request_documents").insert({ request_id: selectedRequest.id, base_id: selectedRequest.base_id, team_id: selectedRequest.team_id, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size, legibility_confirmed: true, uploaded_by: userId });
      if (saved.error) { await supabase.storage.from("request-signed-documents").remove([path]); showToast("error", `Falha ao arquivar ${file.name}: ${saved.error.message}`); setUploadingSigned(false); return; }
    }
    setUploadingSigned(false); setSignedFiles([]); setSignedConfirmed(false); await loadDocuments();
    showToast("success", "Requisição assinada arquivada. O papel pode ser descartado conforme a rotina da empresa.");
  };

  const openSignedDocument = async (document: RequestDocument) => {
    const { data, error } = await supabase.storage.from("request-signed-documents").createSignedUrl(document.storage_path, 300);
    if (error || !data?.signedUrl) showToast("error", "Não foi possível abrir o arquivo.");
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const selectedItems = selectedRequest ? itemsByRequest.get(selectedRequest.id) ?? [] : [];
  const printableItems = printTarget ? itemsByRequest.get(printTarget.id) ?? [] : [];
  const selectedBase = selectedRequest ? bases.find((base) => base.id === selectedRequest.base_id) : null;
  const printableBase = printTarget ? bases.find((base) => base.id === printTarget.base_id) : null;
  const selectedHistory = selectedRequest
    ? statusHistory.filter((entry) => entry.request_id === selectedRequest.id)
    : [];
  const materialByCode = new Map(materials.map((material) => [material.internal_code.trim().toLowerCase(), material]));
  const selectedStockDetails = selectedRequest ? selectedItems.map((item) => {
    const material = item.source_type === "material" && item.source_id
      ? materials.find((entry) => entry.id === item.source_id)
      : materialByCode.get(item.material_code.trim().toLowerCase());
    const stock = material
      ? stockItems.find((entry) => entry.base_id === selectedRequest.base_id && entry.material_id === material.id && entry.is_active)
      : null;
    const reservation = stockReservations.find((entry) => entry.request_id === selectedRequest.id && entry.request_item_id === item.id);
    const available = stock ? Number(stock.current_quantity) - Number(stock.reserved_quantity) : 0;
    return { item, material, stock, reservation, available };
  }) : [];
  const controlledStockDetails = selectedStockDetails.filter((entry) => entry.material);
  const unavailableStockCount = selectedRequest?.status === "aberta"
    ? controlledStockDetails.filter((entry) => !entry.stock || entry.available < Number(entry.item.quantity)).length
    : 0;

  return (
    <div className="page-stack requisition-page">
      <section className="page-heading requisition-heading">
        <div><span className="eyebrow">FLUXO DIGITAL DO ALMOXARIFADO</span><h1>Requisições por QR Code</h1><p>Leia materiais pelo celular, registre a dupla e mantenha a retirada pronta para impressão.</p></div>
        <div className="heading-stat requisition-stat"><strong>{requests.length}</strong><span>requisições no histórico</span></div>
      </section>

      <div className="content-tabs requisition-tabs">
        {canCreateRequest && <button className={tab === "new" ? "active" : ""} onClick={() => changeTab("new")}><QrCode size={17} /> Nova requisição</button>}
        <button className={tab === "history" ? "active" : ""} onClick={() => changeTab("history")}><History size={17} /> Histórico <em>{requests.length}</em></button>
        {canManage && <button className={tab === "labels" ? "active" : ""} onClick={() => changeTab("labels")}><Tags size={17} /> Gerar etiquetas</button>}
      </div>

      {tab === "new" && canCreateRequest ? (
        <form className="requisition-layout" onSubmit={submit}>
          <section className="form-panel requisition-form">
            <div className="form-heading"><span className="form-icon blue"><ClipboardList size={22} /></span><div><h2>Dados da retirada</h2><p>Identifique a equipe, os participantes e quem está separando.</p></div></div>
            {draftUpdatedAt && <div className="draft-restored"><Save size={16} /><span>Rascunho salvo em <strong>{localDateTime(draftUpdatedAt)}</strong></span></div>}
            <div className="form-grid two">
              <label>UTD<select value={form.base_id} onChange={(event) => setForm({ ...form, base_id: event.target.value, team_id: "", team_number: "", participant_one: "", participant_two: "" })} required><option value="">Selecione a UTD</option>{bases.filter((base) => base.is_active).map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label>
              <label>Data do saque<input type="date" value={form.withdrawal_date} onChange={(event) => setForm({ ...form, withdrawal_date: event.target.value })} required /></label>
              <label>Equipe responsável<select value={form.team_id} onChange={(event) => { const team = teamOptions.find((option) => option.team_id === event.target.value); setForm({ ...form, team_id: team?.team_id ?? "", team_number: team?.code ?? "", participant_one: team?.member_names[0] ?? "", participant_two: team?.member_names[1] ?? "" }); }} required disabled={!form.base_id}><option value="">{teamOptions.length ? "Selecione a equipe" : "Nenhuma equipe disponível"}</option>{teamOptions.map((team) => <option key={team.team_id} value={team.team_id}>{team.code} — {team.name}</option>)}</select><small>Somente equipes da UTD selecionada. A dupla é preenchida automaticamente.</small></label>
              <label>Quem está separando<input value={form.separator_name} onChange={(event) => setForm({ ...form, separator_name: event.target.value })} required /></label>
              <label>Participante da dupla 1<input value={form.participant_one} onChange={(event) => setForm({ ...form, participant_one: event.target.value })} placeholder="Nome ou matrícula" required /></label>
              <label>Participante da dupla 2 <em>opcional</em><input value={form.participant_two} onChange={(event) => setForm({ ...form, participant_two: event.target.value })} placeholder="Nome ou matrícula" /></label>
              <label className="full-field">Observação geral <em>opcional</em><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Orientação importante sobre esta retirada" /></label>
            </div>
          </section>

          <section className="form-panel requisition-items-panel">
            <div className="form-heading"><span className="form-icon green"><PackageCheck size={22} /></span><div><h2>Materiais da requisição</h2><p>Escaneie o QR Code ou pesquise pelo código e descrição.</p></div></div>
            <div className="requisition-add-bar">
              <div className="requisition-search">
                <Search size={19} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código ou descrição do material" />
                {filteredCatalog.length > 0 && <div className="requisition-suggestions">{filteredCatalog.map((item) => <button type="button" key={`${item.source_type}-${item.source_id}`} onClick={() => addItem(item, false)}><span><strong>{item.code}</strong><small>{item.name}</small></span><ChevronRight size={17} /></button>)}</div>}
              </div>
              <button type="button" className="scan-button" onClick={() => setScannerOpen(true)}><Camera size={20} /><span>Escanear QR</span></button>
            </div>

            <div className="requisition-items">
              {draftItems.length === 0 ? <div className="request-empty"><QrCode size={30} /><strong>Nenhum material adicionado</strong><span>Use a câmera do celular ou pesquise o código.</span></div> : draftItems.map((item) => <article className="requisition-draft-item" key={`${item.source_type}-${item.source_id}`}><span className={`request-item-icon ${item.scanned ? "scanned" : ""}`}>{item.scanned ? <QrCode size={21} /> : <Hash size={21} />}</span><div className="request-item-copy"><strong>{item.code} — {item.name}</strong><small>{item.description}</small><input value={item.notes} onChange={(event) => setDraftItems((current) => current.map((entry) => entry.source_id === item.source_id && entry.source_type === item.source_type ? { ...entry, notes: event.target.value } : entry))} placeholder="Observação técnica do item (opcional)" /></div><label className="quantity-field"><span>Quantidade</span><input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => setDraftItems((current) => current.map((entry) => entry.source_id === item.source_id && entry.source_type === item.source_type ? { ...entry, quantity: Number(event.target.value) } : entry))} /><small>{item.unit}</small></label><button type="button" className="remove-item" onClick={() => setDraftItems((current) => current.filter((entry) => !(entry.source_id === item.source_id && entry.source_type === item.source_type)))} aria-label={`Remover ${item.name}`}><Trash2 size={18} /></button></article>)}
            </div>
            <div className="requisition-submit"><span><strong>{draftItems.length}</strong> {draftItems.length === 1 ? "item" : "itens"} na requisição{draftDirty && <em>Alterações não salvas</em>}</span><div className="requisition-submit-actions"><button type="button" className="secondary-button" disabled={draftSaving || !hasMeaningfulDraft} onClick={() => void saveDraft()}>{draftSaving ? <Loader2 className="spin" size={18} /> : <Save size={18} />} Salvar rascunho</button><button className="primary-button" disabled={loading || draftItems.length === 0}>{loading ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />} Abrir requisição</button></div></div>
          </section>
        </form>
      ) : tab === "labels" && canManage ? (
        <section className="labels-workspace">
          <div className="labels-builder">
            <section className="form-panel label-picker-panel">
              <div className="form-heading"><span className="form-icon green"><Tags size={22} /></span><div><h2>Materiais das etiquetas</h2><p>Escolha um ou mais itens e defina quantas cópias deseja imprimir.</p></div></div>
              <div className="label-search-wrap">
                <div className="requisition-search label-search"><Search size={19} /><input value={labelSearch} onChange={(event) => setLabelSearch(event.target.value)} placeholder="Buscar por código ou descrição" />{filteredLabelCatalog.length > 0 && <div className="requisition-suggestions">{filteredLabelCatalog.map((item) => <button type="button" key={`${item.source_type}-${item.source_id}`} onClick={() => addLabelBatch(item)}><span><strong>{item.code}</strong><small>{item.name}</small></span><ChevronRight size={17} /></button>)}</div>}</div>
              </div>
              <div className="label-bulk-bar"><span><ListPlus size={17} /><b>Seleção em massa</b></span><select value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)}><option value="">Escolha uma categoria</option><option value="__all__">Todos os itens (até {MAX_LABELS_PER_PRINT})</option>{labelCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select><button type="button" className="secondary-button" onClick={addCategoryLabels}>Adicionar seleção</button>{labelBatches.length > 0 && <button type="button" className="text-button" onClick={() => setLabelBatches([])}>Limpar seleção</button>}</div>
              <div className="label-batches">
                {labelBatches.length === 0 ? <div className="request-empty label-empty"><QrCode size={31} /><strong>Nenhum item selecionado</strong><span>Pesquise um material ou adicione uma categoria inteira.</span></div> : labelBatches.map((item) => <article className="label-batch" key={`${item.source_type}-${item.source_id}`}><span className="label-batch-icon"><QrCode size={21} /></span><div><strong>{item.code} — {item.name}</strong><small>{item.category}</small></div><label><span>Cópias</span><input type="number" min="1" max="50" value={item.copies} onChange={(event) => updateLabelCopies(item, Number(event.target.value))} /></label><button className="remove-item" type="button" onClick={() => setLabelBatches((current) => current.filter((entry) => !(entry.source_id === item.source_id && entry.source_type === item.source_type)))} aria-label={`Remover ${item.name}`}><Trash2 size={18} /></button></article>)}
              </div>
            </section>

            <aside className="form-panel label-settings-panel">
              <div className="form-heading"><span className="form-icon blue"><Printer size={22} /></span><div><h2>Configurar impressão</h2><p>O navegador permite imprimir ou salvar a folha em PDF.</p></div></div>
              <div className="label-settings-body">
                <fieldset className="label-size-options"><legend>Tamanho da etiqueta</legend>{(Object.entries(labelSizes) as Array<[LabelSize, (typeof labelSizes)[LabelSize]]>).map(([key, option]) => <label key={key} className={labelSize === key ? "selected" : ""}><input type="radio" name="label-size" value={key} checked={labelSize === key} onChange={() => setLabelSize(key)} /><span><strong>{option.label}</strong><b>{option.dimensions}</b><small>{option.description}</small></span></label>)}</fieldset>
                <label className="label-base-field">UTD exibida na etiqueta<select value={labelBaseId} onChange={(event) => setLabelBaseId(event.target.value)} required><option value="">Selecione a UTD</option>{bases.filter((base) => base.is_active).map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label>
                <div className={`label-summary ${labelCount >= MAX_LABELS_PER_PRINT ? "at-limit" : ""}`}><span><b>{labelBatches.length}</b> materiais</span><span><b>{labelCount}</b> de {MAX_LABELS_PER_PRINT} etiquetas</span><i><em style={{ width: `${Math.min(100, (labelCount / MAX_LABELS_PER_PRINT) * 100)}%` }} /></i></div>
                <button type="button" className="primary-button label-print-button" disabled={!labelBatches.length || !labelBaseId} onClick={printLabels}><Printer size={18} /> Imprimir / salvar PDF</button>
                <div className="label-print-guide"><span><Smartphone size={17} /><b>Antes de imprimir</b></span><ol><li>Use papel A4 e orientação retrato.</li><li>Defina a escala como <strong>100% / tamanho real</strong>.</li><li>Desative “Ajustar à página”.</li></ol><button type="button" className="secondary-button" onClick={printCalibration}><Ruler size={17} /> Testar calibração da impressora</button></div>
                <p className="label-help"><QrCode size={16} /> O QR leva somente o identificador e o código do cadastro. Alterações na descrição não inutilizam a etiqueta.</p>
              </div>
            </aside>
          </div>

          <section className="label-preview-panel">
            <div className="label-preview-heading"><div><span className="eyebrow">PRÉ-VISUALIZAÇÃO</span><h2>Como as etiquetas ficarão</h2></div><span>{labelSizes[labelSize].dimensions}</span></div>
            {labelBatches.length === 0 ? <div className="label-preview-empty"><Tags size={28} /><span>Selecione um item para visualizar.</span></div> : <><div className={`label-preview-grid label-grid-${labelSize}`}>{labelBatches.slice(0, 6).map((item) => <MaterialQrLabel item={item} size={labelSize} base={selectedLabelBase} key={`preview-${item.source_type}-${item.source_id}`} />)}</div>{labelBatches.length > 6 && <p className="label-preview-more">Prévia dos 6 primeiros materiais • {labelBatches.length - 6} adicionais prontos para impressão</p>}</>}
          </section>
        </section>
      ) : (
        <section className="request-history">
          <div className="search-panel requisition-history-search"><div className="search-box"><Search size={19} /><input value={historySearch} onChange={(event) => { setHistorySearch(event.target.value); setHistoryPage(1); }} placeholder="Buscar por requisição, equipe, participante ou material" /></div><span className="results-caption"><strong>{filteredRequests.length}</strong> registros</span></div>
          <div className="request-filters">
            <div className="request-filter-heading"><span><SlidersHorizontal size={17} /> Filtros operacionais</span><button type="button" onClick={clearFilters}>Limpar filtros</button></div>
            <div className="request-filter-grid">
              <label>UTD<select value={filters.base_id} onChange={(event) => updateHistoryFilter("base_id", event.target.value)}><option value="">Todas</option>{bases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label>
              <label>Status<select value={filters.status} onChange={(event) => updateHistoryFilter("status", event.target.value as RequestFilters["status"])}><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>De<input type="date" value={filters.date_from} onChange={(event) => updateHistoryFilter("date_from", event.target.value)} /></label>
              <label>Até<input type="date" value={filters.date_to} onChange={(event) => updateHistoryFilter("date_to", event.target.value)} /></label>
              <label>Equipe<input value={filters.team} onChange={(event) => updateHistoryFilter("team", event.target.value)} placeholder="Número da equipe" /></label>
              <label>Participante<input value={filters.participant} onChange={(event) => updateHistoryFilter("participant", event.target.value)} placeholder="Nome ou matrícula" /></label>
              <label>Separador<input value={filters.separator} onChange={(event) => updateHistoryFilter("separator", event.target.value)} placeholder="Nome do separador" /></label>
            </div>
          </div>
          {filteredRequests.length === 0 ? <section className="panel"><div className="empty-state"><span><History size={29} /></span><h3>Nenhuma requisição encontrada</h3><p>As retiradas registradas aparecerão aqui para consulta e impressão.</p></div></section> : <><div className="request-history-list">{pagedRequests.map((request) => { const items = itemsByRequest.get(request.id) ?? []; const base = bases.find((entry) => entry.id === request.base_id); return <article className="request-history-card" key={request.id}><div className="request-history-code"><span><ClipboardList size={20} /></span><div><small>REQUISIÇÃO</small><strong>{requestCode(request.request_number)}</strong></div></div><div className="request-history-main"><div><strong>{request.team_number || "Equipe não informada"}</strong><span><Users size={14} /> {request.participant_one}{request.participant_two ? ` + ${request.participant_two}` : ""}</span></div><div><small>Base</small><strong>{base?.abbreviation || base?.name || "Não definida"}</strong></div><div><small>Itens</small><strong>{items.length}</strong></div><div><small>Data do saque</small><strong>{localDate(request.withdrawal_date)}</strong></div></div><span className={`request-status request-status-${request.status}`}>{statusLabels[request.status]}</span><button className="request-open" onClick={() => { setSelectedRequest(request); setCancelMode(false); setDeliveryMode(false); }}>Ver e imprimir <ChevronRight size={18} /></button></article>; })}</div><Pagination page={safeHistoryPage} pageSize={historyPageSize} total={filteredRequests.length} noun="requisições" pageSizeOptions={[10, 25, 50]} onPageChange={setHistoryPage} onPageSizeChange={(value) => { setHistoryPageSize(value); setHistoryPage(1); }} /></>}
        </section>
      )}

      {scannerOpen && <ScannerModal onClose={() => setScannerOpen(false)} onRead={locateCode} />}

      {selectedRequest && <div className="modal-layer" role="dialog" aria-modal="true" aria-label={`Detalhes da ${requestCode(selectedRequest.request_number)}`}>
        <button className="modal-backdrop" onClick={() => setSelectedRequest(null)} aria-label="Fechar" />
        <section className="request-detail-drawer">
          <header className="drawer-head"><div><span className="eyebrow">REQUISIÇÃO DO ALMOXARIFADO</span><h2>{requestCode(selectedRequest.request_number)}</h2></div><button className="icon-button" onClick={() => setSelectedRequest(null)} aria-label="Fechar"><X size={20} /></button></header>
          <div className="request-detail-body">
            <div className="request-detail-status"><span className={`request-status request-status-${selectedRequest.status}`}>{statusLabels[selectedRequest.status]}</span><small>Criada em {localDateTime(selectedRequest.created_at)}</small></div>
            <div className="request-detail-grid"><div><MapPin size={17} /><span><small>UTD</small><strong>{selectedBase?.name || "Não definida"}</strong></span></div><div><Clock3 size={17} /><span><small>Data do saque</small><strong>{localDate(selectedRequest.withdrawal_date)}</strong></span></div><div><Users size={17} /><span><small>Equipe</small><strong>{selectedRequest.team_number || "Não informada"}</strong></span></div><div><UserRound size={17} /><span><small>Separador</small><strong>{selectedRequest.separator_name}</strong></span></div></div>
            <section className="request-participants"><small>PARTICIPANTES DA DUPLA</small><strong>{selectedRequest.participant_one}</strong>{selectedRequest.participant_two && <strong>{selectedRequest.participant_two}</strong>}</section>

            <section className={`request-stock-summary ${selectedRequest.status === "cancelada" ? "released" : unavailableStockCount ? "unavailable" : "available"}`}>
              {selectedRequest.status === "aberta" && unavailableStockCount > 0 ? <TriangleAlert size={19} /> : <Warehouse size={19} />}
              <span>
                <small>INTEGRAÇÃO COM ESTOQUE</small>
                <strong>{selectedRequest.status === "aberta"
                  ? unavailableStockCount > 0
                    ? `${unavailableStockCount} ${unavailableStockCount === 1 ? "item sem saldo suficiente" : "itens sem saldo suficiente"}`
                    : controlledStockDetails.length ? "Todos os itens controlados têm saldo disponível" : "Itens fora do controle de estoque"
                  : selectedRequest.status === "separada"
                    ? "Quantidades reservadas para esta requisição"
                    : selectedRequest.status === "entregue"
                      ? "Baixa de estoque concluída"
                      : "Reservas liberadas pelo cancelamento"}</strong>
              </span>
            </section>

            <section className="request-detail-items">
              <div><span>Material e estoque</span><span>Qtd.</span></div>
              {selectedStockDetails.map(({ item, material, stock, reservation, available }) => {
                const enough = Boolean(stock) && available >= Number(item.quantity);
                const stockText = !material
                  ? "Não controlado no estoque"
                  : selectedRequest.status === "separada" && reservation?.status === "ativa"
                    ? `${Number(reservation.quantity).toLocaleString("pt-BR")} reservado nesta requisição`
                    : selectedRequest.status === "entregue" && reservation?.status === "consumida"
                      ? `${Number(reservation.quantity).toLocaleString("pt-BR")} baixado do estoque`
                      : selectedRequest.status === "cancelada" && reservation?.status === "liberada"
                        ? "Reserva liberada"
                        : stock
                          ? `Físico ${Number(stock.current_quantity).toLocaleString("pt-BR")} · reservado ${Number(stock.reserved_quantity).toLocaleString("pt-BR")} · disponível ${available.toLocaleString("pt-BR")}`
                          : "Sem saldo cadastrado nesta UTD";
                const stockTone = !material ? "neutral" : selectedRequest.status === "aberta" ? (enough ? "ok" : "error") : reservation ? "ok" : "neutral";
                return <article key={item.id}><span><strong>{item.material_code} — {item.description}</strong>{item.notes && <small>{item.notes}</small>}<em className={`request-item-stock ${stockTone}`}>{stockTone === "error" ? <TriangleAlert size={12} /> : <Boxes size={12} />} {stockText}</em>{item.scanned && <em><QrCode size={12} /> Lido por QR</em>}</span><b>{Number(item.quantity).toLocaleString("pt-BR")} <small>{item.unit_of_measure}</small></b></article>;
              })}
            </section>
            {selectedRequest.notes && <section className="request-notes"><small>OBSERVAÇÃO</small><p>{selectedRequest.notes}</p></section>}
            {selectedRequest.status === "entregue" && <section className="signed-request-archive"><div className="signed-archive-heading"><span><FileText size={19} /><span><small>ARQUIVO DIGITAL</small><strong>Requisição assinada</strong></span></span><em className={requestDocuments.some((document) => document.request_id === selectedRequest.id) ? "archived" : "pending"}>{requestDocuments.some((document) => document.request_id === selectedRequest.id) ? "Documento arquivado" : "Aguardando assinatura"}</em></div>{requestDocuments.filter((document) => document.request_id === selectedRequest.id).map((document) => <button type="button" className="signed-document" key={document.id} onClick={() => void openSignedDocument(document)}><FileText size={18} /><span><strong>{document.file_name}</strong><small>{(document.size_bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MB · {localDateTime(document.uploaded_at)}</small></span><ChevronRight size={17} /></button>)}{canManage && <div className="signed-upload-box"><label className="signed-file-picker"><UploadCloud size={23} /><span><strong>PDF ou fotos da folha assinada</strong><small>Vários arquivos · até 10 MB cada</small></span><input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setSignedFiles(Array.from(event.target.files ?? []))} /></label>{signedFiles.length > 0 && <small>{signedFiles.length} {signedFiles.length === 1 ? "arquivo selecionado" : "arquivos selecionados"}</small>}<label className="signed-confirm"><input type="checkbox" checked={signedConfirmed} onChange={(event) => setSignedConfirmed(event.target.checked)} /><span>Confirmo que o documento está completo, legível e assinado.</span></label><button type="button" className="primary-button" disabled={uploadingSigned || !signedConfirmed || signedFiles.length === 0} onClick={() => void uploadSignedRequest()}>{uploadingSigned ? <Loader2 className="spin" size={17} /> : <UploadCloud size={17} />} Arquivar e liberar descarte</button></div>}</section>}
        <section className="request-timeline"><div className="request-timeline-title"><History size={17} /><span><small>RASTREABILIDADE</small><strong>Evolução da requisição</strong></span></div>{selectedHistory.length === 0 ? <p>O histórico ainda está sendo carregado.</p> : <ol>{selectedHistory.map((entry) => <li key={entry.id} className={`timeline-${entry.to_status}`}><i /><div><strong>{entry.from_status ? `${statusLabels[entry.from_status]} → ${statusLabels[entry.to_status]}` : `Requisição ${statusLabels[entry.to_status].toLowerCase()}`}</strong><small>{localDateTime(entry.changed_at)}</small>{entry.note && <p>{entry.note}</p>}</div></li>)}</ol>}</section>
            {cancelMode && <div className="request-cancel-box"><label>Motivo do cancelamento<textarea rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Informe por que esta requisição está sendo cancelada" /></label><div><button type="button" className="secondary-button" onClick={() => { setCancelMode(false); setCancelReason(""); }}>Voltar</button><button type="button" className="danger-button" disabled={loading || !cancelReason.trim()} onClick={() => void updateStatus(selectedRequest, "cancelada", cancelReason)}>{loading ? <Loader2 className="spin" size={17} /> : <Ban size={17} />} Confirmar cancelamento</button></div></div>}
            {deliveryMode && <div className="request-delivery-box"><PackageCheck size={21} /><div><strong>Confirmar entrega e baixa?</strong><p>Os saldos serão reduzidos definitivamente e a movimentação ficará vinculada a {requestCode(selectedRequest.request_number)}.</p><span><button type="button" className="secondary-button" onClick={() => setDeliveryMode(false)}>Voltar</button><button type="button" className="primary-button" disabled={loading} onClick={() => void updateStatus(selectedRequest, "entregue")}>{loading ? <Loader2 className="spin" size={17} /> : <CheckCircle2 size={17} />} Confirmar entrega e baixa</button></span></div></div>}
            <div className="request-detail-actions"><button className="secondary-button" onClick={() => printRequest(selectedRequest)}><Printer size={18} /> Imprimir / salvar PDF</button>{canManage && !cancelMode && !deliveryMode && selectedRequest.status === "aberta" && <><button className="danger-button" onClick={() => setCancelMode(true)}><Ban size={18} /> Cancelar</button><button className="primary-button" disabled={loading || unavailableStockCount > 0} onClick={() => void updateStatus(selectedRequest, "separada")}><PackageCheck size={18} /> Separar e reservar</button></>}{canManage && !cancelMode && !deliveryMode && selectedRequest.status === "separada" && <><button className="danger-button" onClick={() => setCancelMode(true)}><Ban size={18} /> Cancelar</button><button className="primary-button" disabled={loading} onClick={() => setDeliveryMode(true)}><CheckCircle2 size={18} /> Entregar e baixar estoque</button></>}</div>
          </div>
        </section>
      </div>}

      {printTarget && <section className="print-sheet" aria-hidden="true"><header><div><strong>CENTRAL DO ALMOXARIFADO</strong><span>Requisição de materiais • {statusLabels[printTarget.status]}</span></div><div className="print-control"><QRCodeSVG value={JSON.stringify({ v: 1, type: "requisicao", id: printTarget.id, control: requestCode(printTarget.request_number) })} level="M" /><span><small>NÚMERO DE CONTROLE</small><b>{requestCode(printTarget.request_number)}</b></span></div></header><div className="print-info"><div><span>UTD</span><strong>{printableBase?.name || "Não definida"}</strong></div><div><span>Data do saque</span><strong>{localDate(printTarget.withdrawal_date)}</strong></div><div><span>Número da equipe</span><strong>{printTarget.team_number || "Não informado"}</strong></div><div><span>Separado por</span><strong>{printTarget.separator_name}</strong></div><div className="wide"><span>Participantes da dupla</span><strong>{printTarget.participant_one}{printTarget.participant_two ? ` / ${printTarget.participant_two}` : ""}</strong></div></div><div className={`print-stock-status print-stock-${printTarget.status}`}><strong>ESTOQUE</strong><span>{printTarget.status === "entregue" ? `Baixa concluída${printTarget.stock_posted_at ? ` em ${localDateTime(printTarget.stock_posted_at)}` : ""}` : printTarget.status === "separada" ? "Quantidades reservadas" : printTarget.status === "cancelada" ? "Reserva liberada / sem baixa" : "Aguardando separação — sem alteração de saldo"}</span></div><table><thead><tr><th>Código</th><th>Descrição</th><th>Quantidade</th><th>Unidade</th></tr></thead><tbody>{printableItems.map((item) => <tr key={item.id}><td>{item.material_code}</td><td>{item.description}{item.notes ? <small>{item.notes}</small> : null}</td><td>{Number(item.quantity).toLocaleString("pt-BR")}</td><td>{item.unit_of_measure}</td></tr>)}</tbody></table>{printTarget.notes && <div className="print-notes"><span>Observação</span><p>{printTarget.notes}</p></div>}<footer><div><span>Assinatura do participante</span></div><div><span>Assinatura do separador</span></div></footer><small className="print-generated">Documento gerado pela Central do Almoxarifado em {localDateTime(new Date().toISOString())}</small></section>}
      {labelsPrintReady && <section className={`label-print-sheet label-print-${labelSize}`} aria-hidden="true">{printableLabels.map((item) => <MaterialQrLabel item={item} size={labelSize} base={selectedLabelBase} key={`print-${item.source_type}-${item.source_id}-${item.copy}`} />)}</section>}
      {calibrationPrintReady && <section className="calibration-sheet" aria-hidden="true"><header><Warehouse /><div><strong>Teste de calibração</strong><span>Central do Almoxarifado</span></div></header><p>Imprima em A4, escala 100% ou tamanho real, sem “Ajustar à página”. Depois confira as medidas com uma régua.</p><div className="calibration-shapes"><div className="calibration-small"><b>50 × 30 mm</b><span>Etiqueta compacta</span></div><div className="calibration-medium"><b>70 × 40 mm</b><span>Etiqueta média</span></div><div className="calibration-large"><b>100 × 60 mm</b><span>Etiqueta grande</span></div></div><div className="calibration-ruler"><span>0</span>{Array.from({ length: 10 }, (_, index) => <i key={index} />)}<span>100 mm</span></div><footer><strong>Resultado esperado:</strong> o retângulo maior deve medir exatamente 100 × 60 mm. Se não medir, corrija a escala da impressora antes de gerar as etiquetas definitivas.</footer></section>}
    </div>
  );
}
