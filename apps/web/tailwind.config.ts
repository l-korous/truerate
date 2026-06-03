import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0c1b2e", // deep navy — primary surface/text
          soft: "#16263b",
          muted: "#5a6b80",
        },
        paper: "#f7f5ef", // warm off-white page
        card: "#ffffff",
        save: {
          DEFAULT: "#0f8a5f", // savings green — use for backgrounds/icons
          soft: "#e6f4ee",    // light green background
          dark: "#0a6741",    // accessible text on light green (≥4.5:1 vs save-soft)
        },
        points: {
          DEFAULT: "#c98a1a", // amber for points/perks — use for backgrounds/icons
          soft: "#fef3e2",    // light amber background
          dark: "#8b5e06",    // accessible text on light amber (≥4.5:1 vs points-soft)
        },
        line: "#e7e3d8",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      borderRadius: { xl2: "1.25rem" },
    },
  },
  plugins: [],
} satisfies Config;
