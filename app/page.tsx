import Link from "next/link";

const EXAMPLES = [
  "Did near-surface air temperature in Colombia change between 2005 and 2024?",
  "¿Ha cambiado la precipitación en la cuenca amazónica desde 2001?",
  "Is soil moisture declining in the Sahel?",
];

export default function Home() {
  return (
    <>
      <section className="hero on-dark">
        <div className="page">
          <p className="step-label" style={{ color: "#9fd3ff" }}>
            NASA Space Apps 2026 · Earth System Trend Detective
          </p>
          <h1>
            Ask the Earth a question. <span className="accent">Get the evidence.</span>
          </h1>
          <p className="lead">
            Cryonova turns questions into reproducible analyses of live NASA data: it selects variables, a region and a period, queries the provider at that moment, and shows trends with
            uncertainty, coverage and full provenance. No account needed.
          </p>
        </div>
      </section>
      <div className="page">
        <div className="landing-grid">
          <section className="card stack" aria-labelledby="ask-title">
            <h2 id="ask-title">Start with a question</h2>
            <form action="/investigate" method="get" className="stack">
              <label htmlFor="q">Your question (English or Spanish)</label>
              <textarea id="q" name="q" maxLength={600} required placeholder={EXAMPLES[0]} />
              <button type="submit" className="btn btn-primary">
                Start investigation
              </button>
            </form>
            <div>
              <p className="label">Examples</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {EXAMPLES.map((q) => (
                  <li key={q}>
                    <Link href={`/investigate?q=${encodeURIComponent(q)}`}>{q}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <div>
            <section className="card stack" aria-labelledby="new-title">
              <h2 id="new-title">Explore data directly</h2>
              <p>Pick a region on the map, a period, and one or many variables from the live-verified NASA catalog.</p>
              <Link href="/investigate" className="btn btn-secondary">
                New investigation
              </Link>
            </section>
            <section className="card stack" id="open-with-code" aria-labelledby="open-title">
              <h2 id="open-title">Open with code</h2>
              <p className="muted">Saved investigations can be reopened with their code. Saving is being enabled in the next release.</p>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
