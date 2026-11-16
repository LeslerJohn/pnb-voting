"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { ArrowLeft, ArrowRight, BadgeCheck, Check, CircleAlert, Star, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyBallot, Footer, Header, PollHero, Portrait, Results, useSnapshot } from "@/components/shared";
import { api, categories, type Category, type Nominee } from "@/lib/types";

const receiptKey = "pnb-runway-receipt-v1";

export function Ballot() {
  const { data, problem } = useSnapshot("ballot");
  const [category, setCategory] = useState<Category>("female");
  const [selection, setSelection] = useState<Record<Category, string>>({ female: "", male: "" });
  const [review, setReview] = useState(false);
  const [code, setCode] = useState("");
  const [receipt, setReceipt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nominees = data?.nominees ?? [];
  const choice = (id: Category) => nominees.find((item) => item.id === selection[id] && item.category === id);
  const selectedCount = Number(!!choice("female")) + Number(!!choice("male"));

  useEffect(() => {
    try { setReceipt(localStorage.getItem(receiptKey) ?? ""); } catch { /* Voting works without browser storage. */ }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api<{ receipt: string }>("cast", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, femaleId: selection.female, maleId: selection.male }),
      });
      setReceipt(result.receipt);
      setCode("");
      try { localStorage.setItem(receiptKey, result.receipt); } catch { /* Receipt is still shown. */ }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to submit your ballot.");
    } finally {
      setBusy(false);
    }
  }

  function choose(nominee: Nominee) {
    setSelection((previous) => ({ ...previous, [nominee.category]: nominee.id }));
  }

  return <MotionConfig reducedMotion="user">
    <Header view="ballot" />
    <main className="page-shell">
      <PollHero phase={data?.phase} />
      {problem && <p className="notice" role="alert"><CircleAlert size={16} /> {problem}</p>}
      {data?.phase === "revealed" ? <Results data={data} /> :
        receipt ? <motion.section className="receipt" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} role="status">
          <BadgeCheck size={41} /><h2>Ballot counted!</h2><p>Thanks for voting. Watch the event screen for the results.</p>
          <p className="receipt-id">Receipt {receipt.slice(0, 8).toUpperCase()}</p>
        </motion.section> :
        review ? <motion.section className="ballot-form-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setReview(false); setError(""); }}><ArrowLeft /> Back to nominees</Button>
          <h2>Review your ballot</h2>
          <dl className="review-choices">{categories.map(({ id, label }) => <div key={id}><dt>{label}</dt><dd>{choice(id)?.name}</dd></div>)}</dl>
          <form onSubmit={submit}>
            <label htmlFor="attendee-code"><Ticket size={17} /> Attendee code</label>
            <Input id="attendee-code" name="attendee-code" value={code} autoComplete="off" autoCapitalize="characters" spellCheck={false}
              maxLength={22} required onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ABCD-EFGH-JKLM" />
            <p className="field-hint">Use the code from check-in. Each code submits one ballot covering both awards.</p>
            {error && <p className="notice" role="alert"><CircleAlert size={16} /> {error}</p>}
            <Button type="submit" size="lg" disabled={busy || selectedCount !== 2}>{busy ? "Submitting…" : "Submit ballot"}<Check /></Button>
          </form>
        </motion.section> :
        data?.phase !== "open" ? <EmptyBallot text={!data ? "Loading the ballot…" : data.phase === "closed" ? "Voting has ended. The results will appear here after the reveal." : "The ballot will open automatically when the host is ready."} /> :
        <section className="ballot-section" aria-label="Nominees">
          <div className="section-heading"><div><h2>Choose your favourites</h2><p>Pick one nominee per category.</p></div><span className="selected-count" aria-live="polite">{selectedCount} of 2 selected</span></div>
          <div className="category-switch" role="group" aria-label="Award category">
            {categories.map(({ id, label }) => <button key={id} type="button" aria-pressed={category === id} onClick={() => setCategory(id)}>
              {label}{choice(id) && <Check size={15} aria-label="Choice selected" />}
            </button>)}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div className="nominee-grid" key={category} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {nominees.filter((nominee) => nominee.category === category).map((nominee, index) => {
                const selected = selection[category] === nominee.id;
                return <button type="button" className="nominee-card" key={nominee.id} onClick={() => choose(nominee)} aria-pressed={selected}>
                  <div className="portrait-frame"><Portrait nominee={nominee} priority={index < 2} /><span className="portrait-star" aria-hidden>{selected ? <Check size={17} /> : <Star size={17} />}</span></div>
                  <span className="nominee-name">{nominee.name}</span>
                </button>;
              })}
            </motion.div>
          </AnimatePresence>
          <div className="ballot-actions">
            {selectedCount === 2 ? <Button size="lg" onClick={() => setReview(true)}>Review ballot <ArrowRight /></Button> :
              <Button size="lg" disabled={!choice(category)} onClick={() => setCategory(category === "female" ? "male" : "female")}>
                {category === "female" ? "Go to Best Dress Male" : "Go to Best Dress Female"} <ArrowRight />
              </Button>}
          </div>
        </section>}
    </main>
    <Footer hostLink />
  </MotionConfig>;
}
