import { Leaderboard } from "@/components/Leaderboard";

export const metadata = {
  title: "Leaderboard — TrueRate admin",
  robots: { index: false, follow: false },
};

export default function LeaderboardPage() {
  return (
    <main style={{ padding: "2rem 1.5rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>Provider leaderboard</h1>
      <p style={{ color: "#666", maxWidth: 640 }}>
        Most-used providers by how often their discounts and perks surfaced across the
        MCP and browser-extension channels. Counts only — no prices.
      </p>
      <Leaderboard />
    </main>
  );
}
