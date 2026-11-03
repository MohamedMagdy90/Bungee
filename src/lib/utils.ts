import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know our custom type scale; otherwise `text-meta` is read as a colour and
 * silently drops the real text colour (e.g. navy labels on orange buttons turn white).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption", "meta", "body", "body-lg", "lede", "h3", "h2", "h1", "display", "display-sm"] }],
      rounded: [{ rounded: ["xs", "pill"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
