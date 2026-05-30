import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: { blue: "#0052FF", glow: "#3D7BFF" },
        ink: { 900: "#05070F", 800: "#0A0E1C", 700: "#111729" },
        yield: "#34F5C5",
        slash: "#FF4D6D",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px -10px rgba(61,123,255,0.55)",
        "glow-yield": "0 0 40px -12px rgba(52,245,197,0.5)",
      },
    },
  },
  plugins: [],
};
export default config;
