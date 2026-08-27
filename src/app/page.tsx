import { FoundationCard } from "@/components/ui/foundation-card";
import { accentPalettes } from "@/lib/theme/palettes";

export default function Home() {
  return (
    <main className="foundation-page">
      <div className="foundation-glow" aria-hidden="true" />
      <section className="foundation-content" aria-labelledby="page-title">
        <p className="eyebrow">Phase 1A · Foundation</p>
        <h1 id="page-title">A calmer place for everything.</h1>
        <p className="intro">
          The technical and visual foundations are ready. Product features begin
          in later phases.
        </p>

        <div className="foundation-grid">
          <FoundationCard title="Foundation ready">
            <ul className="status-list" aria-label="Foundation status">
              <li><span aria-hidden="true" />Next.js App Router</li>
              <li><span aria-hidden="true" />Semantic design tokens</li>
              <li><span aria-hidden="true" />Mobile-first defaults</li>
            </ul>
          </FoundationCard>

          <FoundationCard title="Accent foundations">
            <ul className="palette-list" aria-label="Available accent palettes">
              {accentPalettes.map((palette) => (
                <li key={palette.id} data-accent={palette.id}>
                  <span className="palette-swatch" aria-hidden="true" />
                  {palette.label}
                </li>
              ))}
            </ul>
          </FoundationCard>
        </div>

        <p className="phase-note">
          Intentionally minimal. No dashboard, tasks, or calendar yet.
        </p>
      </section>
    </main>
  );
}
