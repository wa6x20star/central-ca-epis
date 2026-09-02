"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import "./PrivacyCenter.module.css";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";

type RequestType =
  | "confirm_access"
  | "correction"
  | "deletion"
  | "portability"
  | "sharing_information"
  | "consent_revocation"
  | "other";

type PrivacyRequest = {
  id: string;
  request_type: RequestType;
  subject: string;
  description: string;
  status: "pending" | "in_review" | "completed" | "rejected" | "cancelled";
  response_notes: string | null;
  requested_at: string;
  updated_at: string;
  handled_at: string | null;
};

const requestLabels: Record<RequestType, string> = {
  confirm_access: "Confirmar quais dados meus são tratados",
  correction: "Corrigir meus dados",
  deletion: "Solicitar exclusão de dados",
  portability: "Solicitar portabilidade, quando aplicável",
  sharing_information: "Saber com quem meus dados são compartilhados",
  consent_revocation: "Revogar consentimento, quando aplicável",
  other: "Outro pedido relacionado à LGPD",
};

const statusLabels: Record<PrivacyRequest["status"], string> = {
  pending: "Pendente",
  in_review: "Em análise",
  completed: "Concluído",
  rejected: "Indeferido",
  cancelled: "Cancelado",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function PrivacyCenter({
  supabaseUrl,
  supabaseKey,
}: {
  supabaseUrl: string;
  supabaseKey: string;
}) {
  const supabase = useMemo(
    () => (supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null),
    [supabaseKey, supabaseUrl],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [openSection, setOpenSection] = useState<string | null>("rights");
  const [requestType, setRequestType] = useState<RequestType>("confirm_access");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !session?.user.id) return;
    void loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, supabase]);

  async function loadRequests() {
    if (!supabase || !session?.user.id) return;
    const { data, error } = await supabase
      .from("privacy_requests")
      .select("id,request_type,subject,description,status,response_notes,requested_at,updated_at,handled_at")
      .eq("requester_id", session.user.id)
      .order("requested_at", { ascending: false });
    if (!error) setRequests((data ?? []) as PrivacyRequest[]);
  }

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !session?.user.id) {
      setMessage({ kind: "error", text: "Entre na Central para registrar uma solicitação de titular." });
      return;
    }
    if (subject.trim().length < 3 || description.trim().length < 3) {
      setMessage({ kind: "error", text: "Informe um assunto e uma descrição detalhada do pedido." });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const { error } = await supabase.from("privacy_requests").insert({
      requester_id: session.user.id,
      request_type: requestType,
      subject: subject.trim(),
      description: description.trim(),
    });
    if (error) {
      setMessage({ kind: "error", text: `Não foi possível registrar o pedido: ${error.message}` });
    } else {
      setSubject("");
      setDescription("");
      setMessage({ kind: "success", text: "Solicitação registrada. Ela ficará disponível para acompanhamento nesta página." });
      await loadRequests();
    }
    setSubmitting(false);
  }

  if (!supabase) {
    return <main className="privacy-page"><div className="privacy-card"><XCircle /><h1>Conexão indisponível</h1><p>As configurações do ambiente ainda não foram carregadas.</p></div></main>;
  }

  if (loading) {
    return <main className="privacy-page"><div className="privacy-card"><Loader2 className="privacy-spin" /><p>Carregando central de privacidade...</p></div></main>;
  }

  return (
    <main className="privacy-page">
      <div className="privacy-container">
        <header className="privacy-header">
          <a className="privacy-back" href="/" aria-label="Voltar para a Central do Almoxarifado"><ArrowLeft size={17} /> Voltar para a Central</a>
          <div className="privacy-hero">
            <div className="privacy-hero-icon"><ShieldCheck size={31} /></div>
            <div>
              <span className="privacy-eyebrow">TRANSPARÊNCIA E PROTEÇÃO DE DADOS</span>
              <h1>Privacidade e LGPD</h1>
              <p>Controle seus dados, entenda como eles são tratados e registre solicitações de titular de forma segura.</p>
            </div>
          </div>
          <div className="privacy-trust-row">
            <span><ShieldCheck size={16} /> Acesso protegido</span>
            <span><KeyRound size={16} /> Menor privilégio</span>
            <span><FileText size={16} /> Solicitações registradas</span>
          </div>
        </header>

        {!session && (
          <section className="privacy-login-note">
            <UserRound size={22} />
            <div><strong>Para solicitar seus dados, entre na Central.</strong><p>Você ainda pode consultar a política de privacidade sem autenticação.</p></div>
            <a className="privacy-primary" href="/">Entrar</a>
          </section>
        )}

        <section className="privacy-grid">
          <div className="privacy-main-column">
            <Accordion title="Seus direitos como titular" icon={<ShieldCheck size={19} />} open={openSection === "rights"} onClick={() => setOpenSection(openSection === "rights" ? null : "rights")}>
              <p>Você pode solicitar, conforme aplicável ao tratamento realizado, confirmação e acesso aos seus dados, correção, informações sobre compartilhamento, eliminação, portabilidade, revogação de consentimento e revisão de decisões automatizadas.</p>
              <div className="privacy-rights-grid">
                {[
                  ["Acesso", "Saber quais dados são tratados e obter acesso a eles."],
                  ["Correção", "Corrigir dados incompletos, inexatos ou desatualizados."],
                  ["Exclusão", "Solicitar eliminação quando a legislação permitir."],
                  ["Transparência", "Entender finalidades, compartilhamentos e critérios aplicáveis."],
                ].map(([title, text]) => <div key={title}><strong>{title}</strong><span>{text}</span></div>)}
              </div>
            </Accordion>

            <Accordion title="Como protegemos os dados" icon={<KeyRound size={19} />} open={openSection === "security"} onClick={() => setOpenSection(openSection === "security" ? null : "security")}>
              <p>A Central aplica controle de acesso por perfil, políticas de segurança no banco de dados, registro de operações administrativas e coleta apenas das informações necessárias para as funções do sistema.</p>
              <ul className="privacy-list"><li>Autenticação por conta individual.</li><li>Controle de acesso no backend, não apenas na interface.</li><li>Rastreamento de alterações administrativas relevantes.</li><li>Solicitações de titulares separadas do fluxo operacional.</li></ul>
            </Accordion>

            <Accordion title="Política de privacidade" icon={<FileText size={19} />} open={openSection === "policy"} onClick={() => setOpenSection(openSection === "policy" ? null : "policy")}>
              <h3>1. Finalidade</h3><p>Os dados são utilizados para autenticação, gestão de acesso, operação do almoxarifado, requisições, avaliações e segurança da plataforma, de acordo com a finalidade de cada recurso.</p>
              <h3>2. Compartilhamento</h3><p>O acesso aos dados é limitado às pessoas e serviços necessários à operação autorizada. Não se deve utilizar a Central para cadastrar informações pessoais que não tenham relação com a finalidade do sistema.</p>
              <h3>3. Retenção e segurança</h3><p>Os registros devem ser mantidos pelo período necessário às finalidades operacionais, legais e de auditoria, com controles de acesso e proteção compatíveis com o risco.</p>
              <h3>4. Seus pedidos</h3><p>Pedidos relacionados aos seus dados podem ser registrados nesta página. Alguns pedidos podem exigir verificação de identidade ou análise da base legal aplicável antes do atendimento.</p>
              <h3>5. Canal</h3><p>Para dúvidas sobre privacidade, utilize o canal interno definido pela organização responsável pela Central. Quando houver encarregado pelo tratamento de dados, seus dados de contato devem ser divulgados de forma clara e acessível.</p>
            </Accordion>
          </div>

          <aside className="privacy-side-column">
            <section className="privacy-request-card">
              <div className="privacy-card-heading"><div><span className="privacy-eyebrow">CANAL DO TITULAR</span><h2>Solicitar atendimento</h2></div><Mail size={20} /></div>
              {session ? <form onSubmit={submitRequest}>
                <label>Tipo de solicitação<select value={requestType} onChange={(event) => setRequestType(event.target.value as RequestType)}>{Object.entries(requestLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>Assunto<input value={subject} onChange={(event) => setSubject(event.target.value)} minLength={3} maxLength={160} placeholder="Ex.: correção do meu cadastro" /></label>
                <label>Detalhes<textarea value={description} onChange={(event) => setDescription(event.target.value)} minLength={3} maxLength={5000} rows={6} placeholder="Explique o que você precisa e, se necessário, indique quais dados devem ser analisados." /></label>
                <p className="privacy-helper">Não informe senha, token, dados bancários ou outras informações desnecessárias.</p>
                {message && <div className={`privacy-message ${message.kind}`}>{message.kind === "success" ? <CheckCircle2 size={17} /> : <XCircle size={17} />}{message.text}</div>}
                <button className="privacy-primary privacy-submit" type="submit" disabled={submitting}>{submitting ? <><Loader2 className="privacy-spin" size={17} /> Enviando...</> : "Registrar solicitação"}</button>
              </form> : <div className="privacy-auth-required"><UserRound size={23} /><p>Entre na Central para registrar e acompanhar uma solicitação associada à sua conta.</p><a className="privacy-primary" href="/">Entrar na Central</a></div>}
            </section>

            {session && <section className="privacy-history-card"><div className="privacy-card-heading"><div><span className="privacy-eyebrow">ACOMPANHAMENTO</span><h2>Minhas solicitações</h2></div><Clock3 size={20} /></div>{requests.length === 0 ? <p className="privacy-empty">Você ainda não registrou solicitações de privacidade.</p> : <div className="privacy-history-list">{requests.map((item) => <article key={item.id}><div><strong>{item.subject}</strong><span>{requestLabels[item.request_type]}</span></div><div className="privacy-history-meta"><span className={`privacy-status ${item.status}`}>{statusLabels[item.status]}</span><small>{formatDate(item.requested_at)}</small></div>{item.response_notes && <p>{item.response_notes}</p>}</article>)}</div>}</section>}
          </aside>
        </section>

        <footer className="privacy-footer"><span>Central do Almoxarifado · Privacidade e proteção de dados</span><span>Em caso de dúvida, utilize o canal de privacidade da organização.</span></footer>
      </div>
    </main>
  );
}

function Accordion({ title, icon, open, onClick, children }: { title: string; icon: React.ReactNode; open: boolean; onClick: () => void; children: React.ReactNode }) {
  return <section className={`privacy-accordion ${open ? "open" : ""}`}><button type="button" onClick={onClick} aria-expanded={open}><span>{icon}<strong>{title}</strong></span><ChevronDown size={18} /></button>{open && <div className="privacy-accordion-body">{children}</div>}</section>;
}
