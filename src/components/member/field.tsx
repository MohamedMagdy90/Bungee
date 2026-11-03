"use client";

import { useTranslations } from "next-intl";
import { forwardRef, useId, useState } from "react";
import { InfoIcon } from "@/components/brand/icons";
import { cn } from "@/lib/utils";

const inputClass =
  "peer h-12 w-full rounded-md border border-navy/20 bg-white px-4 text-body text-navy placeholder:text-slate transition-[border-color,box-shadow] duration-200 hover:border-navy/35 focus:border-navy focus:outline-none focus:ring-[3px] focus:ring-aqua/35 disabled:opacity-60 aria-[invalid=true]:border-orange-ember";

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null };

/** Label above, hint/error below. Errors are announced and tie to the input via aria-describedby. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(({ label, hint, error, className, id, ...props }, ref) => {
  const auto = useId();
  const inputId = id ?? auto;
  const noteId = `${inputId}-note`;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-meta font-medium text-navy">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? noteId : undefined}
        className={inputClass}
        {...props}
      />
      {(error || hint) && (
        <p id={noteId} className={cn("mt-1.5 text-meta", error ? "text-orange-ember" : "text-steel")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
});
Field.displayName = "Field";

/** Password with a show/hide toggle sitting inside the field's inline-end edge. */
export function PasswordField({ label, hint, error, className, ...props }: FieldProps) {
  const t = useTranslations("auth.fields");
  const [show, setShow] = useState(false);
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-meta font-medium text-navy">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? noteId : undefined}
          className={cn(inputClass, "pe-20")}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute inset-y-1.5 end-1.5 rounded-sm px-3 text-meta font-medium text-steel transition-colors hover:bg-navy/5 hover:text-navy"
          aria-pressed={show}
        >
          {show ? t("hide") : t("show")}
        </button>
      </div>
      {(error || hint) && (
        <p id={noteId} className={cn("mt-1.5 text-meta", error ? "text-orange-ember" : "text-steel")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/** Inline banner for form-level outcomes. */
export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 text-meta",
        tone === "error" && "border-orange-ember/30 bg-orange/[0.08] text-navy",
        tone === "success" && "border-aqua-lagoon/30 bg-aqua/[0.12] text-navy",
        tone === "info" && "border-navy/15 bg-white text-navy",
      )}
    >
      <InfoIcon
        size={18}
        className={cn(
          "mt-px shrink-0",
          tone === "error" ? "text-orange-ember" : tone === "success" ? "text-aqua-lagoon" : "text-steel",
        )}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
