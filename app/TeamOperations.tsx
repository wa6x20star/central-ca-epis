"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlertTriangle, Boxes, Cable, CheckCircle2, Gauge, History,
  Loader2, MapPin, PackageCheck, Plus, QrCode, Search, ShieldCheck,
  Trash2, Users, Wrench, X,
} from "lucide-react";
import { Pagination } from "./Pagination";
import { normalizeScannedCode } from "./domain";

type Role = "consulta" | "almoxarife" | "aprovador" | "administrador" | "eletricista";
type Team = { id: string; base_id: string; code: string; name: string; is_active: boolean };
type Member = { id: string; team_id: string; user_id: string; membership_role: string; is_active: boolean };
type Custody = { id: string; team_id: string; base_id: string; material_id: string; received_quantity: number; available_quantity: number; received_at: string; source_request_id: string | null };
type Usage = { id: string; protocol: string; team_id: string; material_id: string; quantity: number; used_on: string; reference_type: string; reference_number: string; service_location: string | null; notes: string | null; created_at: string };
type Meter = { id: string; team_id: string; material_id: string | null; internal_code: string; serial_number: string; manufacturer: string | null; model: string | null; received_at: string; status: "disponivel" | "instalado" | "aguardando_devolucao" | "devolvido"; installation_reference_type: string | null; installation_reference: string | null; scrap_reason: string | null; return_protocol: string | null; returned_at: string | null };
type Material = { id: string; internal_code: string; name: string; unit_of_measure: string; status: string };
type Base = { id: string; name: string; abbreviation: string | null };

const meterStatus: Record<Meter["status"], string> = {
  disponivel: "Disponível", instalado: "Instalado", aguardando_devolucao: "Aguardando devolução", devolvido: "Devolvido",
};

function localDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

export default function TeamOperations({ supabase, userId, role, bases, materials, showToast }: {
  supabase: SupabaseClient;
  userId: string;
  role: Role;
  bases: Base[];
  materials: Material[];
  showToast: (kind: "success" | "error", message: string) => void;
}) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [custody, setCustody] = useState<Custody[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [teamId, setTeamId] = useState("");
  const [tab, setTab] = useState<"posse" | "utilizados" | "medidores" | "sucata">("posse");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [usingMaterial, setUsingMaterial] = useState<{ id: string; available: number } | null>(null);
  const [usageForm, setUsageForm] = useState({ quantity: "", used_on: new Date().toISOString().slice(0, 10), reference_type: "OC", reference_number: "", service_location: "", notes: "" });
  const [meterFormOpen, setMeterFormOpen] = useState(false);
  const [meterForm, setMeterForm] = useState({ material_id: "", internal_code: "", serial_number: "", manufacturer: "", model: "" });
  const [meterAction, setMeterAction] = useState<{ meter: Meter; to: "instalado" | "aguardando_devolucao" | "devolvido" } | null>(null);
  const [meterActionForm, setMeterActionForm] = useState({ reference_type: "OC", reference_number: "", notes: "" });
  const canWarehouse = role === "almoxarife" || role === "administrador";

  const load = useCallback(async () => {
    setLoading(true);
    const [teamResult, memberResult, custodyResult, usageResult, meterResult] = await Promise.all([
      supabase.from("teams").select("id,base_id,code,name,is_active").eq("is_active", true).order("code"),
      supabase.from("team_members").select("id,team_id,user_id,membership_role,is_active").eq("is_active", true),
      supabase.from("team_material_custody").select("id,team_id,base_id,material_id,received_quantity,available_quantity,received_at,source_request_id").order("received_at", { ascending: false }),
      supabase.from("team_material_usage").select("id,protocol,team_id,material_id,quantity,used_on,reference_type,reference_number,service_location,notes,created_at").order("created_at", { ascending: false }),
      supabase.from("team_meters").select("id,team_id,material_id,internal_code,serial_number,manufacturer,model,received_at,status,installation_reference_type,installation_reference,scrap_reason,return_protocol,returned_at").order("updated_at", { ascending: false }),
    ]);
    const error = [teamResult.error, memberResult.error, custodyResult.error, usageResult.error, meterResult.error].find(Boolean);
    if (error) showToast("error", `Não foi possível carregar Minha Equipe: ${error.message}`);
    const nextTeams = (teamResult.data ?? []) as Team[];
    setTeams(nextTeams); setMembers((memberResult.data ?? []) as Member[]); setCustody((custodyResult.data ?? []) as Custody[]); setUsage((usageResult.data ?? []) as Usage[]); setMeters((meterResult.data ?? []) as Meter[]);
    setTeamId((current) => current && nextTeams.some((team) => team.id === current) ? current : nextTeams[0]?.id ?? "");
    setLoading(false);
  }, [showToast, supabase]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [query, tab, teamId, pageSize]);

  const selectedTeam = teams.find((team) => team.id === teamId);
  const teamBase = bases.find((base) => base.id === selectedTeam?.base_id);
  const materialById = useMemo(() => new Map(materials.map((item) => [item.id, item])), [materials]);
  const groupedCustody = useMemo(() => {
    const grouped = new Map<string, { material_id: string; received: number; available: number; lastReceived: string }>();
    custody.filter((item) => item.team_id === teamId).forEach((item) => {
      const current = grouped.get(item.material_id);
      grouped.set(item.material_id, { material_id: item.material_id, received: (current?.received ?? 0) + Number(item.received_quantity), available: (current?.available ?? 0) + Number(item.available_quantity), lastReceived: current && current.lastReceived > item.received_at ? current.lastReceived : item.received_at });
    });
    return [...grouped.values()].sort((a, b) => (materialById.get(a.material_id)?.name ?? "").localeCompare(materialById.get(b.material_id)?.name ?? "", "pt-BR"));
  }, [custody, materialById, teamId]);

  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const filteredPossession = groupedCustody.filter((entry) => {
    const material = materialById.get(entry.material_id); return !normalized || `${material?.internal_code} ${material?.name}`.toLocaleLowerCase("pt-BR").includes(normalized);
  });
  const filteredUsage = usage.filter((entry) => entry.team_id === teamId && (!normalized || `${entry.protocol} ${entry.reference_number} ${materialById.get(entry.material_id)?.internal_code} ${materialById.get(entry.material_id)?.name}`.toLocaleLowerCase("pt-BR").includes(normalized)));
  const filteredMeters = meters.filter((entry) => entry.team_id === teamId && (tab === "sucata" ? ["aguardando_devolucao", "devolvido"].includes(entry.status) : ["disponivel", "instalado"].includes(entry.status)) && (!normalized || `${entry.internal_code} ${entry.serial_number} ${entry.manufacturer} ${entry.model}`.toLocaleLowerCase("pt-BR").includes(normalized)));
  const currentList = tab === "posse" ? filteredPossession : tab === "utilizados" ? filteredUsage : filteredMeters;
  const pageCount = Math.max(1, Math.ceil(currentList.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = currentList.slice((safePage - 1) * pageSize, safePage * pageSize);

  const registerUsage = async (event: FormEvent) => {
    event.preventDefault(); if (!usingMaterial) return;
    const quantity = Number(usageForm.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > usingMaterial.available) { showToast("error", `Informe uma quantidade entre 0 e ${usingMaterial.available}.`); return; }
    setSaving(true);
    const { error } = await supabase.rpc("register_team_material_usage", { p_team_id: teamId, p_material_id: usingMaterial.id, p_quantity: quantity, p_used_on: usageForm.used_on, p_reference_type: usageForm.reference_type, p_reference_number: usageForm.reference_number, p_service_location: usageForm.service_location || null, p_notes: usageForm.notes || null, p_evidence_path: null });
    if (error) showToast("error", error.message); else { showToast("success", "Uso registrado e saldo da equipe atualizado."); setUsingMaterial(null); setUsageForm({ quantity: "", used_on: new Date().toISOString().slice(0, 10), reference_type: "OC", reference_number: "", service_location: "", notes: "" }); await load(); setTab("utilizados"); }
    setSaving(false);
  };

  const registerMeter = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    const { error } = await supabase.rpc("register_team_meter", { p_team_id: teamId, p_material_id: meterForm.material_id || null, p_internal_code: meterForm.internal_code, p_serial_number: meterForm.serial_number, p_manufacturer: meterForm.manufacturer || null, p_model: meterForm.model || null, p_source_request_id: null });
    if (error) showToast("error", error.code === "23505" ? "Este número de série já está cadastrado." : error.message); else { showToast("success", "Medidor vinculado à equipe."); setMeterFormOpen(false); setMeterForm({ material_id: "", internal_code: "", serial_number: "", manufacturer: "", model: "" }); await load(); }
    setSaving(false);
  };

  const transitionMeter = async (event: FormEvent) => {
    event.preventDefault(); if (!meterAction) return; setSaving(true);
    const { error } = await supabase.rpc("transition_team_meter", { p_meter_id: meterAction.meter.id, p_to_status: meterAction.to, p_reference_type: meterAction.to === "instalado" ? meterActionForm.reference_type : null, p_reference_number: meterAction.to === "instalado" ? meterActionForm.reference_number : null, p_notes: meterActionForm.notes || null, p_evidence_path: null });
    if (error) showToast("error", error.message); else { showToast("success", meterAction.to === "devolvido" ? "Devolução confirmada com protocolo." : meterAction.to === "instalado" ? "Instalação registrada." : "Medidor encaminhado para devolução."); setMeterAction(null); setMeterActionForm({ reference_type: "OC", reference_number: "", notes: "" }); await load(); }
    setSaving(false);
  };

  if (loading) return <div className="section-loading"><Loader2 className="spin" size={25} /><span>Carregando materiais e medidores da equipe</span></div>;
  if (teams.length === 0) return <div className="page-stack"><section className="page-heading"><div><span className="eyebrow">OPERAÇÃO DE CAMPO</span><h1>Minha Equipe</h1><p>Seu acesso está ativo, mas ainda não há uma equipe vinculada ao perfil.</p></div></section><section className="panel team-empty"><Users size={34} /><h2>Equipe ainda não atribuída</h2><p>Peça ao administrador para concluir o vínculo na tela Usuários e permissões.</p></section></div>;

  return <div className="page-stack team-operations">
    <section className="page-heading team-heading"><div><span className="eyebrow">RESPONSABILIDADE DE CAMPO</span><h1>Minha Equipe</h1><p>Materiais e medidores que estão sob responsabilidade da equipe, sem duplicar a baixa do almoxarifado.</p></div><div className="team-scope"><MapPin size={17} /><label>Equipe<select value={teamId} onChange={(event) => setTeamId(event.target.value)}>{teams.map((team) => <option key={team.id} value={team.id}>{team.code} — {team.name}</option>)}</select></label><small>{teamBase?.name}</small></div></section>
    <section className="team-metrics">
      <article><span><Boxes /></span><div><small>Itens em posse</small><strong>{groupedCustody.filter((item) => item.available > 0).length}</strong></div></article>
      <article><span><History /></span><div><small>Usos registrados</small><strong>{usage.filter((item) => item.team_id === teamId).length}</strong></div></article>
      <article><span><Gauge /></span><div><small>Medidores em mãos</small><strong>{meters.filter((item) => item.team_id === teamId && item.status !== "devolvido").length}</strong></div></article>
      <article><span><AlertTriangle /></span><div><small>Aguardando devolução</small><strong>{meters.filter((item) => item.team_id === teamId && item.status === "aguardando_devolucao").length}</strong></div></article>
    </section>
    <div className="content-tabs team-tabs">
      <button className={tab === "posse" ? "active" : ""} onClick={() => setTab("posse")}><Boxes size={17} /> Materiais em posse</button>
      <button className={tab === "utilizados" ? "active" : ""} onClick={() => setTab("utilizados")}><Wrench size={17} /> Materiais utilizados</button>
      <button className={tab === "medidores" ? "active" : ""} onClick={() => setTab("medidores")}><Gauge size={17} /> Medidores recebidos</button>
      <button className={tab === "sucata" ? "active" : ""} onClick={() => setTab("sucata")}><Trash2 size={17} /> Medidores sucata</button>
    </div>
    <section className="panel team-list-panel">
      <div className="team-list-tools"><label className="stock-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar código, material, série ou referência" /></label>{tab === "medidores" && canWarehouse && <button className="primary-button" onClick={() => setMeterFormOpen(true)}><Plus size={17} /> Vincular medidor</button>}</div>
      {paged.length === 0 ? <div className="team-empty"><PackageCheck size={31} /><h2>Nenhum registro nesta área</h2><p>{tab === "posse" ? "Os materiais aparecerão aqui quando uma requisição da equipe for entregue." : "O histórico será construído conforme a operação for registrada."}</p></div> : <div className="team-record-list">
        {tab === "posse" && (paged as typeof filteredPossession).map((entry) => { const material = materialById.get(entry.material_id); return <article key={entry.material_id}><span className="team-record-icon"><Boxes /></span><div className="team-record-main"><small>CÓD. {material?.internal_code}</small><strong>{material?.name}</strong><span>Recebido: {entry.received} · Última entrada: {localDate(entry.lastReceived)}</span></div><div className="team-balance"><small>DISPONÍVEL</small><strong>{entry.available}</strong><span>{material?.unit_of_measure}</span></div>{entry.available > 0 && <button className="primary-button" onClick={() => setUsingMaterial({ id: entry.material_id, available: entry.available })}><CheckCircle2 size={17} /> Marcar utilizado</button>}</article>; })}
        {tab === "utilizados" && (paged as Usage[]).map((entry) => { const material = materialById.get(entry.material_id); return <article key={entry.id}><span className="team-record-icon used"><History /></span><div className="team-record-main"><small>{entry.protocol}</small><strong>{material?.internal_code} — {material?.name}</strong><span>{entry.reference_type} {entry.reference_number}{entry.service_location ? ` · ${entry.service_location}` : ""}</span></div><div className="team-balance"><small>UTILIZADO</small><strong>{entry.quantity}</strong><span>{localDate(entry.used_on)}</span></div></article>; })}
        {(tab === "medidores" || tab === "sucata") && (paged as Meter[]).map((meter) => <article key={meter.id}><span className={`team-record-icon meter-${meter.status}`}><Gauge /></span><div className="team-record-main"><small>CÓD. {meter.internal_code}</small><strong>Série {meter.serial_number}</strong><span>{[meter.manufacturer, meter.model].filter(Boolean).join(" · ") || "Fabricante/modelo não informado"}</span>{meter.return_protocol && <em><ShieldCheck size={13} /> {meter.return_protocol}</em>}</div><span className={`meter-status meter-${meter.status}`}>{meterStatus[meter.status]}</span><div className="team-record-actions">{meter.status === "disponivel" && <button className="secondary-button" onClick={() => setMeterAction({ meter, to: "instalado" })}>Registrar instalação</button>}{["disponivel", "instalado"].includes(meter.status) && <button className="danger-button" onClick={() => setMeterAction({ meter, to: "aguardando_devolucao" })}>Marcar sucata</button>}{meter.status === "aguardando_devolucao" && canWarehouse && <button className="primary-button" onClick={() => setMeterAction({ meter, to: "devolvido" })}><QrCode size={16} /> Confirmar recebimento</button>}</div></article>)}
      </div>}
      <Pagination page={safePage} pageSize={pageSize} total={currentList.length} onPageChange={setPage} onPageSizeChange={setPageSize} noun="registros" />
    </section>

    {usingMaterial && <div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-backdrop" onClick={() => setUsingMaterial(null)} aria-label="Fechar" /><form className="team-form-modal" onSubmit={registerUsage}><header><div><span className="eyebrow">BAIXA DE RESPONSABILIDADE</span><h2>Registrar material utilizado</h2></div><button type="button" className="icon-button" onClick={() => setUsingMaterial(null)}><X size={19} /></button></header><p>O saldo será reduzido somente da posse da equipe. O estoque do almoxarifado não sofrerá uma segunda baixa.</p><div className="form-grid two"><label>Quantidade<input type="number" min="0.001" max={usingMaterial.available} step="0.001" value={usageForm.quantity} onChange={(e) => setUsageForm({ ...usageForm, quantity: e.target.value })} required /></label><label>Data de utilização<input type="date" value={usageForm.used_on} onChange={(e) => setUsageForm({ ...usageForm, used_on: e.target.value })} required /></label><label>Tipo de referência<select value={usageForm.reference_type} onChange={(e) => setUsageForm({ ...usageForm, reference_type: e.target.value })}><option>OC</option><option>NT</option><option value="outro">Outro</option></select></label><label>Número da OC/NT<input value={usageForm.reference_number} onChange={(e) => setUsageForm({ ...usageForm, reference_number: e.target.value })} required /></label><label className="full-field">Local ou serviço<input value={usageForm.service_location} onChange={(e) => setUsageForm({ ...usageForm, service_location: e.target.value })} placeholder="Opcional" /></label><label className="full-field">Observação<textarea rows={3} value={usageForm.notes} onChange={(e) => setUsageForm({ ...usageForm, notes: e.target.value })} /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setUsingMaterial(null)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? <Loader2 className="spin" /> : <CheckCircle2 />} Confirmar utilização</button></div></form></div>}
    {meterFormOpen && <div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-backdrop" onClick={() => setMeterFormOpen(false)} aria-label="Fechar" /><form className="team-form-modal" onSubmit={registerMeter}><header><div><span className="eyebrow">MEDIDOR SERIALIZADO</span><h2>Vincular medidor à equipe</h2></div><button type="button" className="icon-button" onClick={() => setMeterFormOpen(false)}><X size={19} /></button></header><div className="form-grid two"><label>Material do catálogo<select value={meterForm.material_id} onChange={(e) => { const material = materialById.get(e.target.value); setMeterForm({ ...meterForm, material_id: e.target.value, internal_code: material?.internal_code ?? meterForm.internal_code }); }}><option value="">Sem vínculo ao catálogo</option>{materials.filter((item) => item.status === "ativo").map((item) => <option key={item.id} value={item.id}>{item.internal_code} — {item.name}</option>)}</select></label><label>Código<input value={meterForm.internal_code} onChange={(e) => setMeterForm({ ...meterForm, internal_code: e.target.value })} required /></label><label>Número de série<input value={meterForm.serial_number} onChange={(e) => setMeterForm({ ...meterForm, serial_number: e.target.value })} required /></label><label>Fabricante<input value={meterForm.manufacturer} onChange={(e) => setMeterForm({ ...meterForm, manufacturer: e.target.value })} /></label><label className="full-field">Modelo<input value={meterForm.model} onChange={(e) => setMeterForm({ ...meterForm, model: e.target.value })} /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setMeterFormOpen(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? <Loader2 className="spin" /> : <Cable />} Vincular medidor</button></div></form></div>}
    {meterAction && <div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-backdrop" onClick={() => setMeterAction(null)} aria-label="Fechar" /><form className="team-form-modal" onSubmit={transitionMeter}><header><div><span className="eyebrow">SÉRIE {meterAction.meter.serial_number}</span><h2>{meterAction.to === "instalado" ? "Registrar instalação" : meterAction.to === "devolvido" ? "Confirmar devolução" : "Registrar medidor sucata"}</h2></div><button type="button" className="icon-button" onClick={() => setMeterAction(null)}><X size={19} /></button></header>{meterAction.to === "instalado" && <div className="form-grid two"><label>Referência<select value={meterActionForm.reference_type} onChange={(e) => setMeterActionForm({ ...meterActionForm, reference_type: e.target.value })}><option>OC</option><option>NT</option><option value="outro">Outro</option></select></label><label>Número<input value={meterActionForm.reference_number} onChange={(e) => setMeterActionForm({ ...meterActionForm, reference_number: e.target.value })} required /></label></div>}<label>{meterAction.to === "aguardando_devolucao" ? "Motivo e condição do medidor" : "Observação"}<textarea rows={4} value={meterActionForm.notes} onChange={(e) => setMeterActionForm({ ...meterActionForm, notes: e.target.value })} required={meterAction.to === "aguardando_devolucao"} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setMeterAction(null)}>Cancelar</button><button className={meterAction.to === "aguardando_devolucao" ? "danger-button" : "primary-button"} disabled={saving}>{saving ? <Loader2 className="spin" /> : <CheckCircle2 />} Confirmar</button></div></form></div>}
  </div>;
}
