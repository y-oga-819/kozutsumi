import type { Config } from "tailwindcss";

import {
  ACCENT_COLORS,
  BG_COLORS,
  FG_COLORS,
  PROJECT_COLORS,
} from "./src/shared/theme/tokens";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: BG_COLORS,
        fg: FG_COLORS,
        accent: ACCENT_COLORS,
        project: PROJECT_COLORS,
      },
      keyframes: {
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "panel-slide-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
      },
      animation: {
        "slide-up": "slide-up 0.4s ease",
        pulse: "pulse 2s ease infinite",
        "panel-slide-up": "panel-slide-up 0.25s ease",
      },
      fontFamily: {
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "monospace",
        ],
        jp: ["var(--font-jp)", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
