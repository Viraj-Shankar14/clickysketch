import type { ButtonHTMLAttributes, ReactNode } from "react";

export type Tone = "plain" | "blue" | "green" | "red";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  tone?: Tone;
  /** Translucent gloss on top of the tone colour (the modern touch). */
  glass?: boolean;
  small?: boolean;
  /** Square padding for icon-only buttons. */
  icon?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Button({
  tone = "plain",
  glass = false,
  small = false,
  icon = false,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    "px",
    tone !== "plain" ? `px--${tone}` : "",
    glass ? "btn--glass" : "",
    small ? "btn--sm" : "",
    icon ? "btn--icon" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
