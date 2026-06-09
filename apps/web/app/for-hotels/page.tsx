import { HotelDemo } from "@/components/HotelDemo";

export const metadata = {
  title: "TrueRate for hotels — your guests, booking direct",
  description: "See exactly what a TrueRate end-user is told about your hotel: book direct, skip the OTA commission, plus the loyalty perks members get.",
};

export default function ForHotelsPage() {
  return (
    <main style={{ padding: "3rem 1.25rem", fontFamily: "system-ui, sans-serif", color: "#1a1a2e" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center", marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "2.2rem", margin: "0 0 0.5rem", lineHeight: 1.15 }}>
          Your guests are about to book <span style={{ color: "#1d3a8a" }}>direct</span>.
        </h1>
        <p style={{ fontSize: "1.1rem", color: "#445", margin: 0 }}>
          When a traveler considers your hotel, TrueRate steers them to book direct with you —
          past the OTA&apos;s 15–25% commission — and surfaces the loyalty perks they already hold.
          Type your hotel and see what they see.
        </p>
      </div>

      <HotelDemo />

      <p style={{ maxWidth: 720, margin: "2.5rem auto 0", textAlign: "center", color: "#889", fontSize: "0.85rem" }}>
        TrueRate never shows prices — only which discounts and perks apply, and where to book direct.
      </p>
    </main>
  );
}
