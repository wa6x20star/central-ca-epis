import EpiApp from "./EpiApp";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <EpiApp
      supabaseUrl={process.env.SUPABASE_URL ?? ""}
      supabaseKey={process.env.SUPABASE_PUBLISHABLE_KEY ?? ""}
    />
  );
}
