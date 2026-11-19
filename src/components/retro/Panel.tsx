import type { ReactNode } from "react";

export type Accent = "blue" | "green" | "yellow" | "red" | "purple";

/** A face-coloured box with a coloured caption tab overlapping its top-left edge. */
export function Panel({ title, accent = "blue", children }: { title: string; accent?: Accent; children: ReactNode }) {
  return (
    <section className="panel px">
      <span className={`panel__tab panel__tab--${accent} px px--${accent}`}>{title}</span>
      {children}
    </section>
  );
}
