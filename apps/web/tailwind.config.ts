import type { Config } from "tailwindcss";

// CustomRates — "sunset over the sea" identity.
//  warm sun (coral) → golden horizon → pink dusk → teal sea.
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Text + deep surfaces: the sea at dusk (deep teal-navy).
        ink: {
          DEFAULT: "#122a3e",
          soft: "#1e3d54",
          muted: "#5c7286",
        },
        paper: "#fff7ef", // warm, sunlit cream
        card: "#ffffff",
        // The sun — primary brand + CTAs (coral-orange).
        sun: {
          DEFAULT: "#ff6f4d",
          soft: "#ffe3d6",
          deep: "#ed5733",
        },
        // Golden horizon glow — secondary warm accent.
        gold: {
          DEFAULT: "#ffbf57",
          soft: "#fff0d4",
          deep: "#d8961f",
        },
        // Pink dusk — soft tertiary accent.
        dusk: {
          DEFAULT: "#f08aae",
          soft: "#fbe3ec",
        },
        // The sea — cool brand + links/info (teal).
        sea: {
          DEFAULT: "#11808f",
          soft: "#dceff1",
          deep: "#0b3a47",
        },
        // Retained for existing analytics surfaces (leaderboard, value explainer).
        save: { DEFAULT: "#0f8a5f", soft: "#e6f4ee", dark: "#0a6741" },
        points: { DEFAULT: "#c98a1a", soft: "#fef3e2", dark: "#8b5e06" },
        line: "#f0e2d4",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      borderRadius: { xl2: "1.25rem", xl3: "1.75rem" },
      backgroundImage: {
        // Warm sunset sweep — CTAs, accents, the logo.
        "grad-sun": "linear-gradient(120deg, #ff6f4d 0%, #ffbf57 100%)",
        // Full sunset-over-sea — hero panels.
        "grad-sunset-sea":
          "linear-gradient(165deg, #ff8a5b 0%, #f08aae 38%, #7a7fb8 62%, #11808f 100%)",
      },
      boxShadow: {
        sun: "0 12px 30px -12px rgba(255, 111, 77, 0.45)",
        soft: "0 18px 50px -24px rgba(18, 42, 62, 0.35)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: { "fade-up": "fade-up 0.6s ease-out both" },
    },
  },
  plugins: [],
} satisfies Config;
