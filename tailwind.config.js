/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "var(--surface-0)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          accent: "var(--text-accent)",
          success: "var(--text-success)",
          warning: "var(--text-warning)",
          danger: "var(--text-danger)",
        },
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        bg: {
          accent: "var(--bg-accent)",
          success: "var(--bg-success)",
          warning: "var(--bg-warning)",
          danger: "var(--bg-danger)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          dark: "var(--brand-dark)",
        },
      },
      borderRadius: {
        // Driven by the same tokens the component layer uses, so a radius is
        // changed in one place rather than in two that drift apart.
        DEFAULT: "var(--radius-control)",
        lg: "var(--radius-control)",
        card: "var(--radius-card)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        raised: "var(--shadow-raised)",
        pop: "var(--shadow-pop)",
      },
      transitionTimingFunction: {
        DEFAULT: "var(--ease)",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Inter",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
