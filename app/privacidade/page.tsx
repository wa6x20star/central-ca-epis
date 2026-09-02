import PrivacyCenter from "./PrivacyCenter";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Privacidade e LGPD | Central do Almoxarifado",
  description: "Central de privacidade, segurança e solicitações de titulares de dados.",
};

export default function PrivacyPage() {
  return (
    <PrivacyCenter
      supabaseUrl={process.env.SUPABASE_URL ?? ""}
      supabaseKey={process.env.SUPABASE_PUBLISHABLE_KEY ?? ""}
    />
  );
}
