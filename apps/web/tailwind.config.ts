import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0F172A",
        brand: {
          950: "#0F2A5F",
          700: "#2563EB",
          50: "#EFF6FF",
        },
        canvas: "#F7F9FC",
      },
      boxShadow: {
        card: "0 1px 2px rgb(15 23 42 / 0.04), 0 10px 30px rgb(15 23 42 / 0.05)",
        float: "0 16px 44px rgb(15 23 42 / 0.10)",
      },
      borderRadius: {
        card: "1rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
