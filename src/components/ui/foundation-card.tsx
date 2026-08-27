import type { ReactNode } from "react";

type FoundationCardProps = {
  children: ReactNode;
  title: string;
};

export function FoundationCard({ children, title }: FoundationCardProps) {
  return (
    <section className="foundation-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
