import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
      colors: {
        ink: "#0b0b14",
        card: "#15151f",
        line: "#262635",
        glow: "#a78bfa",
      },
    },
  },
  plugins: [],
};
export default config;
