import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const notificationRecipient = "wagsil640@gmail.com";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });

const escapeHtml = (value: unknown) =>
  String(value ?? "Não informado")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

type ArchivePayload = {
  notification_id: string;
  archived_at: string;
  actor_email: string | null;
  actor_name: string | null;
  reason: string;
  item: {
    internal_code: string;
    material_name: string;
    category_name: string;
    ca_number: string;
    brand: string;
    model_reference: string;
    manufacturer_importer: string;
    ca_valid_until: string | null;
    bases: string[];
    previous_status: string;
  };
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Sessão de administrador não encontrada." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return json({ error: "Configuração interna do serviço indisponível." }, 500);
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let input: { variant_id?: string; reason?: string };
  try {
    input = await request.json();
  } catch {
    return json({ error: "Dados de exclusão inválidos." }, 400);
  }

  const variantId = input.variant_id?.trim();
  const reason = input.reason?.trim() ?? "";
  if (!variantId || reason.length < 10 || reason.length > 1000) {
    return json({ error: "Informe uma justificativa entre 10 e 1000 caracteres." }, 400);
  }

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Sessão inválida ou expirada." }, 401);

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("role,account_status")
    .eq("id", userData.user.id)
    .single();

  if (profileError || profile?.role !== "administrador" || profile?.account_status !== "ativo") {
    return json({ error: "Somente administradores ativos podem excluir um C.A." }, 403);
  }

  const { data: archiveResult, error: archiveError } = await adminClient.rpc("archive_epi_variant", {
    p_variant_id: variantId,
    p_reason: reason,
    p_actor_id: userData.user.id,
  });

  if (archiveError || !archiveResult) {
    return json({ error: archiveError?.message ?? "Não foi possível excluir o C.A." }, 403);
  }

  const archive = archiveResult as ArchivePayload;
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    await adminClient
      .from("variant_deletion_notifications")
      .update({ email_status: "falhou", email_error: "RESEND_API_KEY não configurada" })
      .eq("id", archive.notification_id);
    return json({ ok: false, archived: true, email_sent: false, error: "C.A. excluído, mas o serviço de e-mail não está configurado." });
  }

  const item = archive.item;
  const bases = Array.isArray(item.bases) && item.bases.length ? item.bases.join(", ") : "Nenhuma UTD vinculada";
  const deletionDate = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: "America/Recife",
  }).format(new Date(archive.archived_at));

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Central de C.A. <onboarding@resend.dev>",
      to: [notificationRecipient],
      subject: `Exclusão de C.A. ${item.ca_number} — código ${item.internal_code}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#09243b">
          <div style="background:#09243b;padding:24px;border-radius:14px 14px 0 0;color:white">
            <div style="font-size:12px;letter-spacing:.12em;color:#45d6bd">CENTRAL DO ALMOXARIFADO</div>
            <h1 style="font-size:24px;margin:8px 0 0">C.A. excluído do catálogo</h1>
          </div>
          <div style="border:1px solid #dbe4ea;border-top:0;padding:24px;border-radius:0 0 14px 14px">
            <p>Um administrador excluiu um Certificado de Aprovação da pesquisa interna. O histórico foi preservado para auditoria.</p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0">
              <tr><td style="padding:9px;border-bottom:1px solid #e7edf1;color:#557080">Código</td><td style="padding:9px;border-bottom:1px solid #e7edf1"><strong>${escapeHtml(item.internal_code)}</strong></td></tr>
              <tr><td style="padding:9px;border-bottom:1px solid #e7edf1;color:#557080">Material</td><td style="padding:9px;border-bottom:1px solid #e7edf1">${escapeHtml(item.material_name)}</td></tr>
              <tr><td style="padding:9px;border-bottom:1px solid #e7edf1;color:#557080">Categoria</td><td style="padding:9px;border-bottom:1px solid #e7edf1">${escapeHtml(item.category_name)}</td></tr>
              <tr><td style="padding:9px;border-bottom:1px solid #e7edf1;color:#557080">C.A.</td><td style="padding:9px;border-bottom:1px solid #e7edf1"><strong>${escapeHtml(item.ca_number)}</strong></td></tr>
              <tr><td style="padding:9px;border-bottom:1px solid #e7edf1;color:#557080">Marca / modelo</td><td style="padding:9px;border-bottom:1px solid #e7edf1">${escapeHtml(item.brand)} / ${escapeHtml(item.model_reference)}</td></tr>
              <tr><td style="padding:9px;border-bottom:1px solid #e7edf1;color:#557080">Fabricante</td><td style="padding:9px;border-bottom:1px solid #e7edf1">${escapeHtml(item.manufacturer_importer)}</td></tr>
              <tr><td style="padding:9px;border-bottom:1px solid #e7edf1;color:#557080">UTDs</td><td style="padding:9px;border-bottom:1px solid #e7edf1">${escapeHtml(bases)}</td></tr>
              <tr><td style="padding:9px;border-bottom:1px solid #e7edf1;color:#557080">Administrador</td><td style="padding:9px;border-bottom:1px solid #e7edf1">${escapeHtml(archive.actor_name)} (${escapeHtml(archive.actor_email)})</td></tr>
              <tr><td style="padding:9px;border-bottom:1px solid #e7edf1;color:#557080">Data</td><td style="padding:9px;border-bottom:1px solid #e7edf1">${escapeHtml(deletionDate)}</td></tr>
            </table>
            <div style="background:#fff4ed;border-left:4px solid #f27f3d;padding:14px 16px;border-radius:8px">
              <strong>Justificativa obrigatória</strong>
              <p style="margin:7px 0 0">${escapeHtml(archive.reason)}</p>
            </div>
          </div>
        </div>
      `,
    }),
  });

  const providerData = await emailResponse.json().catch(() => ({})) as { id?: string; message?: string };
  if (!emailResponse.ok) {
    const providerError = (providerData.message ?? `Resend HTTP ${emailResponse.status}`).slice(0, 1000);
    await adminClient
      .from("variant_deletion_notifications")
      .update({ email_status: "falhou", email_error: providerError })
      .eq("id", archive.notification_id);
    return json({ ok: false, archived: true, email_sent: false, error: "C.A. excluído, mas o e-mail não pôde ser enviado." });
  }

  await adminClient
    .from("variant_deletion_notifications")
    .update({
      email_status: "enviado",
      provider_message_id: providerData.id ?? null,
      email_error: null,
      sent_at: new Date().toISOString(),
    })
    .eq("id", archive.notification_id);

  return json({
    ok: true,
    archived: true,
    email_sent: true,
    recipient: notificationRecipient,
  });
});
