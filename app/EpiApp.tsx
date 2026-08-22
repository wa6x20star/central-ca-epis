"use client";
/* eslint-disable @next/next/no-img-element */

import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import type {
  LabelSeed,
  MaterialRequest,
  MaterialRequestItem,
} from "./Requisitions";
import {
  assessPassword,
  authErrorMessage,
  canArchiveVariant,
  canAccessBase,
  filterApprovedCatalog,
  isValidArchiveReason,
  roleHasGlobalBaseAccess,
  roleRequiresAssignedBase,
  type PasswordAssessment,
} from "./domain";
import { Pagination } from "./Pagination";
import {
  ArrowLeft,
  BadgeCheck,
  Bell,
  BookOpen,
  Building2,
  Camera,
  Check,
  ChevronRight,
  ClipboardCheck,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileCheck2,
  HardHat,
  ImagePlus,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  LogOut,
  MapPin,
  Menu,
  MessageSquareText,
  MailCheck,
  Package,
  Pencil,
  Plus,
  PlusSquare,
  QrCode,
  RefreshCcw,
  Search,
  ShieldCheck,
  Moon,
  Sun,
  Tag,
  Star,
  Trash2,
  TriangleAlert,
  UploadCloud,
  UserPlus,
  Users,
  Warehouse,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

const Requisitions = lazy(() => import("./Requisitions"));
const Stock = lazy(() => import("./Stock"));
const TeamOperations = lazy(() => import("./TeamOperations"));

type Role = "consulta" | "almoxarife" | "aprovador" | "administrador" | "eletricista";
type AccountStatus = "pendente" | "ativo" | "inativo" | "bloqueado";
type NavGroup = "geral" | "conhecimento" | "seguranca" | "administracao";
type Section =
  | "painel"
  | "estoque"
  | "requisicoes"
  | "equipe"
  | "catalogo"
  | "tecnico"
  | "cadastro"
  | "aprovacoes"
  | "avaliacoes"
  | "usuarios";

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: Role;
  account_status: AccountStatus;
  requested_role: "consulta" | "almoxarife" | "eletricista" | null;
  requested_base_id: string | null;
  employee_number: string | null;
  requested_team_code: string | null;
  requested_partner_name: string | null;
  access_review_reason: string | null;
  created_at: string;
};

type Base = {
  id: string;
  name: string;
  abbreviation: string | null;
  city: string | null;
  state: string | null;
  is_active: boolean;
};

type UserBase = {
  id: string;
  user_id: string;
  base_id: string;
};

type Category = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type Material = {
  id: string;
  internal_code: string;
  name: string;
  category_id: string;
  unit_of_measure: string;
  status: string;
  description: string | null;
  notes: string | null;
};

type Variant = {
  id: string;
  material_id: string;
  brand: string;
  model_reference: string;
  ca_number: string;
  manufacturer_importer: string;
  official_description: string;
  protection_offered: string;
  restrictions: string | null;
  ca_valid_until: string | null;
  official_checked_at: string | null;
  official_url: string | null;
  photo_url: string | null;
  registration_status: string;
  rejection_reason: string | null;
  created_at: string;
};

type VariantBase = {
  id: string;
  variant_id: string;
  base_id: string;
  usage_status: string;
};

type CatalogItem = {
  variant_id: string;
  material_id: string;
  internal_code: string;
  material_name: string;
  category_name: string;
  brand: string;
  model_reference: string;
  ca_number: string;
  manufacturer_importer: string;
  protection_offered: string;
  ca_valid_until: string | null;
  registration_status: string;
  ca_status: string;
  official_checked_at: string | null;
  official_url: string | null;
  photo_url: string | null;
  bases: string[] | null;
};

type Evaluation = {
  id: string;
  variant_id: string;
  base_id: string;
  activity_performed: string;
  comfort_rating: number;
  resistance_rating: number;
  usage_days: number | null;
  comment: string | null;
  reported_problem: string | null;
  moderation_status: string;
  evaluation_date: string;
  created_by: string;
};

type EvaluationSummary = {
  variant_id: string;
  evaluation_count: number;
  comfort_average: number | null;
  resistance_average: number | null;
  average_usage_days: number | null;
};

type TechnicalItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string;
  technical_note: string | null;
  recommendation: string | null;
  photo_path: string;
  photo_url: string | null;
  status: "ativo" | "arquivado";
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type Toast = { kind: "success" | "error"; message: string } | null;
type Theme = "light" | "dark";

const roleLabels: Record<Role, string> = {
  consulta: "Consulta",
  almoxarife: "Almoxarife",
  aprovador: "Aprovador / SESMT",
  administrador: "Administrador",
  eletricista: "Eletricista",
};

const statusLabels: Record<AccountStatus, string> = {
  pendente: "Pendente",
  ativo: "Ativo",
  inativo: "Inativo",
  bloqueado: "Bloqueado",
};

const navItems: Array<{
  id: Section;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  roles?: Role[];
}> = [
  { id: "painel", label: "Visão geral", icon: LayoutDashboard, group: "geral" },
  { id: "estoque", label: "Estoque beta", icon: Package, group: "geral", roles: ["consulta", "almoxarife", "aprovador", "administrador"] },
  { id: "requisicoes", label: "Requisições QR", icon: QrCode, group: "geral", roles: ["consulta", "eletricista", "almoxarife", "aprovador", "administrador"] },
  { id: "equipe", label: "Minha equipe", icon: Users, group: "geral", roles: ["eletricista", "almoxarife", "administrador"] },
  { id: "tecnico", label: "Catálogo técnico", icon: BookOpen, group: "conhecimento" },
  { id: "catalogo", label: "Consultar C.A.", icon: Search, group: "seguranca" },
  {
    id: "cadastro",
    label: "Novo cadastro",
    icon: PlusSquare,
    group: "seguranca",
    roles: ["almoxarife", "aprovador", "administrador"],
  },
  {
    id: "aprovacoes",
    label: "Aprovações",
    icon: ClipboardCheck,
    group: "seguranca",
    roles: ["aprovador", "administrador"],
  },
  { id: "avaliacoes", label: "Avaliar EPI", icon: Star, group: "seguranca" },
  {
    id: "usuarios",
    label: "Usuários",
    icon: Users,
    group: "administracao",
    roles: ["administrador"],
  },
];

const navGroupLabels: Record<NavGroup, string> = {
  geral: "GERAL",
  conhecimento: "CONHECIMENTO",
  seguranca: "SEGURANÇA E EPIs",
  administracao: "ADMINISTRAÇÃO",
};

const selectColumns = {
  bases: "id,name,abbreviation,city,state,is_active",
  userBases: "id,user_id,base_id",
  categories: "id,code,name,is_active",
  materials: "id,internal_code,name,category_id,unit_of_measure,status,description,notes",
  variants: "id,material_id,brand,model_reference,ca_number,manufacturer_importer,official_description,protection_offered,restrictions,ca_valid_until,official_checked_at,official_url,photo_url,registration_status,rejection_reason,created_at",
  variantBases: "id,variant_id,base_id,usage_status",
  catalog: "variant_id,material_id,internal_code,material_name,category_name,brand,model_reference,ca_number,manufacturer_importer,protection_offered,ca_valid_until,registration_status,ca_status,official_checked_at,official_url,photo_url,bases",
  evaluations: "id,variant_id,base_id,activity_performed,comfort_rating,resistance_rating,usage_days,comment,reported_problem,moderation_status,evaluation_date,created_by",
  summaries: "variant_id,evaluation_count,comfort_average,resistance_average,average_usage_days",
  profiles: "id,email,display_name,role,account_status,requested_role,requested_base_id,employee_number,requested_team_code,requested_partner_name,access_review_reason,created_at",
  technicalItems: "id,code,name,category,description,technical_note,recommendation,photo_path,status,created_by,updated_by,created_at,updated_at",
  materialRequests: "id,request_number,base_id,withdrawal_date,team_number,team_id,participant_one,participant_two,separator_name,notes,status,status_note,stock_reserved_at,stock_posted_at,stock_posted_by,created_by,created_at,updated_at",
  materialRequestItems: "id,request_id,source_type,source_id,material_code,description,unit_of_measure,quantity,scanned,notes",
} as const;

function formatDate(value: string | null) {
  if (!value) return "Não informada";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${value.slice(0, 10)}T12:00:00Z`),
  );
}

function initials(value: string) {
  return value
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function caStatusLabel(status: string) {
  if (status === "vigente") return "C.A. vigente";
  if (status === "proximo_vencimento") return "Próximo do vencimento";
  if (status === "vencido") return "C.A. vencido";
  return "Não verificado";
}

function caStatusClass(status: string) {
  if (status === "vigente") return "status status-ok";
  if (status === "proximo_vencimento") return "status status-warn";
  if (status === "vencido") return "status status-danger";
  return "status status-neutral";
}

export default function EpiApp({
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [requestDataLoading, setRequestDataLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [section, setSection] = useState<Section>("painel");
  const [labelSeed, setLabelSeed] = useState<(LabelSeed & { nonce: number }) | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const toastTimer = useRef<number | null>(null);

  const [bases, setBases] = useState<Base[]>([]);
  const [userBases, setUserBases] = useState<UserBase[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [variantBases, setVariantBases] = useState<VariantBase[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [evaluationSummaries, setEvaluationSummaries] = useState<EvaluationSummary[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [technicalItems, setTechnicalItems] = useState<TechnicalItem[]>([]);
  const [materialRequests, setMaterialRequests] = useState<MaterialRequest[]>([]);
  const [materialRequestItems, setMaterialRequestItems] = useState<MaterialRequestItem[]>([]);

  const showToast = useCallback((kind: "success" | "error", message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ kind, message });
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 4600);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(null);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const clearOperationalData = useCallback(() => {
    setBases([]);
    setUserBases([]);
    setCategories([]);
    setMaterials([]);
    setVariants([]);
    setVariantBases([]);
    setCatalog([]);
    setEvaluations([]);
    setEvaluationSummaries([]);
    setProfiles([]);
    setTechnicalItems([]);
    setMaterialRequests([]);
    setMaterialRequestItems([]);
  }, []);

  const loadRequestItems = useCallback(async () => {
    if (!supabase) return;
    setRequestDataLoading(true);
    const { data, error } = await supabase
      .from("material_request_items")
      .select(selectColumns.materialRequestItems)
      .order("created_at");
    if (error) showToast("error", `Não foi possível carregar os itens das requisições: ${error.message}`);
    else setMaterialRequestItems((data ?? []) as MaterialRequestItem[]);
    setRequestDataLoading(false);
  }, [showToast, supabase]);

  const loadData = useCallback(
    async (currentProfile: Profile) => {
      if (!supabase || currentProfile.account_status !== "ativo") return;
      setDataLoading(true);
      const canManageUsers = currentProfile.role === "administrador";
      const [
        basesResult,
        userBasesResult,
        categoriesResult,
        materialsResult,
        variantsResult,
        variantBasesResult,
        catalogResult,
        evaluationsResult,
        summariesResult,
        profilesResult,
        technicalItemsResult,
        materialRequestsResult,
      ] = await Promise.all([
        supabase.from("bases").select(selectColumns.bases).order("name"),
        supabase.from("user_bases").select(selectColumns.userBases),
        supabase.from("epi_categories").select(selectColumns.categories).order("name"),
        supabase.from("materials").select(selectColumns.materials).order("name"),
        supabase.from("epi_variants").select(selectColumns.variants).order("created_at", { ascending: false }),
        supabase.from("variant_bases").select(selectColumns.variantBases),
        supabase.from("variant_catalog").select(selectColumns.catalog).eq("registration_status", "aprovado").order("material_name"),
        supabase.from("evaluations").select(selectColumns.evaluations).order("created_at", { ascending: false }),
        supabase.from("evaluation_summary").select(selectColumns.summaries),
        canManageUsers
          ? supabase.from("profiles").select(selectColumns.profiles).order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        supabase.from("technical_items").select(selectColumns.technicalItems).order("updated_at", { ascending: false }),
        supabase.from("material_requests").select(selectColumns.materialRequests).order("created_at", { ascending: false }),
      ]);

      const firstError = [
        basesResult.error,
        userBasesResult.error,
        categoriesResult.error,
        materialsResult.error,
        variantsResult.error,
        variantBasesResult.error,
        catalogResult.error,
        evaluationsResult.error,
        summariesResult.error,
        profilesResult.error,
        technicalItemsResult.error,
        materialRequestsResult.error,
      ].find(Boolean);

      if (firstError) {
        showToast("error", `Não foi possível carregar todos os dados: ${firstError.message}`);
      }

      setBases((basesResult.data ?? []) as Base[]);
      setUserBases((userBasesResult.data ?? []) as UserBase[]);
      setCategories((categoriesResult.data ?? []) as Category[]);
      setMaterials((materialsResult.data ?? []) as Material[]);
      setVariants((variantsResult.data ?? []) as Variant[]);
      setVariantBases((variantBasesResult.data ?? []) as VariantBase[]);
      const rawCatalog = filterApprovedCatalog((catalogResult.data ?? []) as CatalogItem[]);
      const photoPaths = [...new Set(rawCatalog.map((item) => item.photo_url).filter((path): path is string => Boolean(path)))];
      let catalogWithPhotos = rawCatalog;
      if (photoPaths.length > 0) {
        const { data: signedPhotos } = await supabase.storage.from("epi-photos").createSignedUrls(photoPaths, 3600);
        const signedByPath = new Map((signedPhotos ?? []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
        catalogWithPhotos = rawCatalog.map((item) => ({
          ...item,
          photo_url: item.photo_url ? signedByPath.get(item.photo_url) ?? null : null,
        }));
      }
      setCatalog(catalogWithPhotos);
      setEvaluations((evaluationsResult.data ?? []) as Evaluation[]);
      setEvaluationSummaries((summariesResult.data ?? []) as EvaluationSummary[]);
      setProfiles((profilesResult.data ?? []) as Profile[]);
      const rawTechnicalItems = (technicalItemsResult.data ?? []) as Omit<TechnicalItem, "photo_url">[];
      const technicalPhotoPaths = [...new Set(rawTechnicalItems.map((item) => item.photo_path).filter(Boolean))];
      let technicalItemsWithPhotos: TechnicalItem[] = rawTechnicalItems.map((item) => ({ ...item, photo_url: null }));
      if (technicalPhotoPaths.length > 0) {
        const { data: signedTechnicalPhotos } = await supabase.storage.from("technical-catalog").createSignedUrls(technicalPhotoPaths, 3600);
        const signedByPath = new Map((signedTechnicalPhotos ?? []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
        technicalItemsWithPhotos = rawTechnicalItems.map((item) => ({
          ...item,
          photo_url: signedByPath.get(item.photo_path) ?? null,
        }));
      }
      setTechnicalItems(technicalItemsWithPhotos);
      setMaterialRequests((materialRequestsResult.data ?? []) as MaterialRequest[]);
      setDataLoading(false);
    },
    [showToast, supabase],
  );

  const hydrateSession = useCallback(
    async (nextSession: Session | null) => {
      setSession(nextSession);
      if (!supabase || !nextSession?.user) {
        setProfile(null);
        clearOperationalData();
        setAuthLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", nextSession.user.id)
        .single();

      if (error || !data) {
        setProfile(null);
        setAuthLoading(false);
        showToast("error", "Seu perfil ainda não está disponível. Tente entrar novamente.");
        return;
      }

      const nextProfile = data as Profile;
      setProfile(nextProfile);
      setAuthLoading(false);
      if (nextProfile.account_status === "ativo") {
        await loadData(nextProfile);
      } else {
        clearOperationalData();
      }
    },
    [clearOperationalData, loadData, showToast, supabase],
  );

  useEffect(() => {
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data }) => hydrateSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
        setSession(nextSession);
        setAuthLoading(false);
        return;
      }
      if (event === "SIGNED_OUT") setPasswordRecovery(false);
      window.setTimeout(() => void hydrateSession(nextSession), 0);
    });

    return () => data.subscription.unsubscribe();
  }, [hydrateSession, supabase]);

  const sessionUserId = session?.user.id ?? null;
  const currentAccountStatus = profile?.account_status ?? null;

  const verifyAccountAccess = useCallback(async () => {
    if (!supabase || !sessionUserId || passwordRecovery) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", sessionUserId)
      .single();

    if (error || !data) return;

    const nextProfile = data as Profile;
    if (currentAccountStatus === "ativo" && nextProfile.account_status !== "ativo") {
      clearOperationalData();
      setSecurityOpen(false);
      showToast("error", "Seu acesso operacional foi encerrado. Procure o administrador.");
    }
    setProfile(nextProfile);
  }, [clearOperationalData, currentAccountStatus, passwordRecovery, sessionUserId, showToast, supabase]);

  useEffect(() => {
    if (!sessionUserId || passwordRecovery) return;
    const verify = () => void verifyAccountAccess();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") verify();
    };
    const interval = window.setInterval(verify, 30_000);
    window.addEventListener("focus", verify);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", verify);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [passwordRecovery, sessionUserId, verifyAccountAccess]);

  const activeProfileId = profile?.account_status === "ativo" ? profile.id : null;
  useEffect(() => {
    if (section !== "requisicoes" || !activeProfileId) return;
    const frame = window.requestAnimationFrame(() => void loadRequestItems());
    return () => window.cancelAnimationFrame(frame);
  }, [activeProfileId, loadRequestItems, section]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("almox-theme") as Theme | null;
    const preferredTheme = savedTheme === "dark" || savedTheme === "light"
      ? savedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    document.documentElement.dataset.theme = preferredTheme;
    const frame = window.requestAnimationFrame(() => setTheme(preferredTheme));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("almox-theme", nextTheme);
  };

  const refresh = async () => {
    if (!profile) return;
    await Promise.all([
      loadData(profile),
      section === "requisicoes" ? loadRequestItems() : Promise.resolve(),
    ]);
  };

  const isSyncing = dataLoading || requestDataLoading;

  const toastNotice = toast && (
    <div className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} aria-live={toast.kind === "error" ? "assertive" : "polite"}>
      {toast.kind === "success" ? <Check size={20} /> : <TriangleAlert size={20} />}
      <span>{toast.message}</span>
      <button onClick={dismissToast} aria-label="Fechar aviso"><X size={16} /></button>
      <i aria-hidden="true" />
    </div>
  );

  if (!supabase) {
    return (
      <main className="config-error">
        <div className="config-error-card">
          <Database size={30} />
          <h1>Conexão indisponível</h1>
          <p>As configurações do banco ainda não foram carregadas neste ambiente.</p>
        </div>
      </main>
    );
  }

  if (authLoading) {
    return (
      <main className="app-loader" aria-label="Carregando sistema">
        <div className="brand-mark"><Warehouse size={27} /></div>
        <Loader2 className="spin" size={30} />
        <p>Preparando a Central do Almoxarifado.</p>
      </main>
    );
  }

  if (passwordRecovery && session) {
    return <><ResetPasswordScreen supabase={supabase} showToast={showToast} theme={theme} toggleTheme={toggleTheme} onComplete={() => setPasswordRecovery(false)} />{toastNotice}</>;
  }

  if (!session) {
    return <><AuthScreen supabase={supabase} showToast={showToast} theme={theme} toggleTheme={toggleTheme} />{toastNotice}</>;
  }

  if (!profile || profile.account_status !== "ativo") {
    return (
      <PendingScreen
        profile={profile}
        email={session.user.email ?? "Conta sem e-mail"}
        onSignOut={() => void supabase.auth.signOut()}
        theme={theme}
        toggleTheme={toggleTheme}
      />
    );
  }

  const assignedBaseIds = userBases.filter((link) => link.user_id === session.user.id).map((link) => link.base_id);
  const hasGlobalBaseAccess = roleHasGlobalBaseAccess(profile.role);

  if (!hasGlobalBaseAccess && assignedBaseIds.length === 0) {
    return (
      <NoBaseScreen
        email={session.user.email ?? "Conta sem e-mail"}
        onSignOut={() => void supabase.auth.signOut()}
        theme={theme}
        toggleTheme={toggleTheme}
      />
    );
  }

  const availableNav = navItems.filter(
    (item) => !item.roles || item.roles.includes(profile.role),
  );
  const displayName = profile.display_name || profile.email || session.user.email || "Usuário";
  const accessibleBases = hasGlobalBaseAccess
    ? bases
    : bases.filter((base) => canAccessBase(profile.role, assignedBaseIds, base.id));
  const pendingReviewCount = variants.filter((variant) => variant.registration_status === "aguardando_validacao").length;
  const canReviewApprovals = profile.role === "aprovador" || profile.role === "administrador";
  const scopeLabel = hasGlobalBaseAccess
    ? "Todas as UTDs"
    : accessibleBases.length === 1
      ? accessibleBases[0]?.name || "UTD atribuída"
      : `${accessibleBases.length} UTDs atribuídas`;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Ir para o conteúdo principal</a>
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark"><Warehouse size={25} /></div>
          <div>
            <strong>Central do Almoxarifado</strong>
            <span>Operação e conhecimento</span>
          </div>
          <button className="icon-button mobile-only" onClick={() => setMobileNav(false)} aria-label="Fechar menu">
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Navegação principal">
          {(Object.keys(navGroupLabels) as NavGroup[]).map((group) => {
            const groupItems = availableNav.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            return <div className="nav-group" key={group}>
              <span className="nav-caption">{navGroupLabels[group]}</span>
              {groupItems.map((item) => {
                const Icon = item.icon;
                const count = item.id === "aprovacoes"
                  ? variants.filter((variant) => variant.registration_status === "aguardando_validacao").length
                  : 0;
                return <button key={item.id} className={`nav-item ${section === item.id ? "active" : ""}`} aria-current={section === item.id ? "page" : undefined} onClick={() => { setSection(item.id); setMobileNav(false); }}><Icon size={19} /><span>{item.label}</span>{count > 0 && <em>{count}</em>}</button>;
              })}
            </div>;
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-mini">
            <span className="avatar">{initials(displayName)}</span>
            <div>
              <strong>{displayName}</strong>
              <small>{roleLabels[profile.role]}</small>
            </div>
          </div>
          <button className="icon-button" onClick={() => void supabase.auth.signOut()} aria-label="Sair">
            <LogOut size={19} />
          </button>
        </div>
      </aside>

      {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="Fechar menu" />}

      <div className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMobileNav(true)} aria-label="Abrir menu">
            <Menu size={22} />
          </button>
          <div className="topbar-title">
            <span>CENTRAL DO ALMOXARIFADO</span>
            <strong>{navItems.find((item) => item.id === section)?.label}</strong>
          </div>
          <div className="topbar-scope" title="Escopo de dados disponível para este acesso"><MapPin size={14} /><span>{scopeLabel}</span></div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={() => setSecurityOpen(true)} aria-label="Segurança da conta" title="Segurança da conta">
              <KeyRound size={19} />
            </button>
            <button
              className="icon-button theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
              aria-pressed={theme === "dark"}
              title={theme === "dark" ? "Modo claro" : "Modo escuro"}
            >
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button className="icon-button" onClick={() => void refresh()} disabled={isSyncing} aria-label={isSyncing ? "Atualizando dados" : "Atualizar dados"} title="Atualizar">
              <RefreshCcw className={isSyncing ? "spin" : ""} size={19} />
            </button>
            {canReviewApprovals && <button className="icon-button notification-button" onClick={() => setSection("aprovacoes")} aria-label={pendingReviewCount ? `${pendingReviewCount} cadastros aguardando aprovação` : "Nenhuma aprovação pendente"} title="Aprovações"><Bell size={19} />{pendingReviewCount > 0 && <span>{pendingReviewCount > 9 ? "9+" : pendingReviewCount}</span>}</button>}
          </div>
          {isSyncing && <div className="topbar-progress" role="progressbar" aria-label="Atualizando dados"><i /></div>}
        </header>

        <main id="main-content" className={`workspace ${isSyncing ? "workspace-syncing" : ""}`} aria-busy={isSyncing}>
          <div className="section-enter" key={section}>
          {section === "painel" && (
            <Dashboard
              profile={profile}
              catalog={catalog}
              variants={variants}
              materials={materials}
              evaluations={evaluations}
              technicalItems={technicalItems}
              requestCount={materialRequests.length}
              setSection={setSection}
            />
          )}
          {section === "estoque" && (
            <Suspense fallback={<SectionLoading label="Carregando saldos e movimentações" />}>
              <Stock
                supabase={supabase}
                profile={profile}
                bases={accessibleBases}
                materials={materials}
                categories={categories}
                showToast={showToast}
              />
            </Suspense>
          )}
          {section === "requisicoes" && (
            <Suspense fallback={<SectionLoading label="Carregando requisições e recursos de QR Code" />}>
              <Requisitions
                key={`requisitions-${labelSeed?.nonce ?? "default"}`}
                supabase={supabase}
                userId={session.user.id}
                profile={profile}
                bases={accessibleBases}
                categories={categories}
                materials={materials}
                technicalItems={technicalItems}
                requests={materialRequests}
                requestItems={materialRequestItems}
                showToast={showToast}
                refresh={refresh}
                initialLabelSeed={labelSeed}
              />
            </Suspense>
          )}
          {section === "equipe" && (
            <Suspense fallback={<SectionLoading label="Carregando materiais e medidores da equipe" />}>
              <TeamOperations
                supabase={supabase}
                userId={session.user.id}
                role={profile.role}
                bases={accessibleBases}
                materials={materials}
                showToast={showToast}
              />
            </Suspense>
          )}
          {section === "catalogo" && (
            <Catalog
              supabase={supabase}
              catalog={catalog}
              summaries={evaluationSummaries}
              evaluations={evaluations}
              variants={variants}
              role={profile.role}
              showToast={showToast}
              refresh={refresh}
            />
          )}
          {section === "tecnico" && (
            <TechnicalCatalog
              supabase={supabase}
              items={technicalItems}
              userId={session.user.id}
              role={profile.role}
              showToast={showToast}
              refresh={refresh}
              onGenerateLabel={(item) => {
                setLabelSeed({ source_type: "tecnico", source_id: item.id, nonce: Date.now() });
                setSection("requisicoes");
              }}
            />
          )}
          {section === "cadastro" && (
            <Registration
              supabase={supabase}
              categories={categories}
              materials={materials}
              bases={bases}
              variants={variants}
              userId={session.user.id}
              role={profile.role}
              showToast={showToast}
              refresh={refresh}
              actionLoading={actionLoading}
              setActionLoading={setActionLoading}
            />
          )}
          {section === "aprovacoes" && (
            <Approvals
              supabase={supabase}
              variants={variants}
              materials={materials}
              evaluations={evaluations}
              bases={bases}
              userId={session.user.id}
              showToast={showToast}
              refresh={refresh}
            />
          )}
          {section === "avaliacoes" && (
            <EvaluationForm
              supabase={supabase}
              catalog={catalog}
              variants={variants}
              variantBases={variantBases}
              bases={bases}
              showToast={showToast}
              refresh={refresh}
            />
          )}
          {section === "usuarios" && (
            <UserManagement
              supabase={supabase}
              profiles={profiles}
              bases={bases}
              userBases={userBases}
              currentUserId={session.user.id}
              showToast={showToast}
              refresh={refresh}
            />
          )}
          </div>
        </main>
      </div>

      {securityOpen && <AccountSecurityModal supabase={supabase} email={session.user.email ?? ""} onClose={() => setSecurityOpen(false)} showToast={showToast} />}
      {toastNotice}
    </div>
  );
}

function AuthScreen({
  supabase,
  showToast,
  theme,
  toggleTheme,
}: {
  supabase: ReturnType<typeof createClient>;
  showToast: (kind: "success" | "error", message: string) => void;
  theme: Theme;
  toggleTheme: () => void;
}) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [requestedRole, setRequestedRole] = useState<"consulta" | "almoxarife" | "eletricista">("eletricista");
  const [requestedBaseId, setRequestedBaseId] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [registrationBases, setRegistrationBases] = useState<Array<Pick<Base, "id" | "name" | "abbreviation">>>([]);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const passwordAssessment = assessPassword(password);

  useEffect(() => {
    void supabase.rpc("registration_base_options").then(({ data, error }) => {
      if (!error) setRegistrationBases((data ?? []) as Array<Pick<Base, "id" | "name" | "abbreviation">>);
    });
  }, [supabase]);

  const changeMode = (nextMode: "login" | "signup" | "forgot") => {
    setMode(nextMode);
    setPassword("");
    setVisible(false);
    setRecoverySent(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) showToast("error", authErrorMessage(error.message));
    } else if (mode === "signup") {
      if (!passwordAssessment.valid) {
        showToast("error", "Crie uma senha que atenda a todos os requisitos.");
        setLoading(false);
        return;
      }
      if (!requestedBaseId) {
        showToast("error", "Selecione a UTD onde você trabalha.");
        setLoading(false);
        return;
      }
      if (requestedRole === "eletricista" && !teamCode.trim()) {
        showToast("error", "Informe o número da equipe ou identificação da dupla.");
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            requested_role: requestedRole,
            requested_base_id: requestedBaseId,
            employee_number: employeeNumber.trim() || null,
            team_code: requestedRole === "eletricista" ? teamCode.trim() : null,
            partner_name: requestedRole === "eletricista" ? partnerName.trim() || null : null,
          },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) {
        showToast("error", authErrorMessage(error.message));
      } else if (!data.session) {
        showToast("success", "Conta criada. Confirme o e-mail e aguarde a liberação do administrador.");
        changeMode("login");
      }
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) {
        showToast("error", authErrorMessage(error.message));
      } else {
        setRecoverySent(true);
      }
    }
    setLoading(false);
  };

  const title = mode === "login" ? "Bem-vindo de volta" : mode === "signup" ? "Solicitar acesso" : "Recuperar sua senha";
  const description = mode === "login"
    ? "Entre com sua conta corporativa."
    : mode === "signup"
      ? "Crie sua conta. Um administrador fará a liberação."
      : "Informe seu e-mail para receber um link seguro de redefinição.";

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand">
          <div className="brand-mark brand-mark-light"><Warehouse size={28} /></div>
          <div><strong>Central do Almoxarifado</strong><span>Operação, segurança e conhecimento</span></div>
        </div>
        <div className="story-content">
          <span className="eyebrow">INFORMAÇÃO CERTA, NO MOMENTO CERTO</span>
          <h1>Tudo do almoxarifado,<br />em um só lugar.</h1>
          <p>Consulte C.A.s, compartilhe conhecimento técnico e organize as próximas rotinas digitais da operação.</p>
          <div className="story-points">
            <div><BadgeCheck size={20} /><span><strong>Segurança documentada</strong><small>C.A.s e informações validadas pelo SESMT</small></span></div>
            <div><BookOpen size={20} /><span><strong>Conhecimento compartilhado</strong><small>Aplicações práticas construídas pela equipe</small></span></div>
            <div><QrCode size={20} /><span><strong>Operação em evolução</strong><small>Estrutura preparada para requisições por QR Code</small></span></div>
          </div>
        </div>
        <small className="story-footer">Plataforma interna de apoio ao almoxarifado</small>
      </section>

      <section className="auth-panel">
        <button
          className="icon-button auth-theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
          title={theme === "dark" ? "Modo claro" : "Modo escuro"}
        >
          {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        </button>
        <div className="auth-card">
          <div className="auth-card-heading">
            <span className="mobile-brand"><Warehouse size={24} /> Central do Almoxarifado</span>
            {mode === "forgot" && <button className="auth-back" type="button" onClick={() => changeMode("login")}><ArrowLeft size={16} /> Voltar ao login</button>}
            <h2>{title}</h2>
            <p>{description}</p>
          </div>

          {mode !== "forgot" && <div className="auth-tabs" role="tablist">
            <button className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>Entrar</button>
            <button className={mode === "signup" ? "active" : ""} onClick={() => changeMode("signup")}>Criar conta</button>
          </div>}

          {recoverySent ? <div className="recovery-confirmation" role="status">
            <span><MailCheck size={28} /></span>
            <h3>Verifique seu e-mail</h3>
            <p>Se houver uma conta cadastrada para <strong>{email}</strong>, o link de redefinição chegará em instantes.</p>
            <small>Por segurança, não informamos se o endereço está cadastrado. Confira também a caixa de spam.</small>
            <button className="secondary-button" type="button" onClick={() => changeMode("login")}><ArrowLeft size={17} /> Voltar ao login</button>
          </div> : <form className={`auth-form ${mode === "forgot" ? "auth-form-forgot" : ""}`} onSubmit={submit}>
            {mode === "signup" && (
              <>
                <label>Nome completo<input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome" required /></label>
                <label>Como você utilizará o sistema?<select value={requestedRole} onChange={(e) => setRequestedRole(e.target.value as typeof requestedRole)} required><option value="eletricista">Eletricista</option><option value="almoxarife">Almoxarife</option><option value="consulta">Somente consulta</option></select></label>
                <label>UTD principal<select value={requestedBaseId} onChange={(e) => setRequestedBaseId(e.target.value)} required><option value="">Selecione sua UTD</option>{registrationBases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label>
                <label>Matrícula <small className="field-hint">Opcional</small><input value={employeeNumber} onChange={(e) => setEmployeeNumber(e.target.value)} placeholder="Número funcional" maxLength={40} /></label>
                {requestedRole === "eletricista" && <div className="signup-team-fields"><label>Número da equipe ou dupla<input value={teamCode} onChange={(e) => setTeamCode(e.target.value)} placeholder="Ex.: Equipe 27" required maxLength={60} /></label><label>Segundo participante <small className="field-hint">Opcional</small><input value={partnerName} onChange={(e) => setPartnerName(e.target.value)} placeholder="Nome do parceiro da dupla" maxLength={120} /></label></div>}
              </>
            )}
            <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com.br" required autoComplete="email" /></label>
            {mode !== "forgot" && <label>Senha<span className="password-field"><input type={visible ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "signup" ? "Crie uma senha forte" : "Digite sua senha"} required autoComplete={mode === "login" ? "current-password" : "new-password"} /><button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Ocultar senha" : "Mostrar senha"}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>}
            {mode === "login" && <button className="forgot-password" type="button" onClick={() => changeMode("forgot")}>Esqueci minha senha</button>}
            {mode === "signup" && <PasswordStrength assessment={passwordAssessment} />}
            <button className="primary-button auth-submit" disabled={loading}>
              {loading ? <Loader2 className="spin" size={19} /> : mode === "login" ? <ShieldCheck size={19} /> : mode === "signup" ? <UserPlus size={19} /> : <MailCheck size={19} />}
              {loading ? "Aguarde..." : mode === "login" ? "Entrar no sistema" : mode === "signup" ? "Criar minha conta" : "Enviar link seguro"}
            </button>
          </form>}
          <p className="privacy-note"><ShieldCheck size={15} /> Acesso protegido e informações separadas por perfil.</p>
        </div>
      </section>
    </main>
  );
}

function PasswordStrength({ assessment }: { assessment: PasswordAssessment }) {
  return <div className={`password-strength strength-${assessment.score}`} aria-live="polite">
    <div className="strength-heading"><span>Força da senha</span><strong>{assessment.label}</strong></div>
    <div className="strength-bar" aria-hidden="true"><i /><i /><i /></div>
    <div className="password-rules">{assessment.rules.map((rule) => <span className={rule.met ? "met" : ""} key={rule.label}><Check size={13} /> {rule.label}</span>)}</div>
  </div>;
}

function ResetPasswordScreen({
  supabase,
  showToast,
  theme,
  toggleTheme,
  onComplete,
}: {
  supabase: ReturnType<typeof createClient>;
  showToast: (kind: "success" | "error", message: string) => void;
  theme: Theme;
  toggleTheme: () => void;
  onComplete: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const assessment = assessPassword(password);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!assessment.valid) {
      showToast("error", "Crie uma senha que atenda a todos os requisitos.");
      return;
    }
    if (password !== confirmation) {
      showToast("error", "As senhas informadas não são iguais.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      showToast("error", authErrorMessage(error.message));
      setLoading(false);
      return;
    }
    await supabase.auth.signOut({ scope: "global" });
    onComplete();
    showToast("success", "Senha atualizada. Entre novamente com a nova senha.");
  };

  return <main className="pending-page reset-password-page">
    <button className="icon-button auth-theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
    <form className="reset-password-card" onSubmit={submit}>
      <div className="pending-icon reset-icon"><KeyRound size={34} /></div>
      <span className="eyebrow">SEGURANÇA DA CONTA</span>
      <h1>Crie uma nova senha</h1>
      <p>Use uma senha exclusiva para a Central do Almoxarifado.</p>
      <div className="auth-form">
        <label>Nova senha<span className="password-field"><input type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required autoFocus /><button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Ocultar senha" : "Mostrar senha"}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
        <label>Confirme a nova senha<input type={visible ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required /></label>
        <PasswordStrength assessment={assessment} />
        <button className="primary-button auth-submit" disabled={loading}>{loading ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />} {loading ? "Atualizando..." : "Salvar nova senha"}</button>
      </div>
    </form>
  </main>;
}

function AccountSecurityModal({
  supabase,
  email,
  onClose,
  showToast,
}: {
  supabase: ReturnType<typeof createClient>;
  email: string;
  onClose: () => void;
  showToast: (kind: "success" | "error", message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const sendReset = async () => {
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) {
      showToast("error", authErrorMessage(error.message));
    } else {
      setSent(true);
      showToast("success", "Link de redefinição enviado para seu e-mail.");
    }
    setLoading(false);
  };

  return <div className="modal-layer security-modal-layer" role="dialog" aria-modal="true" aria-labelledby="security-title">
    <button className="modal-backdrop" onClick={onClose} aria-label="Fechar segurança da conta" />
    <section className="security-modal">
      <div className="security-modal-heading"><span><KeyRound size={23} /></span><div><small>CONTA E ACESSO</small><h2 id="security-title">Segurança da conta</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button></div>
      <div className="security-modal-body">
        <div className="security-email"><MailCheck size={19} /><span><small>E-mail de recuperação</small><strong>{email}</strong></span></div>
        <h3>Alterar sua senha</h3>
        <p>Enviaremos um link seguro para você definir uma nova senha. Depois da alteração, todas as sessões abertas serão encerradas.</p>
        <button className="primary-button" onClick={() => void sendReset()} disabled={loading || sent}>{loading ? <Loader2 className="spin" size={18} /> : sent ? <Check size={18} /> : <MailCheck size={18} />} {sent ? "Link enviado" : loading ? "Enviando..." : "Enviar link de redefinição"}</button>
        <div className="security-tip"><ShieldCheck size={18} /><span>Use uma senha exclusiva, com pelo menos 12 caracteres, letras, número e símbolo.</span></div>
      </div>
    </section>
  </div>;
}

function PendingScreen({
  profile,
  email,
  onSignOut,
  theme,
  toggleTheme,
}: {
  profile: Profile | null;
  email: string;
  onSignOut: () => void;
  theme: Theme;
  toggleTheme: () => void;
}) {
  const blocked = profile?.account_status === "bloqueado" || profile?.account_status === "inativo";
  return (
    <main className="pending-page">
      <button
        className="icon-button auth-theme-toggle"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
        title={theme === "dark" ? "Modo claro" : "Modo escuro"}
      >
        {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
      </button>
      <div className="pending-card">
        <div className={`pending-icon ${blocked ? "blocked" : ""}`}>
          {blocked ? <TriangleAlert size={34} /> : <FileCheck2 size={34} />}
        </div>
        <span className="eyebrow">CENTRAL DO ALMOXARIFADO</span>
        <h1>{blocked ? "Acesso indisponível" : "Cadastro recebido"}</h1>
        <p>{blocked ? "Esta conta está inativa ou bloqueada. Procure o administrador." : "Sua conta foi criada e aguarda a liberação de um administrador."}</p>
        <div className="pending-email">{email}</div>
        <button className="secondary-button" onClick={onSignOut}><LogOut size={18} /> Sair desta conta</button>
      </div>
    </main>
  );
}

function NoBaseScreen({
  email,
  onSignOut,
  theme,
  toggleTheme,
}: {
  email: string;
  onSignOut: () => void;
  theme: Theme;
  toggleTheme: () => void;
}) {
  return (
    <main className="pending-page">
      <button
        className="icon-button auth-theme-toggle"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
        title={theme === "dark" ? "Modo claro" : "Modo escuro"}
      >
        {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
      </button>
      <div className="pending-card no-base-card">
        <div className="pending-icon base-required"><Building2 size={34} /></div>
        <span className="eyebrow">ACESSO POR UTD</span>
        <h1>UTD ainda não atribuída</h1>
        <p>Seu cadastro está ativo, mas precisa ser vinculado a pelo menos uma UTD antes de acessar os dados operacionais.</p>
        <div className="pending-guidance"><ShieldCheck size={18} /><span>Peça ao administrador para selecionar sua unidade em <strong>Usuários e permissões</strong>.</span></div>
        <div className="pending-email">{email}</div>
        <button className="secondary-button" onClick={onSignOut}><LogOut size={18} /> Sair desta conta</button>
      </div>
    </main>
  );
}

function Dashboard({
  profile,
  catalog,
  variants,
  materials,
  evaluations,
  technicalItems,
  requestCount,
  setSection,
}: {
  profile: Profile;
  catalog: CatalogItem[];
  variants: Variant[];
  materials: Material[];
  evaluations: Evaluation[];
  technicalItems: TechnicalItem[];
  requestCount: number;
  setSection: (section: Section) => void;
}) {
  const pending = variants.filter((variant) => variant.registration_status === "aguardando_validacao").length;
  const expiring = catalog.filter((item) => item.ca_status === "proximo_vencimento" || item.ca_status === "vencido").length;
  const firstName = (profile.display_name || profile.email || "Usuário").split(" ")[0];

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div><span className="eyebrow">PAINEL OPERACIONAL</span><h1>Olá, {firstName}.</h1><p>A Central reúne segurança, conhecimento técnico e as próximas rotinas digitais do almoxarifado.</p></div>
        <div className="welcome-actions"><span className="system-pill"><i aria-hidden="true" /> Sistema operacional</span><button className="primary-button" onClick={() => setSection("tecnico")}><BookOpen size={18} /> Abrir catálogo técnico</button></div>
      </section>

      <section className="module-hub" aria-label="Módulos da Central do Almoxarifado">
        <button className="module-card module-ca" onClick={() => setSection("catalogo")}><span className="module-icon"><ShieldCheck size={25} /></span><span className="module-copy"><small>MÓDULO ATIVO</small><strong>Central de C.A. de EPIs</strong><em>Consulta, cadastro, validação e avaliações.</em></span><ChevronRight size={21} /></button>
        <button className="module-card module-knowledge" onClick={() => setSection("tecnico")}><span className="module-icon"><BookOpen size={25} /></span><span className="module-copy"><small>MÓDULO ATIVO</small><strong>Catálogo Técnico Vivo</strong><em>Aplicações, compatibilidades e recomendações.</em></span><ChevronRight size={21} /></button>
        <button className="module-card module-qr" onClick={() => setSection("requisicoes")}><span className="module-icon"><QrCode size={25} /></span><span className="module-copy"><small>MÓDULO ATIVO · {requestCount} REGISTROS</small><strong>Requisições por QR Code</strong><em>Leitura pelo celular, separação, histórico e PDF.</em></span><ChevronRight size={21} /></button>
        {profile.role !== "eletricista" && <button className="module-card module-stock" onClick={() => setSection("estoque")}><span className="module-icon"><Package size={25} /></span><span className="module-copy"><small>BETA OPERACIONAL</small><strong>Estoque por UTD</strong><em>Saldos isolados, movimentações e rastreabilidade.</em></span><ChevronRight size={21} /></button>}
        {["eletricista", "almoxarife", "administrador"].includes(profile.role) && <button className="module-card module-team" onClick={() => setSection("equipe")}><span className="module-icon"><Users size={25} /></span><span className="module-copy"><small>NOVO MÓDULO</small><strong>Minha Equipe</strong><em>Materiais em posse, utilização, medidores e devoluções.</em></span><ChevronRight size={21} /></button>}
      </section>

      <section className="metrics-grid">
        <MetricCard icon={Package} tone="blue" label="Materiais e variantes" value={materials.length + catalog.length} detail="Base de EPIs cadastrada" />
        <MetricCard icon={BookOpen} tone="green" label="Conhecimento técnico" value={technicalItems.filter((item) => item.status === "ativo").length} detail="Itens compartilhados pela equipe" />
        <MetricCard icon={ClipboardCheck} tone="amber" label="Aguardando validação" value={pending} detail="Revisão do SESMT" />
        <MetricCard icon={TriangleAlert} tone="red" label="Atenção necessária" value={expiring} detail="C.A.s vencidos ou próximos" />
      </section>

      <section className="dashboard-grid">
        <article className="panel dashboard-catalog">
          <div className="panel-heading"><div><span className="eyebrow">CATÁLOGO RECENTE</span><h2>Equipamentos disponíveis</h2></div><button className="text-button" onClick={() => setSection("catalogo")}>Ver catálogo <ChevronRight size={17} /></button></div>
          {catalog.length === 0 ? <EmptyState icon={HardHat} title="Nenhum EPI aprovado" text="Quando os primeiros cadastros forem validados, eles aparecerão aqui." /> : (
            <div className="compact-list">
              {catalog.slice(0, 5).map((item) => (
                <div className="compact-item" key={item.variant_id}>
                  <span className="item-icon"><HardHat size={20} /></span>
                  <div className="item-main"><strong>{item.material_name}</strong><small>Cód. {item.internal_code} · {item.brand} {item.model_reference}</small></div>
                  <div className="item-ca"><small>C.A.</small><strong>{item.ca_number}</strong></div>
                  <span className={caStatusClass(item.ca_status)}>{caStatusLabel(item.ca_status)}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <aside className="panel quick-panel">
          <div className="panel-heading"><div><span className="eyebrow">ACESSO RÁPIDO</span><h2>Atalhos</h2></div></div>
          <button onClick={() => setSection("catalogo")}><span className="quick-icon blue"><Search size={20} /></span><span><strong>Consultar C.A.</strong><small>Por código, marca ou certificado</small></span><ChevronRight size={18} /></button>
          <button onClick={() => setSection("tecnico")}><span className="quick-icon green"><BookOpen size={20} /></span><span><strong>Catálogo técnico</strong><small>Aplicações e recomendações práticas</small></span><ChevronRight size={18} /></button>
          <button onClick={() => setSection("requisicoes")}><span className="quick-icon amber"><QrCode size={20} /></span><span><strong>Requisições QR</strong><small>Registrar retirada ou consultar histórico</small></span><ChevronRight size={18} /></button>
          {profile.role !== "eletricista" && <button onClick={() => setSection("estoque")}><span className="quick-icon green"><Package size={20} /></span><span><strong>Consultar estoque</strong><small>Saldos autorizados por UTD</small></span><ChevronRight size={18} /></button>}
          {["eletricista", "almoxarife", "administrador"].includes(profile.role) && <button onClick={() => setSection("equipe")}><span className="quick-icon green"><Users size={20} /></span><span><strong>Minha equipe</strong><small>Materiais em posse e medidores</small></span><ChevronRight size={18} /></button>}
          {["almoxarife", "aprovador", "administrador"].includes(profile.role) && <button onClick={() => setSection("cadastro")}><span className="quick-icon amber"><Plus size={20} /></span><span><strong>Novo cadastro</strong><small>Material ou nova marca</small></span><ChevronRight size={18} /></button>}
          <button onClick={() => setSection("avaliacoes")}><span className="quick-icon blue"><Star size={20} /></span><span><strong>Avaliar um EPI</strong><small>Registrar experiência de uso</small></span><ChevronRight size={18} /></button>
          <div className="quick-summary"><MessageSquareText size={21} /><span><strong>{evaluations.filter((item) => item.moderation_status === "publicada").length} avaliações publicadas</strong><small>Conhecimento compartilhado entre as bases</small></span></div>
        </aside>
      </section>
    </div>
  );
}

function MetricCard({ icon: Icon, tone, label, value, detail }: { icon: LucideIcon; tone: string; label: string; value: number; detail: string }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}><Icon size={22} /></span><div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div></article>;
}

function StoredPhoto({ supabase, path, alt, className }: { supabase: ReturnType<typeof createClient>; path: string | null; alt: string; className: string }) {
  const [signedPhoto, setSignedPhoto] = useState<{ path: string; url: string } | null>(null);

  useEffect(() => {
    let active = true;
    if (!path) return () => { active = false; };
    void supabase.storage.from("epi-photos").createSignedUrl(path, 3600).then(({ data }) => {
      if (active && data?.signedUrl) setSignedPhoto({ path, url: data.signedUrl });
    });
    return () => { active = false; };
  }, [path, supabase]);

  const signedUrl = signedPhoto?.path === path ? signedPhoto.url : null;
  if (!signedUrl) return <span className={`${className} photo-fallback`}><HardHat size={30} /><small>Sem foto</small></span>;
  return <img className={className} src={signedUrl} alt={alt} loading="lazy" />;
}

function Catalog({
  supabase,
  catalog,
  summaries,
  evaluations,
  variants,
  role,
  showToast,
  refresh,
}: {
  supabase: ReturnType<typeof createClient>;
  catalog: CatalogItem[];
  summaries: EvaluationSummary[];
  evaluations: Evaluation[];
  variants: Variant[];
  role: Role;
  showToast: (kind: "success" | "error", message: string) => void;
  refresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("todos");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const normalized = query.trim().toLowerCase();
  const filtered = catalog.filter((item) => {
    const haystack = [item.internal_code, item.material_name, item.brand, item.model_reference, item.ca_number, item.manufacturer_importer, ...(item.bases ?? [])].join(" ").toLowerCase();
    return item.registration_status === "aprovado" && (!normalized || haystack.includes(normalized)) && (status === "todos" || item.ca_status === status);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedFiltered = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const summary = selected ? summaries.find((item) => item.variant_id === selected.variant_id) : null;
  const variant = selected ? variants.find((item) => item.id === selected.variant_id) : null;
  const comments = selected ? evaluations.filter((item) => item.variant_id === selected.variant_id && item.moderation_status === "publicada") : [];

  const closeDetails = () => {
    if (deleting) return;
    setSelected(null);
    setDeleteOpen(false);
    setDeleteReason("");
  };

  const archiveSelected = async () => {
    if (!selected || !canArchiveVariant(role)) return;
    if (!isValidArchiveReason(deleteReason)) {
      showToast("error", "Informe uma justificativa entre 10 e 1000 caracteres.");
      return;
    }

    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("archive-ca-and-notify", {
      body: { variant_id: selected.variant_id, reason: deleteReason.trim() },
    });
    const result = data as { archived?: boolean; email_sent?: boolean; error?: string } | null;

    if (error || !result?.archived) {
      showToast("error", result?.error ?? error?.message ?? "Não foi possível excluir o C.A.");
      setDeleting(false);
      return;
    }

    await refresh();
    setSelected(null);
    setDeleteOpen(false);
    setDeleteReason("");
    setDeleting(false);

    if (result.email_sent) {
      showToast("success", "C.A. excluído e comprovante enviado para wagsil640@gmail.com.");
    } else {
      showToast("error", result.error ?? "C.A. excluído, mas o e-mail ficou pendente.");
    }
  };

  return (
    <div className="page-stack">
      <section className="page-heading"><div><span className="eyebrow">BASE INTERNA DE EPIs</span><h1>Consultar Certificados de Aprovação</h1><p>Pesquise pelo código interno, equipamento, marca, modelo, fabricante ou número do C.A.</p></div></section>
      <section className="search-panel">
        <div className="search-box"><Search size={21} /><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Ex.: 452656, bota, marca ou número do C.A." autoFocus /></div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filtrar por situação">
          <option value="todos">Todas as situações</option><option value="vigente">Vigentes</option><option value="proximo_vencimento">Próximos do vencimento</option><option value="vencido">Vencidos</option>
        </select>
      </section>
      <div className="results-caption"><strong>{filtered.length}</strong> {filtered.length === 1 ? "resultado encontrado" : "resultados encontrados"}</div>
      {filtered.length === 0 ? <section className="panel"><EmptyState icon={Search} title="Nenhum equipamento encontrado" text={catalog.length ? "Revise o termo pesquisado ou limpe os filtros." : "O catálogo ainda não possui variantes aprovadas."} /></section> : (
        <><section className="catalog-grid">
          {pagedFiltered.map((item) => {
            const itemSummary = summaries.find((entry) => entry.variant_id === item.variant_id);
            return (
              <article className="catalog-card" key={item.variant_id}>
                <div className="catalog-photo-frame">
                  {item.photo_url ? <img src={item.photo_url} alt={`${item.material_name} ${item.brand} ${item.model_reference}`} loading="lazy" /> : <span className="photo-fallback"><HardHat size={32} /><small>Sem foto</small></span>}
                  <span className={caStatusClass(item.ca_status)}>{caStatusLabel(item.ca_status)}</span>
                </div>
                <span className="catalog-code">CÓD. {item.internal_code}</span><h2>{item.material_name}</h2><p className="catalog-brand">{item.brand} · {item.model_reference}</p>
                <div className="ca-highlight"><span>CERTIFICADO DE APROVAÇÃO</span><strong>C.A. {item.ca_number}</strong></div>
                <div className="catalog-meta"><span><Building2 size={16} /> {(item.bases ?? []).join(", ") || "Sem UTD vinculada"}</span><span><Star size={16} /> {itemSummary?.comfort_average ? `${Number(itemSummary.comfort_average).toFixed(1)} em conforto` : "Sem avaliações"}</span></div>
                <button className="card-link" onClick={() => setSelected(item)}>Ver detalhes e avaliações <ChevronRight size={17} /></button>
              </article>
            );
          })}
        </section><Pagination page={safePage} pageSize={pageSize} total={filtered.length} noun="resultados" onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} /></>
      )}

      {selected && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Detalhes do equipamento">
          <button className="modal-backdrop" onClick={closeDetails} aria-label="Fechar detalhes" />
          <aside className="detail-drawer">
            <div className="drawer-head"><div><span className="eyebrow">DETALHES DO EQUIPAMENTO</span><h2>{selected.material_name}</h2></div><button className="icon-button" onClick={closeDetails} disabled={deleting} aria-label="Fechar detalhes"><X size={21} /></button></div>
            <div className="drawer-body">
              <div className="drawer-product-photo">{selected.photo_url ? <img src={selected.photo_url} alt={`${selected.material_name} ${selected.brand} ${selected.model_reference}`} /> : <span className="photo-fallback"><HardHat size={38} /><small>Foto ainda não cadastrada</small></span>}</div>
              <div className="drawer-hero"><span className="catalog-icon large"><HardHat size={32} /></span><div><span>Cód. {selected.internal_code}</span><strong>{selected.brand} · {selected.model_reference}</strong><small>{selected.manufacturer_importer}</small></div></div>
              <div className="detail-ca"><span>CERTIFICADO DE APROVAÇÃO</span><strong>{selected.ca_number}</strong><em className={caStatusClass(selected.ca_status)}>{caStatusLabel(selected.ca_status)}</em></div>
              <div className="detail-grid"><div><small>Validade do C.A.</small><strong>{formatDate(selected.ca_valid_until)}</strong></div><div><small>Última verificação</small><strong>{selected.official_checked_at ? formatDate(selected.official_checked_at) : "Não informada"}</strong></div><div><small>Bases vinculadas</small><strong>{(selected.bases ?? []).join(", ") || "Nenhuma"}</strong></div><div><small>Categoria</small><strong>{selected.category_name}</strong></div></div>
              <section className="detail-section"><h3>Proteção oferecida</h3><p>{selected.protection_offered}</p></section>
              {variant?.restrictions && <section className="detail-section warning"><h3><TriangleAlert size={17} /> Restrições e limitações</h3><p>{variant.restrictions}</p></section>}
              {selected.official_url && <a className="official-link" href={selected.official_url} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Abrir consulta oficial do C.A.</a>}
              {canArchiveVariant(role) && (
                <section className="delete-ca-zone">
                  <div className="delete-ca-heading"><span><Trash2 size={19} /></span><div><strong>Excluir este C.A.</strong><small>O item sairá da pesquisa, mas seu histórico será preservado.</small></div></div>
                  {!deleteOpen ? (
                    <button type="button" className="danger-button" onClick={() => setDeleteOpen(true)}><Trash2 size={17} /> Excluir C.A.</button>
                  ) : (
                    <div className="delete-ca-confirm">
                      <label htmlFor="delete-ca-reason"><span>Justificativa obrigatória</span><textarea id="delete-ca-reason" rows={4} maxLength={1000} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} placeholder="Ex.: cadastro duplicado confirmado durante a revisão..." disabled={deleting} /></label>
                      <small>{deleteReason.trim().length}/1000 caracteres · mínimo de 10</small>
                      <div className="delete-ca-actions"><button type="button" className="secondary-button" onClick={() => { setDeleteOpen(false); setDeleteReason(""); }} disabled={deleting}>Cancelar</button><button type="button" className="danger-button" onClick={() => void archiveSelected()} disabled={deleting || !isValidArchiveReason(deleteReason)}>{deleting ? <Loader2 className="spin" size={17} /> : <Trash2 size={17} />} Confirmar exclusão</button></div>
                    </div>
                  )}
                </section>
              )}
              <section className="ratings-block"><div className="panel-heading"><div><span className="eyebrow">AVALIAÇÃO PRÁTICA</span><h3>Experiência dos colaboradores</h3></div></div><div className="rating-summary"><strong>{summary?.comfort_average ? Number(summary.comfort_average).toFixed(1) : "—"}</strong><span><span className="stars">★★★★★</span><small>{summary?.evaluation_count ?? 0} avaliações publicadas</small></span></div><div className="rating-bars"><span>Conforto <b>{summary?.comfort_average ? Number(summary.comfort_average).toFixed(1) : "—"}</b></span><span>Resistência <b>{summary?.resistance_average ? Number(summary.resistance_average).toFixed(1) : "—"}</b></span><span>Duração média <b>{summary?.average_usage_days ? `${Math.round(Number(summary.average_usage_days))} dias` : "—"}</b></span></div></section>
              {comments.slice(0, 3).map((comment) => <blockquote key={comment.id}><p>“{comment.comment || comment.reported_problem || "Avaliação sem comentário."}”</p><small>{comment.activity_performed} · {formatDate(comment.evaluation_date)}</small></blockquote>)}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

const emptyTechnicalForm = {
  code: "",
  name: "",
  category: "",
  description: "",
  technical_note: "",
  recommendation: "",
};

function TechnicalCatalog({
  supabase,
  items,
  userId,
  role,
  showToast,
  refresh,
  onGenerateLabel,
}: {
  supabase: ReturnType<typeof createClient>;
  items: TechnicalItem[];
  userId: string;
  role: Role;
  showToast: (kind: "success" | "error", message: string) => void;
  refresh: () => Promise<void>;
  onGenerateLabel: (item: TechnicalItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("todas");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [selected, setSelected] = useState<TechnicalItem | null>(null);
  const [editing, setEditing] = useState<TechnicalItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyTechnicalForm);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canWrite = role !== "consulta";
  const categoryOptions = [...new Set([
    "Conectores",
    "Cabos",
    "Ferramentas",
    "Peças e componentes",
    "Materiais de manutenção",
    "Outros",
    ...items.map((item) => item.category),
  ])].sort((a, b) => a.localeCompare(b, "pt-BR"));

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const normalized = query.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (item.status !== "ativo") return false;
    const haystack = [item.code, item.name, item.category, item.description, item.technical_note, item.recommendation]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return (!normalized || haystack.includes(normalized)) && (category === "todas" || item.category === category);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedFiltered = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const canEdit = (item: TechnicalItem) =>
    (role === "almoxarife" && item.created_by === userId) || role === "aprovador" || role === "administrador";

  const resetPhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  const openNew = () => {
    setEditing(null);
    setForm(emptyTechnicalForm);
    resetPhoto();
    setFormOpen(true);
  };

  const openEdit = (item: TechnicalItem) => {
    setSelected(null);
    setEditing(item);
    setForm({
      code: item.code,
      name: item.name,
      category: item.category,
      description: item.description,
      technical_note: item.technical_note ?? "",
      recommendation: item.recommendation ?? "",
    });
    resetPhoto();
    setFormOpen(true);
  };

  const choosePhoto = (file: File | null) => {
    if (!file) return;
    const issue = validatePhoto(file);
    if (issue) { showToast("error", issue); return; }
    resetPhoto();
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const uploadPhoto = async (file: File) => {
    const path = `${userId}/${crypto.randomUUID()}.${photoExtension(file)}`;
    const { error } = await supabase.storage.from("technical-catalog").upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;
    return path;
  };

  const saveItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing && !photoFile) {
      showToast("error", "Adicione uma foto para cadastrar o item.");
      return;
    }
    setSaving(true);
    let newPhotoPath: string | null = null;
    try {
      if (photoFile) newPhotoPath = await uploadPhoto(photoFile);
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        category: form.category.trim(),
        description: form.description.trim(),
        technical_note: form.technical_note.trim() || null,
        recommendation: form.recommendation.trim() || null,
        photo_path: newPhotoPath ?? editing?.photo_path,
      };
      const result = editing
        ? await supabase.from("technical_items").update(payload).eq("id", editing.id)
        : await supabase.from("technical_items").insert(payload);
      if (result.error) throw result.error;
      if (editing?.photo_path && newPhotoPath) {
        await supabase.storage.from("technical-catalog").remove([editing.photo_path]);
      }
      showToast("success", editing ? "Item técnico atualizado." : "Item adicionado ao catálogo técnico.");
      setFormOpen(false);
      setEditing(null);
      setForm(emptyTechnicalForm);
      resetPhoto();
      await refresh();
    } catch (error) {
      if (newPhotoPath) await supabase.storage.from("technical-catalog").remove([newPhotoPath]);
      showToast("error", error instanceof Error ? error.message : "Não foi possível salvar o item.");
    }
    setSaving(false);
  };

  return (
    <div className="page-stack">
      <section className="page-heading technical-heading">
        <div><span className="eyebrow">CONHECIMENTO COMPARTILHADO</span><h1>Catálogo Técnico Vivo</h1><p>Registre aplicações práticas, compatibilidades e observações que ajudam o almoxarifado no dia a dia.</p></div>
        {canWrite && <button className="primary-button" onClick={openNew}><Plus size={18} /> Adicionar item</button>}
      </section>
      <section className="search-panel">
        <div className="search-box"><Search size={21} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Ex.: conector 336, cabo 185 ou bitola 2/0" /></div>
        <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} aria-label="Filtrar por categoria"><option value="todas">Todas as categorias</option>{categoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>
      </section>
      <div className="results-caption"><strong>{filtered.length}</strong> {filtered.length === 1 ? "item técnico encontrado" : "itens técnicos encontrados"}</div>
      {filtered.length === 0 ? (
        <section className="panel"><EmptyState icon={BookOpen} title="O catálogo técnico está pronto para crescer" text={items.length ? "Tente outra palavra ou categoria." : "Adicione o primeiro item, foto e recomendação prática da equipe."} /></section>
      ) : (
        <><section className="technical-grid">
          {pagedFiltered.map((item) => (
            <article className="technical-card" key={item.id}>
              <div className="technical-photo">{item.photo_url ? <img src={item.photo_url} alt={item.name} loading="lazy" /> : <span className="photo-fallback"><Wrench size={34} /><small>Foto indisponível</small></span>}<span className="technical-category"><Tag size={13} /> {item.category}</span></div>
              <div className="technical-card-body"><span className="catalog-code">CÓD. {item.code}</span><h2>{item.name}</h2><p>{item.description}</p>{item.recommendation && <div className="recommendation-chip"><Lightbulb size={17} /><span><small>APLICAÇÃO RECOMENDADA</small><strong>{item.recommendation}</strong></span></div>}<div className="technical-card-actions"><button className="card-link" onClick={() => setSelected(item)}>Ver detalhes <ChevronRight size={17} /></button>{canWrite && <button className="technical-label" onClick={() => onGenerateLabel(item)} aria-label={`Gerar etiqueta de ${item.name}`} title="Gerar etiqueta QR"><QrCode size={16} /></button>}{canEdit(item) && <button className="technical-edit" onClick={() => openEdit(item)} aria-label={`Editar ${item.name}`} title="Editar item"><Pencil size={16} /></button>}</div></div>
            </article>
          ))}
        </section><Pagination page={safePage} pageSize={pageSize} total={filtered.length} noun="itens" onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} /></>
      )}

      {selected && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Detalhes do item técnico"><button className="modal-backdrop" onClick={() => setSelected(null)} aria-label="Fechar detalhes" /><aside className="detail-drawer"><div className="drawer-head"><div><span className="eyebrow">ITEM TÉCNICO · CÓD. {selected.code}</span><h2>{selected.name}</h2></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Fechar"><X size={21} /></button></div><div className="drawer-body"><div className="drawer-product-photo">{selected.photo_url ? <img src={selected.photo_url} alt={selected.name} /> : <span className="photo-fallback"><Wrench size={40} /><small>Foto indisponível</small></span>}</div><div className="technical-detail-category"><Tag size={15} /> {selected.category}</div><section className="detail-section"><h3>Descrição do item</h3><p>{selected.description}</p></section>{selected.recommendation && <section className="technical-recommendation"><Lightbulb size={23} /><div><span>APLICAÇÃO RECOMENDADA</span><strong>{selected.recommendation}</strong></div></section>}{selected.technical_note && <section className="detail-section warning"><h3><Wrench size={17} /> Observação técnica</h3><p>{selected.technical_note}</p></section>}<p className="technical-updated">Atualizado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(selected.updated_at))}</p>{canWrite && <button className="secondary-button technical-detail-label" onClick={() => onGenerateLabel(selected)}><QrCode size={17} /> Gerar etiqueta QR</button>}{canEdit(selected) && <button className="secondary-button technical-detail-edit" onClick={() => openEdit(selected)}><Pencil size={17} /> Editar informações</button>}</div></aside></div>}

      {formOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label={editing ? "Editar item técnico" : "Adicionar item técnico"}><button className="modal-backdrop" onClick={() => setFormOpen(false)} aria-label="Fechar formulário" /><form className="technical-form-modal" onSubmit={saveItem}><div className="drawer-head"><div><span className="eyebrow">CATÁLOGO COLABORATIVO</span><h2>{editing ? "Editar item técnico" : "Novo item técnico"}</h2></div><button type="button" className="icon-button" onClick={() => setFormOpen(false)} aria-label="Fechar"><X size={21} /></button></div><div className="technical-form-body"><div className="form-grid two"><label>Código do item<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="Ex.: 336" pattern="[A-Za-z0-9./_-]+" required /></label><label>Nome do item<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Conector para cabo 2/0" required /></label><label className="full-field">Categoria<input list="technical-categories" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Selecione ou digite uma categoria" required /><datalist id="technical-categories">{categoryOptions.map((option) => <option key={option} value={option} />)}</datalist></label><label className="full-field">Descrição<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} placeholder="Descreva características e finalidade do item" required /></label><label className="full-field">Recomendação prática <em>opcional</em><textarea value={form.recommendation} onChange={(event) => setForm({ ...form, recommendation: event.target.value })} rows={3} placeholder="Ex.: O conector 336 para 2/0 também serve para cabo de 185 mm²." /></label><label className="full-field">Observação técnica <em>opcional</em><textarea value={form.technical_note} onChange={(event) => setForm({ ...form, technical_note: event.target.value })} rows={3} placeholder="Cuidados, limitações, ferramenta indicada ou condição de uso" /></label><div className="full-field"><span className="field-title">Foto do item {editing && <em>opcional para manter a atual</em>}</span><label className={`photo-upload-box technical-upload ${photoPreview || editing?.photo_url ? "has-preview" : ""}`}><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => choosePhoto(event.target.files?.[0] ?? null)} />{photoPreview ? <img src={photoPreview} alt="Pré-visualização da nova foto" /> : editing?.photo_url ? <img src={editing.photo_url} alt={`Foto atual de ${editing.name}`} /> : <><Camera size={32} /><strong>Tirar foto ou escolher imagem</strong><small>Obrigatória · JPEG, PNG ou WebP · até 5 MB</small></>}</label></div></div><div className="form-note"><BookOpen size={19} /><span><strong>Conteúdo vivo</strong> As informações ficam disponíveis para todos os usuários ativos e podem ser aprimoradas pela equipe autorizada.</span></div><div className="form-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? <Loader2 className="spin" size={18} /> : editing ? <Pencil size={18} /> : <Plus size={18} />} {editing ? "Salvar alterações" : "Adicionar ao catálogo"}</button></div></div></form></div>}
    </div>
  );
}

const allowedPhotoTypes = ["image/jpeg", "image/png", "image/webp"];

function validatePhoto(file: File) {
  if (!allowedPhotoTypes.includes(file.type)) return "Use uma imagem JPEG, PNG ou WebP.";
  if (file.size > 5 * 1024 * 1024) return "A foto deve ter no máximo 5 MB.";
  return null;
}

function photoExtension(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function Registration({ supabase, categories, materials, bases, variants, userId, role, showToast, refresh, actionLoading, setActionLoading }: { supabase: ReturnType<typeof createClient>; categories: Category[]; materials: Material[]; bases: Base[]; variants: Variant[]; userId: string; role: Role; showToast: (kind: "success" | "error", message: string) => void; refresh: () => Promise<void>; actionLoading: boolean; setActionLoading: (value: boolean) => void }) {
  const [tab, setTab] = useState<"material" | "variante" | "fotos">("variante");
  const [materialForm, setMaterialForm] = useState({ internal_code: "", name: "", category_id: "", description: "", unit_of_measure: "par" });
  const [variantForm, setVariantForm] = useState({ material_id: "", base_id: "", brand: "", model_reference: "", ca_number: "", manufacturer_importer: "", official_description: "", protection_offered: "", restrictions: "", ca_valid_until: "", official_url: "https://caepi.trabalho.gov.br/internet/consultacainternet.aspx" });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoVariantId, setPhotoVariantId] = useState("");
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const selectedPhotoVariant = variants.find((item) => item.id === photoVariantId) ?? null;

  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);

  const choosePhoto = (file: File | null) => {
    if (!file) return;
    const issue = validatePhoto(file);
    if (issue) { showToast("error", issue); return; }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const uploadPhoto = async (file: File) => {
    const path = `${userId}/${crypto.randomUUID()}.${photoExtension(file)}`;
    const { error } = await supabase.storage.from("epi-photos").upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;
    return path;
  };

  const createMaterial = async (event: FormEvent) => {
    event.preventDefault(); setActionLoading(true);
    const { error } = await supabase.from("materials").insert({ ...materialForm, description: materialForm.description || null });
    if (error) showToast("error", error.code === "23505" ? "Este código interno já está cadastrado." : error.message);
    else { showToast("success", "Material cadastrado. Agora você pode adicionar a marca e o C.A."); setMaterialForm({ internal_code: "", name: "", category_id: "", description: "", unit_of_measure: "par" }); await refresh(); setTab("variante"); }
    setActionLoading(false);
  };

  const createVariant = async (event: FormEvent) => {
    event.preventDefault(); setActionLoading(true);
    if (!/^\d+$/.test(variantForm.ca_number)) { showToast("error", "O C.A. deve conter somente números."); setActionLoading(false); return; }
    let photoPath: string | null = null;
    if (photoFile) {
      try { photoPath = await uploadPhoto(photoFile); }
      catch (error) { showToast("error", error instanceof Error ? error.message : "Não foi possível enviar a foto."); setActionLoading(false); return; }
    }
    const { data, error } = await supabase.from("epi_variants").insert({
      material_id: variantForm.material_id, brand: variantForm.brand, model_reference: variantForm.model_reference, ca_number: variantForm.ca_number,
      manufacturer_importer: variantForm.manufacturer_importer, official_description: variantForm.official_description, protection_offered: variantForm.protection_offered,
      restrictions: variantForm.restrictions || null, ca_valid_until: variantForm.ca_valid_until || null, official_url: variantForm.official_url || null,
      official_checked_at: variantForm.ca_valid_until ? new Date().toISOString() : null, photo_url: photoPath, registration_status: "aguardando_validacao",
    }).select("id").single();
    if (error || !data) {
      if (photoPath) await supabase.storage.from("epi-photos").remove([photoPath]);
      showToast("error", error?.code === "23505" ? "Essa marca, modelo e C.A. já estão vinculados ao material." : error?.message || "Não foi possível criar a variante."); setActionLoading(false); return;
    }
    const { error: baseError } = await supabase.from("variant_bases").insert({ variant_id: data.id, base_id: variantForm.base_id, usage_status: "em_uso" });
    if (baseError) showToast("error", `O produto foi salvo, mas a base não foi vinculada: ${baseError.message}`);
    else showToast("success", "Variante enviada para validação do SESMT.");
    setVariantForm({ material_id: "", base_id: "", brand: "", model_reference: "", ca_number: "", manufacturer_importer: "", official_description: "", protection_offered: "", restrictions: "", ca_valid_until: "", official_url: "https://caepi.trabalho.gov.br/internet/consultacainternet.aspx" });
    setPhotoFile(null); setPhotoPreview(null);
    await refresh(); setActionLoading(false);
  };

  const replacePhoto = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPhotoVariant || !replacementFile) { showToast("error", "Selecione o equipamento e a nova foto."); return; }
    const issue = validatePhoto(replacementFile);
    if (issue) { showToast("error", issue); return; }
    setActionLoading(true);
    let newPath: string | null = null;
    try {
      newPath = await uploadPhoto(replacementFile);
      const { error } = await supabase.from("epi_variants").update({ photo_url: newPath }).eq("id", selectedPhotoVariant.id);
      if (error) throw error;
      if (selectedPhotoVariant.photo_url) await supabase.storage.from("epi-photos").remove([selectedPhotoVariant.photo_url]);
      showToast("success", "Foto do equipamento atualizada.");
      setReplacementFile(null); setPhotoVariantId("");
      await refresh();
    } catch (error) {
      if (newPath) await supabase.storage.from("epi-photos").remove([newPath]);
      showToast("error", error instanceof Error ? error.message : "Não foi possível atualizar a foto.");
    }
    setActionLoading(false);
  };

  return (
    <div className="page-stack narrow-page">
      <section className="page-heading"><div><span className="eyebrow">CADASTRO COLABORATIVO</span><h1>Adicionar equipamento</h1><p>Cadastre o código interno uma vez e inclua quantas marcas, modelos e bases forem necessárias.</p></div></section>
      <div className="step-tabs"><button className={tab === "variante" ? "active" : ""} onClick={() => setTab("variante")}><span>1</span> Marca, modelo e C.A.</button><button className={tab === "material" ? "active" : ""} onClick={() => setTab("material")}><span>+</span> Novo código interno</button>{role !== "almoxarife" && <button className={tab === "fotos" ? "active" : ""} onClick={() => setTab("fotos")}><Camera size={17} /> Gerenciar fotos</button>}</div>
      {tab === "material" ? (
        <form className="form-panel" onSubmit={createMaterial}><div className="form-heading"><span className="form-icon blue"><Package size={22} /></span><div><h2>Cadastrar material</h2><p>Use uma descrição genérica, sem incluir marca ou modelo.</p></div></div><div className="form-grid two"><label>Código interno<input value={materialForm.internal_code} onChange={(e) => setMaterialForm({ ...materialForm, internal_code: e.target.value })} placeholder="Ex.: 452656" required /></label><label>Nome do material<input value={materialForm.name} onChange={(e) => setMaterialForm({ ...materialForm, name: e.target.value })} placeholder="Ex.: Bota de segurança" required /></label><label>Categoria<select value={materialForm.category_id} onChange={(e) => setMaterialForm({ ...materialForm, category_id: e.target.value })} required><option value="">Selecione</option>{categories.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Unidade<select value={materialForm.unit_of_measure} onChange={(e) => setMaterialForm({ ...materialForm, unit_of_measure: e.target.value })}><option value="unidade">Unidade</option><option value="par">Par</option><option value="caixa">Caixa</option><option value="kit">Kit</option></select></label><label className="full-field">Descrição geral<textarea value={materialForm.description} onChange={(e) => setMaterialForm({ ...materialForm, description: e.target.value })} placeholder="Características gerais do equipamento" rows={3} /></label></div><div className="form-actions"><button className="primary-button" disabled={actionLoading}>{actionLoading ? <Loader2 className="spin" size={18} /> : <Plus size={18} />} Salvar material</button></div></form>
      ) : tab === "fotos" ? (
        <form className="form-panel" onSubmit={replacePhoto}>
          <div className="form-heading"><span className="form-icon green"><ImagePlus size={22} /></span><div><h2>Atualizar foto do equipamento</h2><p>Substitua a imagem de uma marca ou modelo já cadastrado.</p></div></div>
          <div className="form-grid">
            <label>Equipamento<select value={photoVariantId} onChange={(event) => setPhotoVariantId(event.target.value)} required><option value="">Selecione</option>{variants.map((item) => { const material = materials.find((entry) => entry.id === item.material_id); return <option key={item.id} value={item.id}>{material?.internal_code} — {material?.name} · {item.brand} {item.model_reference}</option>; })}</select></label>
            <div className="photo-manager-grid">
              <div><span className="field-title">Foto atual</span><StoredPhoto supabase={supabase} path={selectedPhotoVariant?.photo_url ?? null} alt="Foto atual do equipamento" className="photo-manager-preview" /></div>
              <label className="photo-upload-box"><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => { const file = event.target.files?.[0] ?? null; if (file) { const issue = validatePhoto(file); if (issue) showToast("error", issue); else setReplacementFile(file); } }} /><UploadCloud size={30} /><strong>{replacementFile ? replacementFile.name : "Escolher nova foto"}</strong><small>JPEG, PNG ou WebP · até 5 MB</small></label>
            </div>
          </div>
          <div className="form-actions"><button className="primary-button" disabled={actionLoading || !photoVariantId || !replacementFile}>{actionLoading ? <Loader2 className="spin" size={18} /> : <ImagePlus size={18} />} Atualizar foto</button></div>
        </form>
      ) : (
        <form className="form-panel" onSubmit={createVariant}><div className="form-heading"><span className="form-icon amber"><HardHat size={22} /></span><div><h2>Nova marca e C.A.</h2><p>A variante ficará aguardando validação antes de aparecer no catálogo.</p></div></div><div className="form-grid two"><label className="full-field">Material / código interno<select value={variantForm.material_id} onChange={(e) => setVariantForm({ ...variantForm, material_id: e.target.value })} required><option value="">Selecione um material</option>{materials.filter((item) => item.status === "ativo").map((item) => <option key={item.id} value={item.id}>{item.internal_code} — {item.name}</option>)}</select><small>Não encontrou o código? Use a aba “Novo código interno”.</small></label><label>Marca<input value={variantForm.brand} onChange={(e) => setVariantForm({ ...variantForm, brand: e.target.value })} placeholder="Marca comercial" required /></label><label>Modelo ou referência<input value={variantForm.model_reference} onChange={(e) => setVariantForm({ ...variantForm, model_reference: e.target.value })} placeholder="Referência da embalagem" required /></label><label>Número do C.A.<input inputMode="numeric" value={variantForm.ca_number} onChange={(e) => setVariantForm({ ...variantForm, ca_number: e.target.value.replace(/\D/g, "") })} placeholder="Somente números" required /></label><label>Base onde é utilizado<select value={variantForm.base_id} onChange={(e) => setVariantForm({ ...variantForm, base_id: e.target.value })} required><option value="">Selecione</option>{bases.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="full-field">Fabricante ou importador<input value={variantForm.manufacturer_importer} onChange={(e) => setVariantForm({ ...variantForm, manufacturer_importer: e.target.value })} required /></label><label className="full-field">Descrição oficial do equipamento<textarea value={variantForm.official_description} onChange={(e) => setVariantForm({ ...variantForm, official_description: e.target.value })} rows={3} required /></label><label className="full-field">Proteção oferecida<textarea value={variantForm.protection_offered} onChange={(e) => setVariantForm({ ...variantForm, protection_offered: e.target.value })} rows={3} required /></label><label>Validade do C.A. <em>opcional no envio</em><input type="date" value={variantForm.ca_valid_until} onChange={(e) => setVariantForm({ ...variantForm, ca_valid_until: e.target.value })} /></label><label>Link da consulta oficial<input type="url" value={variantForm.official_url} onChange={(e) => setVariantForm({ ...variantForm, official_url: e.target.value })} /></label><div className="full-field"><span className="field-title">Foto do produto <em>opcional</em></span><label className={`photo-upload-box ${photoPreview ? "has-preview" : ""}`}><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => choosePhoto(event.target.files?.[0] ?? null)} />{photoPreview ? <img src={photoPreview} alt="Pré-visualização da foto do produto" /> : <><Camera size={32} /><strong>Tirar foto ou escolher imagem</strong><small>JPEG, PNG ou WebP · até 5 MB</small></>}</label></div><label className="full-field">Restrições e limitações<textarea value={variantForm.restrictions} onChange={(e) => setVariantForm({ ...variantForm, restrictions: e.target.value })} rows={2} /></label></div><div className="form-note"><ShieldCheck size={19} /><span><strong>Validação obrigatória</strong> O cadastro e a foto serão revisados por um aprovador antes da publicação.</span></div><div className="form-actions"><button className="primary-button" disabled={actionLoading || materials.length === 0}>{actionLoading ? <Loader2 className="spin" size={18} /> : <FileCheck2 size={18} />} Enviar para validação</button></div></form>
      )}
    </div>
  );
}

function Approvals({ supabase, variants, materials, evaluations, bases, userId, showToast, refresh }: { supabase: ReturnType<typeof createClient>; variants: Variant[]; materials: Material[]; evaluations: Evaluation[]; bases: Base[]; userId: string; showToast: (kind: "success" | "error", message: string) => void; refresh: () => Promise<void> }) {
  const pending = variants.filter((item) => item.registration_status === "aguardando_validacao");
  const pendingEvaluations = evaluations.filter((item) => item.moderation_status === "pendente");
  const [tab, setTab] = useState<"ca" | "avaliacoes">("ca");
  const [selected, setSelected] = useState<Variant | null>(null);
  const [validUntil, setValidUntil] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [rejection, setRejection] = useState("");
  const [loading, setLoading] = useState(false);
  const materialName = (id: string) => { const item = materials.find((entry) => entry.id === id); return item ? `${item.internal_code} — ${item.name}` : "Material"; };

  const open = (variant: Variant) => { setSelected(variant); setValidUntil(variant.ca_valid_until ?? ""); setOfficialUrl(variant.official_url ?? "https://caepi.trabalho.gov.br/internet/consultacainternet.aspx"); setRejection(""); };
  const approve = async () => { if (!selected || !validUntil || !officialUrl) { showToast("error", "Informe a validade e o link oficial antes de aprovar."); return; } setLoading(true); const { error } = await supabase.from("epi_variants").update({ registration_status: "aprovado", ca_valid_until: validUntil, official_url: officialUrl, official_checked_at: new Date().toISOString() }).eq("id", selected.id); if (error) showToast("error", error.message); else { showToast("success", "C.A. aprovado e publicado no catálogo."); setSelected(null); await refresh(); } setLoading(false); };
  const reject = async () => { if (!selected || !rejection.trim()) { showToast("error", "Informe o motivo da rejeição."); return; } setLoading(true); const { error } = await supabase.from("epi_variants").update({ registration_status: "rejeitado", rejection_reason: rejection.trim() }).eq("id", selected.id); if (error) showToast("error", error.message); else { showToast("success", "Cadastro devolvido ao autor para correção."); setSelected(null); await refresh(); } setLoading(false); };
  const moderate = async (evaluation: Evaluation, moderation_status: "publicada" | "rejeitada") => { const { error } = await supabase.from("evaluations").update({ moderation_status, moderated_by: userId, moderated_at: new Date().toISOString(), moderation_reason: moderation_status === "rejeitada" ? "Conteúdo não aprovado na moderação." : null }).eq("id", evaluation.id); if (error) showToast("error", error.message); else { showToast("success", moderation_status === "publicada" ? "Avaliação publicada." : "Avaliação rejeitada."); await refresh(); } };

  return (
    <div className="page-stack">
      <section className="page-heading"><div><span className="eyebrow">CONTROLE TÉCNICO</span><h1>Fila de aprovações</h1><p>Confirme os dados oficiais antes de disponibilizar o equipamento para consulta.</p></div></section>
      <div className="content-tabs"><button className={tab === "ca" ? "active" : ""} onClick={() => setTab("ca")}>Cadastros de C.A. <em>{pending.length}</em></button><button className={tab === "avaliacoes" ? "active" : ""} onClick={() => setTab("avaliacoes")}>Avaliações <em>{pendingEvaluations.length}</em></button></div>
      {tab === "ca" ? (pending.length === 0 ? <section className="panel"><EmptyState icon={BadgeCheck} title="Fila de C.A.s em dia" text="Não há cadastros aguardando validação." /></section> : <section className="approval-list">{pending.map((item) => <article className="approval-card" key={item.id}><span className="approval-icon"><HardHat size={23} /></span><div className="approval-main"><span className="catalog-code">{materialName(item.material_id)}</span><h2>{item.brand} · {item.model_reference}</h2><p>{item.manufacturer_importer}</p><div><span>C.A. <strong>{item.ca_number}</strong></span><span>Enviado em <strong>{formatDate(item.created_at)}</strong></span></div></div><button className="secondary-button" onClick={() => open(item)}>Analisar <ChevronRight size={17} /></button></article>)}</section>) : (pendingEvaluations.length === 0 ? <section className="panel"><EmptyState icon={Star} title="Avaliações em dia" text="Não há feedbacks aguardando moderação." /></section> : <section className="approval-list">{pendingEvaluations.map((item) => <article className="approval-card evaluation-approval" key={item.id}><span className="approval-icon green"><Star size={23} /></span><div className="approval-main"><span className="catalog-code">{materialName(variants.find((variant) => variant.id === item.variant_id)?.material_id ?? "")}</span><h2>{item.activity_performed}</h2><p>{item.comment || item.reported_problem || "Sem comentário adicional."}</p><div><span>Conforto <strong>{item.comfort_rating}/5</strong></span><span>Resistência <strong>{item.resistance_rating}/5</strong></span><span><MapPin size={14} /> {bases.find((base) => base.id === item.base_id)?.name}</span></div></div><div className="approval-actions"><button className="icon-approve" onClick={() => void moderate(item, "publicada")} title="Publicar"><Check size={19} /></button><button className="icon-reject" onClick={() => void moderate(item, "rejeitada")} title="Rejeitar"><X size={19} /></button></div></article>)}</section>)}
      {selected && <div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-backdrop" onClick={() => setSelected(null)} aria-label="Fechar" /><div className="approval-modal"><div className="drawer-head"><div><span className="eyebrow">VALIDAÇÃO DO C.A.</span><h2>{selected.brand} · {selected.model_reference}</h2></div><button className="icon-button" onClick={() => setSelected(null)}><X size={20} /></button></div><StoredPhoto supabase={supabase} path={selected.photo_url} alt={`Foto de ${selected.brand} ${selected.model_reference}`} className="approval-photo" /><div className="approval-summary"><div><small>Material</small><strong>{materialName(selected.material_id)}</strong></div><div><small>Número do C.A.</small><strong>{selected.ca_number}</strong></div><div><small>Fabricante</small><strong>{selected.manufacturer_importer}</strong></div></div><section className="detail-section"><h3>Descrição informada</h3><p>{selected.official_description}</p></section><section className="detail-section"><h3>Proteção oferecida</h3><p>{selected.protection_offered}</p></section><div className="form-grid"><label>Validade confirmada<input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} required /></label><label>Consulta oficial<input type="url" value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} required /></label><label>Motivo para rejeição<textarea value={rejection} onChange={(e) => setRejection(e.target.value)} rows={3} placeholder="Preencha apenas se for rejeitar" /></label></div><div className="modal-actions"><button className="danger-button" onClick={() => void reject()} disabled={loading}><X size={18} /> Rejeitar</button><button className="primary-button" onClick={() => void approve()} disabled={loading}>{loading ? <Loader2 className="spin" size={18} /> : <Check size={18} />} Aprovar e publicar</button></div></div></div>}
    </div>
  );
}

function EvaluationForm({ supabase, catalog, variants, variantBases, bases, showToast, refresh }: { supabase: ReturnType<typeof createClient>; catalog: CatalogItem[]; variants: Variant[]; variantBases: VariantBase[]; bases: Base[]; showToast: (kind: "success" | "error", message: string) => void; refresh: () => Promise<void> }) {
  const [form, setForm] = useState({ variant_id: "", base_id: "", activity_performed: "", comfort_rating: 5, resistance_rating: 5, usage_days: "", reported_problem: "", comment: "" });
  const [loading, setLoading] = useState(false);
  const availableBaseIds = variantBases.filter((item) => item.variant_id === form.variant_id).map((item) => item.base_id);
  const submit = async (event: FormEvent) => { event.preventDefault(); setLoading(true); const { error } = await supabase.from("evaluations").insert({ variant_id: form.variant_id, base_id: form.base_id, activity_performed: form.activity_performed, comfort_rating: form.comfort_rating, resistance_rating: form.resistance_rating, usage_days: form.usage_days ? Number(form.usage_days) : null, reported_problem: form.reported_problem || null, comment: form.comment || null, moderation_status: "pendente", evaluation_date: new Date().toISOString().slice(0, 10) }); if (error) showToast("error", error.message); else { showToast("success", "Avaliação enviada para moderação."); setForm({ variant_id: "", base_id: "", activity_performed: "", comfort_rating: 5, resistance_rating: 5, usage_days: "", reported_problem: "", comment: "" }); await refresh(); } setLoading(false); };
  const rating = (field: "comfort_rating" | "resistance_rating", label: string) => <div className="rating-input"><span>{label}</span><div>{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={form[field] >= value ? "selected" : ""} onClick={() => setForm({ ...form, [field]: value })} aria-label={`${label}: ${value} de 5`}><Star size={25} fill={form[field] >= value ? "currentColor" : "none"} /></button>)}</div><small>{form[field]}/5</small></div>;
  return <div className="page-stack narrow-page"><section className="page-heading"><div><span className="eyebrow">EXPERIÊNCIA DE USO</span><h1>Avaliar um EPI</h1><p>Seu feedback ajuda a comparar marcas e melhorar futuras aquisições.</p></div></section><form className="form-panel evaluation-form" onSubmit={submit}><div className="form-heading"><span className="form-icon green"><Star size={22} /></span><div><h2>Nova avaliação</h2><p>A avaliação prática não substitui a validação técnica do equipamento.</p></div></div><div className="form-grid two"><label className="full-field">Equipamento aprovado<select value={form.variant_id} onChange={(e) => setForm({ ...form, variant_id: e.target.value, base_id: "" })} required><option value="">Selecione</option>{catalog.map((item) => <option key={item.variant_id} value={item.variant_id}>{item.internal_code} — {item.material_name} · {item.brand}</option>)}</select></label><label>Base onde foi utilizado<select value={form.base_id} onChange={(e) => setForm({ ...form, base_id: e.target.value })} required disabled={!form.variant_id}><option value="">Selecione</option>{bases.filter((base) => availableBaseIds.includes(base.id)).map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label><label>Atividade executada<input value={form.activity_performed} onChange={(e) => setForm({ ...form, activity_performed: e.target.value })} placeholder="Ex.: Manutenção naval" required /></label></div><div className="ratings-input-grid">{rating("comfort_rating", "Conforto")}{rating("resistance_rating", "Resistência")}</div><div className="form-grid two"><label>Duração observada em dias<input type="number" min="0" value={form.usage_days} onChange={(e) => setForm({ ...form, usage_days: e.target.value })} placeholder="Ex.: 90" /></label><label>Problema apresentado<input value={form.reported_problem} onChange={(e) => setForm({ ...form, reported_problem: e.target.value })} placeholder="Opcional" /></label><label className="full-field">Comentário<textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} rows={4} placeholder="Conte como foi a experiência com esta marca e modelo" /></label></div><div className="form-actions"><button className="primary-button" disabled={loading || variants.length === 0}>{loading ? <Loader2 className="spin" size={18} /> : <Star size={18} />} Enviar avaliação</button></div></form></div>;
}

function UserManagement({ supabase, profiles, bases, userBases, currentUserId, showToast, refresh }: { supabase: ReturnType<typeof createClient>; profiles: Profile[]; bases: Base[]; userBases: UserBase[]; currentUserId: string; showToast: (kind: "success" | "error", message: string) => void; refresh: () => Promise<void> }) {
  const [teams, setTeams] = useState<Array<{ id: string; base_id: string; code: string; name: string; is_active: boolean }>>([]);
  const [teamMembers, setTeamMembers] = useState<Array<{ team_id: string; user_id: string; is_active: boolean }>>([]);
  const [teamForm, setTeamForm] = useState({ base_id: "", code: "", name: "" });
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [editingTeam, setEditingTeam] = useState<{ id: string; base_id: string; code: string; name: string } | null>(null);
  const [teamEditForm, setTeamEditForm] = useState({ code: "", name: "", member_ids: [] as string[], reason: "" });
  const [savingTeam, setSavingTeam] = useState(false);
  const activeBases = bases.filter((base) => base.is_active);
  const basesForUser = (userId: string) => userBases.filter((link) => link.user_id === userId);
  const activeProfiles = profiles.filter((item) => item.account_status === "ativo");
  const globalProfiles = activeProfiles.filter((item) => roleHasGlobalBaseAccess(item.role));
  const usersWithoutBase = activeProfiles.filter((item) => roleRequiresAssignedBase(item.role) && basesForUser(item.id).length === 0);
  const basesWithoutKeeper = activeBases.filter((base) => !activeProfiles.some((item) => item.role === "almoxarife" && basesForUser(item.id).some((link) => link.base_id === base.id)));

  const loadTeams = useCallback(async () => {
    const [teamsResult, membersResult] = await Promise.all([
      supabase.from("teams").select("id,base_id,code,name,is_active").order("code"),
      supabase.from("team_members").select("team_id,user_id,is_active").eq("is_active", true),
    ]);
    if (!teamsResult.error) setTeams((teamsResult.data ?? []) as typeof teams);
    if (!membersResult.error) setTeamMembers((membersResult.data ?? []) as typeof teamMembers);
  }, [supabase]);

  useEffect(() => { void loadTeams(); }, [loadTeams]);

  const teamForUser = (userId: string) => {
    const membership = teamMembers.find((item) => item.user_id === userId && item.is_active);
    return teams.find((team) => team.id === membership?.team_id);
  };

  const updateUser = async (id: string, changes: Partial<Pick<Profile, "role" | "account_status">>) => {
    const current = profiles.find((item) => item.id === id);
    if (!current) return;
    const nextRole = changes.role ?? current.role;
    const nextStatus = changes.account_status ?? current.account_status;
    if (nextStatus === "ativo" && roleRequiresAssignedBase(nextRole) && basesForUser(id).length === 0) {
      showToast("error", "Selecione pelo menos uma UTD antes de ativar este usuário.");
      return;
    }
    const { error } = await supabase.from("profiles").update(changes).eq("id", id);
    if (error) showToast("error", error.message);
    else { showToast("success", "Permissões atualizadas."); await refresh(); }
  };

  const toggleBase = async (userId: string, baseId: string, enabled: boolean) => {
    const target = profiles.find((item) => item.id === userId);
    if (!enabled && target?.account_status === "ativo" && roleRequiresAssignedBase(target.role) && basesForUser(userId).length <= 1) {
      showToast("error", "Um usuário ativo precisa permanecer vinculado a pelo menos uma UTD.");
      return;
    }
    const result = enabled
      ? await supabase.from("user_bases").insert({ user_id: userId, base_id: baseId })
      : await supabase.from("user_bases").delete().eq("user_id", userId).eq("base_id", baseId);
    if (result.error) showToast("error", result.error.message);
    else { showToast("success", enabled ? "UTD liberada para o usuário." : "Acesso à UTD removido."); await refresh(); }
  };

  const approveUser = async (item: Profile) => {
    const baseId = basesForUser(item.id)[0]?.base_id ?? item.requested_base_id;
    if (roleRequiresAssignedBase(item.role) && !baseId) { showToast("error", "A solicitação não possui UTD. Selecione uma UTD antes de liberar."); return; }
    const requestedTeam = item.role === "eletricista" ? teams.find((team) => team.base_id === baseId && team.code.trim().toLocaleLowerCase("pt-BR") === item.requested_team_code?.trim().toLocaleLowerCase("pt-BR")) : null;
    const { error } = await supabase.rpc("approve_access_request", { p_user_id: item.id, p_role: item.role, p_base_id: baseId, p_team_id: requestedTeam?.id ?? null });
    if (error) showToast("error", error.message); else { showToast("success", item.role === "eletricista" ? "Eletricista liberado e vinculado à equipe." : "Usuário liberado com o perfil solicitado."); await Promise.all([refresh(), loadTeams()]); }
  };

  const rejectUser = async (item: Profile) => {
    const reason = window.prompt("Informe a justificativa da recusa (mínimo de 5 caracteres):");
    if (!reason || reason.trim().length < 5) { if (reason !== null) showToast("error", "A justificativa precisa ter pelo menos 5 caracteres."); return; }
    const { error } = await supabase.from("profiles").update({ account_status: "bloqueado", access_review_reason: reason.trim() }).eq("id", item.id);
    if (error) showToast("error", error.message); else { showToast("success", "Solicitação recusada com justificativa."); await refresh(); }
  };

  const createTeam = async (event: FormEvent) => {
    event.preventDefault(); setCreatingTeam(true);
    const { error } = await supabase.rpc("create_team", { p_base_id: teamForm.base_id, p_code: teamForm.code, p_name: teamForm.name });
    if (error) showToast("error", error.code === "23505" ? "Já existe uma equipe com este código na UTD." : error.message); else { showToast("success", "Equipe criada e disponível para novos vínculos."); setTeamForm({ base_id: "", code: "", name: "" }); await loadTeams(); }
    setCreatingTeam(false);
  };

  const openTeamEditor = (team: { id: string; base_id: string; code: string; name: string }) => {
    setEditingTeam(team);
    setTeamEditForm({
      code: team.code,
      name: team.name,
      member_ids: teamMembers.filter((member) => member.team_id === team.id && member.is_active).map((member) => member.user_id),
      reason: "",
    });
  };

  const saveTeam = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingTeam || teamEditForm.reason.trim().length < 5) {
      showToast("error", "Informe uma justificativa com pelo menos 5 caracteres.");
      return;
    }
    setSavingTeam(true);
    const { error } = await supabase.rpc("admin_update_team", {
      p_team_id: editingTeam.id,
      p_code: teamEditForm.code,
      p_name: teamEditForm.name,
      p_member_ids: teamEditForm.member_ids,
      p_reason: teamEditForm.reason,
    });
    setSavingTeam(false);
    if (error) showToast("error", error.message);
    else {
      showToast("success", "Equipe e integrantes atualizados com histórico de auditoria.");
      setEditingTeam(null);
      await Promise.all([loadTeams(), refresh()]);
    }
  };

  return <div className="page-stack">
    <section className="page-heading"><div><span className="eyebrow">CONTROLE DE ACESSO</span><h1>Usuários e permissões</h1><p>Defina o perfil e as UTDs permitidas. O mesmo isolamento agora protege consultas e movimentações do estoque.</p></div><div className="heading-stat"><strong>{profiles.filter((item) => item.account_status === "pendente").length}</strong><span>aguardando liberação</span></div></section>

    <section className="access-directory panel">
      <div className="panel-heading"><div><span className="eyebrow">ACESSOS POR UTD</span><h2>Quem está atribuído a cada base</h2></div><span className="access-total"><Users size={17} /> {activeProfiles.length} ativos</span></div>
      {(basesWithoutKeeper.length > 0 || usersWithoutBase.length > 0 || globalProfiles.length > 0) && <div className="access-alerts">
        {basesWithoutKeeper.length > 0 && <div className="access-alert warning"><TriangleAlert size={18} /><span><strong>{basesWithoutKeeper.length} UTD{basesWithoutKeeper.length > 1 ? "s" : ""} sem almoxarife</strong><small>{basesWithoutKeeper.map((base) => base.name.replace("UTD ", "")).join(", ")}</small></span></div>}
        {usersWithoutBase.length > 0 && <div className="access-alert danger"><TriangleAlert size={18} /><span><strong>{usersWithoutBase.length} usuário{usersWithoutBase.length > 1 ? "s" : ""} sem UTD</strong><small>Corrija antes de liberar o acesso operacional.</small></span></div>}
        {globalProfiles.length > 0 && <div className="access-alert info"><ShieldCheck size={18} /><span><strong>{globalProfiles.length} {globalProfiles.length === 1 ? "acesso global" : "acessos globais"}</strong><small>Administrador e SESMT visualizam todas as UTDs.</small></span></div>}
      </div>}
      <div className="access-base-grid">{activeBases.map((base) => {
        const assignedProfiles = activeProfiles.filter((item) => roleHasGlobalBaseAccess(item.role) || basesForUser(item.id).some((link) => link.base_id === base.id));
        const localProfiles = assignedProfiles.filter((item) => !roleHasGlobalBaseAccess(item.role));
        return <article key={base.id} className={!localProfiles.some((item) => item.role === "almoxarife") ? "base-access-card needs-keeper" : "base-access-card"}><header><span><Building2 size={18} /></span><div><strong>{base.name}</strong><small>{base.city || base.abbreviation || "UTD operacional"}</small></div><b>{assignedProfiles.length}</b></header><div>{assignedProfiles.map((item) => <span className="assigned-person" key={item.id}><i className="avatar">{initials(item.display_name || item.email || "U")}</i><span><strong>{item.display_name || item.email}</strong><small>{roleLabels[item.role]}{roleHasGlobalBaseAccess(item.role) ? " · global" : ""}</small></span></span>)}</div>{assignedProfiles.length === 0 && <p>Nenhum usuário ativo atribuído.</p>}</article>;
      })}</div>
    </section>

    <section className="panel team-admin-panel"><div className="panel-heading"><div><span className="eyebrow">EQUIPES DE CAMPO</span><h2>Equipes cadastradas por UTD</h2></div><span className="access-total"><Users size={17} /> {teams.filter((team) => team.is_active).length} equipes</span></div><div className="team-admin-grid"><div className="team-directory">{teams.filter((team) => team.is_active).map((team) => { const members = teamMembers.filter((member) => member.team_id === team.id && member.is_active).map((member) => profiles.find((profile) => profile.id === member.user_id)?.display_name || "Eletricista"); return <article key={team.id}><span><Users size={18} /></span><div><strong>{team.code}</strong><small>{team.name} · {bases.find((base) => base.id === team.base_id)?.name}</small><small>{members.length ? members.join(" + ") : "Sem integrantes"}</small></div><button type="button" className="team-edit-button" onClick={() => openTeamEditor(team)} aria-label={`Editar ${team.code}`}><Pencil size={16} /></button></article>; })}{teams.length === 0 && <p>Nenhuma equipe cadastrada.</p>}</div><form className="team-create-form" onSubmit={createTeam}><h3>Nova equipe</h3><label>UTD<select value={teamForm.base_id} onChange={(e) => setTeamForm({ ...teamForm, base_id: e.target.value })} required><option value="">Selecione</option>{activeBases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label><label>Número/código<input value={teamForm.code} onChange={(e) => setTeamForm({ ...teamForm, code: e.target.value })} placeholder="Ex.: Equipe 27" required /></label><label>Nome de exibição<input value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} placeholder="Ex.: Dupla de manutenção 27" required /></label><button className="primary-button" disabled={creatingTeam}>{creatingTeam ? <Loader2 className="spin" size={17} /> : <Plus size={17} />} Criar equipe</button></form></div></section>

    {editingTeam && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Editar equipe"><form className="team-form-modal" onSubmit={saveTeam}><header><div><span className="eyebrow">FORMAÇÃO DA DUPLA</span><h2>Editar {editingTeam.code}</h2></div><button type="button" className="close-button" onClick={() => setEditingTeam(null)}><X /></button></header><p>Escolha até dois eletricistas ativos da mesma UTD. Ao mover um integrante, o vínculo anterior é encerrado sem alterar o histórico.</p><div className="form-grid two"><label>Código<input value={teamEditForm.code} onChange={(e) => setTeamEditForm({ ...teamEditForm, code: e.target.value })} required /></label><label>Nome<input value={teamEditForm.name} onChange={(e) => setTeamEditForm({ ...teamEditForm, name: e.target.value })} required /></label></div><div className="team-member-picker"><strong>Eletricistas da {bases.find((base) => base.id === editingTeam.base_id)?.name}</strong>{profiles.filter((item) => item.role === "eletricista" && item.account_status === "ativo" && basesForUser(item.id).some((link) => link.base_id === editingTeam.base_id)).map((item) => { const checked = teamEditForm.member_ids.includes(item.id); return <label key={item.id}><input type="checkbox" checked={checked} onChange={(e) => setTeamEditForm((current) => ({ ...current, member_ids: e.target.checked ? [...current.member_ids, item.id].slice(0, 2) : current.member_ids.filter((id) => id !== item.id) }))} /><span><strong>{item.display_name || item.email}</strong><small>{teamForUser(item.id)?.code || "Sem equipe"}</small></span></label>; })}</div><label>Justificativa da alteração<textarea rows={3} value={teamEditForm.reason} onChange={(e) => setTeamEditForm({ ...teamEditForm, reason: e.target.value })} placeholder="Ex.: reorganização das duplas para atendimento da UTD" required minLength={5} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setEditingTeam(null)}>Cancelar</button><button className="primary-button" disabled={savingTeam}>{savingTeam ? <Loader2 className="spin" size={17} /> : <Check size={17} />} Salvar equipe</button></div></form></div>}

    <section className="users-table panel"><div className="table-head"><span>Usuário</span><span>Perfil</span><span>UTDs permitidas</span><span>Situação</span><span>Ação rápida</span></div>{profiles.map((item) => {
      const assigned = basesForUser(item.id);
      const globalAccess = roleHasGlobalBaseAccess(item.role);
      const needsBase = roleRequiresAssignedBase(item.role) && assigned.length === 0;
      const team = teamForUser(item.id);
      const requestedBase = bases.find((base) => base.id === item.requested_base_id);
      return <div className={`user-row ${needsBase && item.account_status !== "pendente" ? "user-row-warning" : ""}`} key={item.id}><div className="table-user"><span className="avatar">{initials(item.display_name || item.email || "U")}</span><span><strong>{item.display_name || "Nome não informado"}</strong><small>{item.email}</small>{item.employee_number && <small>Matrícula {item.employee_number}</small>}{item.account_status === "pendente" && <em className="access-request"><UserPlus size={12} /> Solicitou {roleLabels[item.requested_role ?? item.role]} · {requestedBase?.name || "UTD não informada"}{item.requested_team_code ? ` · ${item.requested_team_code}` : ""}</em>}{team && <em className="team-assignment"><Users size={12} /> {team.code} · {team.name}</em>}{needsBase && item.account_status !== "pendente" && <em className="base-missing"><TriangleAlert size={12} /> Sem UTD</em>}</span>{item.id === currentUserId && <em>Você</em>}</div><select value={item.role} onChange={(e) => void updateUser(item.id, { role: e.target.value as Role })} disabled={item.id === currentUserId}><option value="consulta">Consulta</option><option value="eletricista">Eletricista</option><option value="almoxarife">Almoxarife</option><option value="aprovador">Aprovador / SESMT</option><option value="administrador">Administrador</option></select>{globalAccess ? <div className="global-base-access"><ShieldCheck size={16} /><span><strong>Acesso global</strong><small>Todas as UTDs</small></span></div> : <div className="base-access">{activeBases.map((base) => { const checked = assigned.some((link) => link.base_id === base.id); const requested = item.account_status === "pendente" && item.requested_base_id === base.id; return <label key={base.id} className={requested ? "requested-base" : ""}><input type="checkbox" checked={checked} onChange={(event) => void toggleBase(item.id, base.id, event.target.checked)} /><span>{base.name}{requested ? " · solicitada" : ""}</span></label>; })}</div>}<span className={`account-status account-${item.account_status}`}>{statusLabels[item.account_status]}</span><div>{item.account_status === "pendente" ? <span className="pending-user-actions"><button className="mini-primary" onClick={() => void approveUser(item)}><Check size={16} /> Liberar</button><button className="mini-danger" onClick={() => void rejectUser(item)}><X size={16} /> Recusar</button></span> : item.id !== currentUserId ? <select value={item.account_status} onChange={(e) => void updateUser(item.id, { account_status: e.target.value as AccountStatus })}><option value="ativo">Ativo</option><option value="inativo">Inativo</option><option value="bloqueado">Bloqueado</option></select> : <span className="protected-user"><ShieldCheck size={16} /> Protegido</span>}</div></div>;
    })}</section>
  </div>;
}

function EmptyState({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return <div className="empty-state"><span><Icon size={29} /></span><h3>{title}</h3><p>{text}</p></div>;
}

function SectionLoading({ label }: { label: string }) {
  return <div className="section-loading" role="status"><Loader2 className="spin" size={26} /><span>{label}</span></div>;
}
