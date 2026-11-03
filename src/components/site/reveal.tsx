"use client";

import { createElement, useEffect, useRef } from "react";

type RevealProps = {
  as?: "div" | "li" | "section" | "article";
  delay?: number;
  className?: string;
  children: React.ReactNode;
};

/** Fades + lifts content in once, when it first enters the viewport. Hidden only when JS runs. */
export function Reveal({ as = "div", delay = 0, className, children }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return createElement(
    as as "div",
    {
      ref,
      className,
      "data-reveal": "",
      style: delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined,
    },
    children,
  );
}
