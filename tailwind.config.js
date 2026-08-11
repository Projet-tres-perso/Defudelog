/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#e0fcff",
          100: "#b3f8ff",
          200: "#80f3ff",
          300: "#4dedff",
          400: "#26e8ff",
          500: "#00f0ff",
          600: "#00c0cc",
          700: "#009099",
          800: "#006066",
          900: "#003033",
          950: "#00181a",
        },
        surface: {
          50: "#fafafa",
          100: "#f4f4f5",
          200: "#e4e4e7",
          300: "#d4d4d8",
          400: "#a1a1aa",
          500: "#71717a",
          600: "#52525b",
          700: "#3f3f46",
          800: "#1c1c1e",
          900: "#0e0e10",
          950: "#050505",
        },
        alert: {
          high: "#ef4444",
          moderate: "#f59e0b",
          low: "#3b82f6",
          benign: "#22c55e",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
    },
  },
  plugins: [],
};
