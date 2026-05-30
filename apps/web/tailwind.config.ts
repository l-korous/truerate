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
          DEFAULT: "#0f8a5f", // savings green
          soft: "#e6f4ee",
        },
        points: "#c98a1a", // amber for points/perks
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
