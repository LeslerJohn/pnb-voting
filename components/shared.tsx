"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Crown, Monitor, ScanLine, Settings2, Sparkles } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { api, categories, phaseLabels, type Nominee, type Phase, type Snapshot } from "@/lib/types";

export function useSnapshot(view: "ballot" | "stage") {
  const [data, setData] = useState<Snapshot | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    let finished = false;
    let delay = 5000;
    let timer: number | undefined;
    const controller = new AbortController();

    async function poll() {
      if (inFlight || finished) return;
      inFlight = true;
      if (timer) window.clearTimeout(timer);
      try {
        const state = await api<Snapshot>(view, { signal: controller.signal });
        if (alive) {
          finished = state.phase === "revealed";
          delay = state.phase === "open" ? 12000 : 5000;
          setData(state);
          setProblem("");
        }
      } catch (error) {
        if (alive) setProblem(error instanceof Error ? error.message : "Could not load voting.");
      } finally {
        inFlight = false;
        if (alive && !finished) timer = window.setTimeout(poll, view === "stage" ? 3500 : delay + Math.random() * 3500);
      }
    }
    function onVisibility() { if (!document.hidden) void poll(); }
    void poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      controller.abort();
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [view]);
  return { data, problem };
}

export function Header({ view, actions }: { view: "ballot" | "host" | "stage"; actions?: React.ReactNode }) {
  return <header className="topbar">
    <Link href="/" aria-label="PNB Mindanao 6 ballot"><Brand /></Link>
    <nav aria-label="Voting pages" className="top-actions">
      {view === "ballot" && <Button asChild variant="outline" size="sm"><Link href="/stage"><Monitor /> Event screen</Link></Button>}
      {view === "host" && <Button asChild variant="outline" size="sm"><a href="/stage" target="_blank" rel="noreferrer"><Monitor /> Event screen <ArrowUpRight /></a></Button>}
      {view === "stage" && <Button asChild variant="outline" size="sm"><Link href="/host"><Settings2 /> Host</Link></Button>}
      {actions}
    </nav>
  </header>;
}

export function Status({ phase }: { phase?: Phase }) {
  return <span className={`phase-chip ${phase ?? "setup"}`}><i />{phase ? phaseLabels[phase] : "Connecting"}</span>;
}

export function Footer({ hostLink = false }: { hostLink?: boolean }) {
  return <footer>PNB Mindanao 6 <span>·</span> Christmas Party 2026 {hostLink && <><span>·</span><Link href="/host">Host console</Link></>}</footer>;
}

export function Portrait({ nominee, priority = false }: { nominee: Nominee; priority?: boolean }) {
  const [broken, setBroken] = useState(false);
  const initials = nominee.name.split(" ").slice(0, 2).map((word) => word[0]).join("");
  if (nominee.photo && !broken) return <img src={nominee.photo} alt="" loading={priority ? "eager" : "lazy"} decoding="async" onError={() => setBroken(true)} />;
  return <div className={`portrait-placeholder ${nominee.category}`} aria-hidden><Sparkles size={21} /><span>{initials}</span></div>;
}

export function PollHero({ phase }: { phase?: Phase }) {
  return <section className="runway-hero">
    <div className="hero-copy">
      <p className="eyebrow"><Sparkles size={15} /> Christmas in the Tropics</p>
      <h1>Tropical <em>Runway</em></h1>
      <p>Best dressed awards</p>
      <Status phase={phase} />
    </div>
  </section>;
}

export function Results({ data }: { data: Snapshot }) {
  const allResults = data.results;
  if (!allResults) return null;
  return <section className="results-section" aria-label="Voting results">
    <div className="section-heading"><div><h2>Best dressed results</h2><p>{data.turnout ?? 0} ballots counted</p></div><Crown size={25} /></div>
    <div className="result-grid">
      {categories.map(({ id, label }) => {
        const nominees = new Map(data.nominees.filter((candidate) => candidate.category === id).map((candidate) => [candidate.id, candidate]));
        const results = allResults.filter((result) => nominees.has(result.id));
        const top = results.filter((result) => result.votes > 0 && result.votes === results[0]?.votes);
        return <article className="result-panel" key={id}>
          <p className="eyebrow">{label}</p>
          <h3>{top.length === 0 ? "No votes cast" : top.length === 1 ? "Winner" : "Tied for first"}</h3>
          {top.length > 0 && <div className="winner-portraits">{top.map((result) => {
            const nominee = nominees.get(result.id)!;
            return <div className="winner-item" key={result.id}><div className="winner-image"><Portrait nominee={nominee} priority /></div><strong>{nominee.name}</strong></div>;
          })}</div>}
          <ul className="result-rows">
            {results.map((result) => {
              const share = data.turnout ? Math.round(100 * result.votes / data.turnout) : 0;
              return <li key={result.id}><div><span>{nominees.get(result.id)?.name}</span><strong>{result.votes} · {share}%</strong></div>
              <div className="result-track"><i style={{ "--share": `${share}%` } as React.CSSProperties} /></div></li>;
            })}
          </ul>
        </article>;
      })}
    </div>
  </section>;
}

export function EmptyBallot({ text }: { text: string }) {
  return <div className="empty-panel"><ScanLine size={27} /><p>{text}</p></div>;
}
