import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#10141a",
          sidebar: "#0a0d12",
          surface: "#161c23",
          surfaceAlt: "#1c232b",
          border: "#2c3541",
        },
        ink: {
          primary: "#f2f2f2",
          secondary: "#dbe6ea",
          muted: "#8fa3ad",
          faint: "#4a5761",
        },
        accent: {
          DEFAULT: "#5fd4de",
          icon: "#7ee0e8",
          on: "#0a1417",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
};

export default config;
