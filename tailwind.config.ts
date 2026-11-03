import type { Config } from "tailwindcss";

/**
 * Bungee Fly design tokens.
 * Palette and proportions from Brand Guidelines §11–12 (60 navy / 25 ice / 10 orange / 5 aqua).
 * Orange and aqua are signals, never surfaces.
 */
export default {
  darkMode: ["class"],
  // app/ lives at the project root (keeps route files shallow; see .same/todos.md "restore depth").
  content: ["./app/**/*.{ts,tsx,mdx}", "./src/**/*.{ts,tsx,mdx}"],
  theme: {
    screens: {
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1440px",
    },
    extend: {
      colors: {
        navy: { DEFAULT: "#0B1F33", 900: "#06131F", 700: "#14304A", 600: "#1C3A57" },
        midnight: "#06131F",
        steel: "#334A5F",
        slate: "#7A8A99",
        ice: "#E7EBED",
        mist: "#F4F6F7",
        orange: { DEFAULT: "#FF642E", ember: "#C8431A" },
        aqua: { DEFAULT: "#28C7D5", lagoon: "#0E8E9B" },
        hairline: "rgb(11 31 51 / 0.12)",
        "hairline-dark": "rgb(231 235 237 / 0.14)",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
      },
      fontFamily: {
        display: ["var(--font-display-stack)"],
        sans: ["var(--font-text-stack)"],
      },
      // Arabic runs ~7% larger with 10% looser leading (Brand §14), via --ts / --lh on <html lang="ar">.
      fontSize: {
        caption: ["calc(0.6875rem * var(--ts))", { lineHeight: "calc(1.35 * var(--lh))", letterSpacing: "0.22em" }],
        meta: ["calc(0.8125rem * var(--ts))", { lineHeight: "calc(1.45 * var(--lh))" }],
        body: ["calc(1rem * var(--ts))", { lineHeight: "calc(1.6 * var(--lh))" }],
        "body-lg": ["calc(1.0625rem * var(--ts))", { lineHeight: "calc(1.6 * var(--lh))" }],
        lede: ["calc(clamp(1.125rem, 0.9rem + 0.7vw, 1.375rem) * var(--ts))", { lineHeight: "calc(1.5 * var(--lh))" }],
        h3: ["calc(clamp(1.25rem, 1.05rem + 0.6vw, 1.5rem) * var(--ts))", { lineHeight: "calc(1.25 * var(--lh))" }],
        h2: ["calc(clamp(1.75rem, 1.2rem + 1.8vw, 2.75rem) * var(--ts))", { lineHeight: "calc(1.1 * var(--lh))", letterSpacing: "-0.015em" }],
        h1: ["calc(clamp(2.125rem, 1.4rem + 2.6vw, 3.75rem) * var(--ts))", { lineHeight: "calc(1.05 * var(--lh))", letterSpacing: "-0.02em" }],
        display: ["calc(clamp(3.25rem, min(1rem + 9.6vw, 16svh), 9rem) * var(--ts))", { lineHeight: "0.92" }],
        "display-sm": ["calc(clamp(2.5rem, 1rem + 5.2vw, 5.75rem) * var(--ts))", { lineHeight: "0.95" }],
      },
      borderRadius: {
        none: "0",
        xs: "3px",
        sm: "6px",
        DEFAULT: "10px",
        md: "10px",
        lg: "16px",
        xl: "22px",
        pill: "999px",
      },
      spacing: {
        gutter: "var(--gutter)",
        margin: "var(--margin)",
      },
      maxWidth: {
        frame: "1440px",
        measure: "68ch",
      },
      transitionTimingFunction: {
        cord: "cubic-bezier(0.22, 1.2, 0.36, 1)",
        rig: "cubic-bezier(0.2, 0, 0, 1)",
      },
      transitionDuration: {
        lift: "480ms",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
