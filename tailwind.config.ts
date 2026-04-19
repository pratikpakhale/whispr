import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      colors: {
        whispr: {
          bg: "#0a0a0f",
          surface: "#12121a",
          border: "#1e1e2e",
          accent: "#6c63ff",
          "accent-dim": "#4a4380",
          text: "#e4e4ef",
          muted: "#6b6b80",
          green: "#4ade80",
          red: "#f87171",
          amber: "#fbbf24",
        },
      },
    },
  },
  plugins: [],
};
export default config;
