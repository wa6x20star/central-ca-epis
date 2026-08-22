export type OperationalRole = "consulta" | "almoxarife" | "aprovador" | "administrador" | "eletricista";

export const roleHasGlobalBaseAccess = (role: OperationalRole) =>
  role === "aprovador" || role === "administrador";

export const roleRequiresAssignedBase = (role: OperationalRole) =>
  role === "consulta" || role === "almoxarife" || role === "eletricista";

export function canAccessBase(role: OperationalRole, assignedBaseIds: string[], baseId: string) {
  return roleHasGlobalBaseAccess(role) || assignedBaseIds.includes(baseId);
}

export function filterApprovedCatalog<T extends { registration_status: string }>(items: T[]) {
  return items.filter((item) => item.registration_status === "aprovado");
}

export const canArchiveVariant = (role: OperationalRole) => role === "administrador";

export const isValidArchiveReason = (reason: string) => {
  const length = reason.trim().length;
  return length >= 10 && length <= 1000;
};

const commonPasswords = new Set([
  "123456789012",
  "administrador",
  "almoxarifado",
  "neoenergia123",
  "password1234",
  "senha123456",
]);

export type PasswordAssessment = {
  valid: boolean;
  score: number;
  label: "Fraca" | "Razoável" | "Forte";
  rules: { label: string; met: boolean }[];
};

export function assessPassword(password: string): PasswordAssessment {
  const normalized = password.toLocaleLowerCase("pt-BR").replace(/\s/g, "");
  const rules = [
    { label: "12 ou mais caracteres", met: password.length >= 12 },
    { label: "Letra maiúscula e minúscula", met: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { label: "Pelo menos um número", met: /\d/.test(password) },
    { label: "Pelo menos um símbolo", met: /[^A-Za-z0-9\s]/.test(password) },
    { label: "Não é uma senha comum", met: password.length > 0 && !commonPasswords.has(normalized) },
  ];
  const metCount = rules.filter((rule) => rule.met).length;
  const score = password.length === 0 ? 0 : metCount <= 2 ? 1 : metCount <= 4 ? 2 : 3;
  return {
    valid: rules.every((rule) => rule.met),
    score,
    label: score === 3 ? "Forte" : score === 2 ? "Razoável" : "Fraca",
    rules,
  };
}

export function authErrorMessage(message: string) {
  const normalized = message.toLocaleLowerCase("pt-BR");
  if (normalized.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (normalized.includes("email not confirmed")) return "Confirme seu e-mail antes de entrar.";
  if (normalized.includes("user already registered")) return "Já existe uma conta com este e-mail.";
  if (normalized.includes("rate limit") || normalized.includes("too many")) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (normalized.includes("weak password") || normalized.includes("password should")) return "A senha não atende aos requisitos de segurança.";
  return "Não foi possível concluir o acesso. Tente novamente.";
}

type LabelPayloadItem = {
  source_type: "material" | "tecnico";
  source_id: string;
  code: string;
};

export function materialLabelPayload(item: LabelPayloadItem) {
  return JSON.stringify({
    v: 1,
    type: "material",
    source: item.source_type,
    id: item.source_id,
    code: item.code,
  });
}

export function normalizeScannedCode(rawValue: string) {
  const raw = rawValue.trim();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidate = parsed.code ?? parsed.codigo ?? parsed.internal_code ?? parsed.material_code;
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate).trim();
  } catch {
    // O QR também pode conter somente o código ou uma URL.
  }

  try {
    const url = new URL(raw);
    const candidate = url.searchParams.get("code") ?? url.searchParams.get("codigo") ?? url.searchParams.get("material");
    if (candidate) return candidate.trim();
  } catch {
    // Conteúdo simples: o valor lido já é o código.
  }

  return raw;
}

export function requestCode(value: number) {
  return `REQ-${String(value).padStart(5, "0")}`;
}

export type RequestStatus = "aberta" | "separada" | "entregue" | "cancelada";

export function canTransitionRequestStatus(from: RequestStatus, to: RequestStatus, note = "") {
  if (to === "cancelada" && !note.trim()) return false;
  if (from === "aberta") return to === "separada" || to === "cancelada";
  if (from === "separada") return to === "entregue" || to === "cancelada";
  return false;
}
