import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { ArrowIcon } from "@/components/brand/icons";
import { cn } from "@/lib/utils";

/**
 * Buttons follow the brand's signal rule: orange marks the one primary action on a screen and
 * always carries Deep Navy text (white on orange fails contrast at 3.3:1).
 */
export const buttonVariants = cva(
  "group/btn inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-medium transition-[background-color,color,border-color,transform] duration-200 ease-rig active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-offset-4",
  {
    variants: {
      variant: {
        primary: "bg-orange text-navy hover:bg-[#FF7A4A]",
        navy: "bg-navy text-ice hover:bg-navy-700",
        ghost: "border border-navy/20 text-navy hover:border-navy/40 hover:bg-navy/[0.04]",
        ghostDark: "border border-ice/25 text-ice hover:border-ice/50 hover:bg-ice/[0.06]",
        quiet: "text-current underline-offset-[6px] hover:underline",
      },
      size: {
        sm: "h-9 px-4 text-meta",
        md: "h-11 px-5 text-body",
        lg: "h-[3.25rem] px-7 text-body-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

/** Trailing arrow that travels a few pixels on hover — the cord taking up slack. */
export function ButtonArrow({ size = 18 }: { size?: number }) {
  return (
    <ArrowIcon
      size={size}
      className="transition-transform duration-300 ease-cord group-hover/btn:translate-x-1 rtl:group-hover/btn:-translate-x-1"
    />
  );
}
