"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ClipboardList, Eye, ImagePlus, LockKeyhole, LogOut, Pencil, Plus, Ticket, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type Confirmation } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Footer, Header, Portrait, Results, Status } from "@/components/shared";
import { api, categories, type Category, type Nominee, type Phase, type Snapshot } from "@/lib/types";

const post = (data: object): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
});
const nextPhase: Partial<Record<Phase, { phase: Phase; label: string; confirm: string }>> = {
  setup: { phase: "open", label: "Open voting", confirm: "Open voting? The nominee list will be locked for this event." },
  open: { phase: "closed", label: "Close voting", confirm: "Close voting? Guests will no longer be able to submit ballots." },
  closed: { phase: "revealed", label: "Reveal results", confirm: "Reveal the final results to all guests and on the event screen?" },
};

function NomineeForm({ editing, onSave, onCancel, busy }: {
  editing: Nominee | null; onSave: (data: FormData) => Promise<boolean>; onCancel: () => void; busy: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await onSave(new FormData(event.currentTarget))) {
      form.current?.reset();
      setFile(null);
    }
  }

  return <form className="nominee-editor" ref={form} onSubmit={submit}>
    {editing && <input type="hidden" name="id" value={editing.id} />}
    <div className="editor-fields">
      <label>Nominee name<Input name="name" placeholder="e.g. Maria Santos" defaultValue={editing?.name} maxLength={100} required /></label>
      <label>Category<select name="category" defaultValue={editing?.category ?? "female"}>{categories.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label><span><ImagePlus size={16} /> Portrait</span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <small>Optional. JPEG, PNG, WebP or AVIF, up to 4 MB.</small></label>
      {editing?.photo && <label className="remove-photo"><input name="removePhoto" type="checkbox" /> Remove current portrait</label>}
      <div className="form-actions">
        <Button type="submit" disabled={busy}>{editing ? <Pencil /> : <Plus />} {editing ? "Save nominee" : "Add nominee"}</Button>
        {editing && <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}><X /> Cancel</Button>}
      </div>
    </div>
    {(file && preview) || editing?.photo ? <img className="editor-preview" src={file && preview ? preview : editing?.photo ?? ""} alt="Portrait preview" /> : null}
  </form>;
}

export function Host() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [editing, setEditing] = useState<Nominee | null>(null);
  const [category, setCategory] = useState<Category>("female");
  const [count, setCount] = useState(300);
  const [codes, setCodes] = useState<string[]>([]);
  const [formVersion, setFormVersion] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const getState = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/host/state", { cache: "no-store", signal });
    if (response.status === 401) {
      setData(null);
      setSignedIn(false);
      return;
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to load host controls.");
    setData(payload as Snapshot);
    setSignedIn(true);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getState(controller.signal).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [getState]);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (!document.hidden) getState(controller.signal).catch(() => { /* Retain the last snapshot during a brief outage. */ });
    }, 4500);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [signedIn, getState]);

  async function run(action: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await action();
      if (message) setInfo(message);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The request failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function refreshAfterChange() {
    try { await getState(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Saved. Refresh to see the updated state."); }
  }

  function signIn(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api("host/login", post({ password }));
      setPassword("");
      await getState();
    });
  }

  async function save(form: FormData) {
    const saved = await run(async () => {
      await api("host/nominee", { method: "POST", body: form });
      const target = form.get("category");
      if (target === "female" || target === "male") setCategory(target);
      setEditing(null);
      setFormVersion((value) => value + 1);
      await refreshAfterChange();
    }, "Nominee saved.");
    return saved;
  }

  function remove(nominee: Nominee) {
    setConfirmation({ title: "Remove nominee", message: `Remove ${nominee.name} from the ballot?`, label: "Remove nominee", destructive: true, onConfirm: () => void run(async () => {
      const form = new FormData();
      form.set("id", nominee.id);
      form.set("action", "delete");
      await api("host/nominee", { method: "POST", body: form });
      if (editing?.id === nominee.id) setEditing(null);
      await refreshAfterChange();
    }, "Nominee removed.") });
  }

  function issue(event: FormEvent) {
    event.preventDefault();
    const generate = () => void run(async () => {
      const result = await api<{ codes: string[] }>("host/issue", post({ count }));
      setCodes(result.codes);
      await refreshAfterChange();
    }, "Attendee codes generated. Download this batch before leaving the page.");
    if (codes.length) {
      setConfirmation({ title: "Generate another batch", message: "Download your current batch first if you still need those codes.", label: "Generate new batch", onConfirm: generate });
    } else generate();
  }

  function download() {
    const url = URL.createObjectURL(new Blob(["Attendee code\r\n", codes.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pnb-voting-codes-${Date.now()}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function phaseChange() {
    const next = data && nextPhase[data.phase];
    if (!next) return;
    setConfirmation({ title: next.label, message: next.confirm, label: next.label, onConfirm: () => void run(async () => {
      await api("host/phase", post({ phase: next.phase }));
      setEditing(null);
      await refreshAfterChange();
    }) });
  }

  function signOut() {
    const logout = () => void run(async () => { await api("host/logout", { method: "POST" }); setData(null); setCodes([]); setSignedIn(false); setEditing(null); });
    if (codes.length) {
      setConfirmation({ title: "Sign out", message: "Download your current batch first if you still need those attendee codes.", label: "Sign out", onConfirm: logout });
    } else logout();
  }

  return <>
    <Header view="host" />
    <main className="page-shell host-shell">
      <div className="host-heading"><div><p className="eyebrow">Tropical Runway</p><h1>Voting host</h1></div>{data && <Button variant="outline" disabled={busy} onClick={signOut}><LogOut /> Sign out</Button>}</div>
      {error && <p className="notice" role="alert">{error}</p>}
      {info && <p className="positive" role="status">{info}</p>}
      {loading ? <p className="empty-panel">Loading host controls…</p> : !signedIn || !data ?
        <form className="host-card sign-in" onSubmit={signIn}><LockKeyhole size={23} /><h2>Sign in</h2><label>Host password
          <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label><Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button></form> : <>
        <section className="host-card phase-panel">
          <div><Status phase={data.phase} /><h2>Poll controls</h2><p>Category totals appear after the reveal.</p></div>
          <div className="host-metrics"><span><Ticket /><strong>{data.issued ?? 0}</strong> codes issued</span><span><Users /><strong>{data.turnout ?? 0}</strong> ballots cast</span></div>
          {nextPhase[data.phase] && <Button size="lg" disabled={busy} onClick={phaseChange}>
            {data.phase === "closed" ? <Eye /> : <LockKeyhole />}{nextPhase[data.phase]?.label}
          </Button>}
        </section>
        {(data.phase === "setup" || data.phase === "open" || codes.length > 0) && <section className="host-card">
          <div className="section-heading"><div><h2>Attendee codes</h2><p>Hand one unique code to each guest at check-in. Save each batch as soon as you generate it.</p></div><Ticket size={22} /></div>
          {(data.phase === "setup" || data.phase === "open") && <form onSubmit={issue} className="issue-form">
            <label>Number of codes<Input type="number" min={1} max={500} value={Number.isNaN(count) ? "" : count} onChange={(event) => setCount(event.target.valueAsNumber)} required /></label>
            <Button type="submit" disabled={busy}><Plus /> Generate codes</Button>
          </form>}
          {codes.length > 0 && <div className="code-batch"><div><strong>Latest batch · {codes.length} codes</strong><Button variant="outline" onClick={download}>Download CSV</Button></div>
            <ul>{codes.map((code) => <li key={code}><code>{code}</code></li>)}</ul></div>}
        </section>}
        <section className="host-card">
          <div className="section-heading"><div><h2>Nominees</h2><p>{data.phase === "setup" ? "Add a name and an optional portrait in either category." : "The ballot roster is locked."}</p></div><ClipboardList size={22} /></div>
          {data.phase === "setup" && <NomineeForm key={`${editing?.id ?? "new"}-${formVersion}`} editing={editing} onSave={save} onCancel={() => setEditing(null)} busy={busy} />}
          <div className="category-switch" role="group" aria-label="Manage category">
            {categories.map(({ id, label }) => <button key={id} type="button" aria-pressed={category === id} onClick={() => setCategory(id)}>
              {label} <span>{data.nominees.filter((nominee) => nominee.category === id).length}</span>
            </button>)}
          </div>
          <ul className="nominee-admin-list">
            {data.nominees.filter((nominee) => nominee.category === category).map((nominee) => <li key={nominee.id}>
              <div className="mini-portrait"><Portrait nominee={nominee} key={nominee.photo ?? ""} /></div><strong>{nominee.name}</strong>
              {data.phase === "setup" && <>
                <Button size="icon" variant="ghost" disabled={busy} onClick={() => setEditing(nominee)} aria-label={`Edit ${nominee.name}`}><Pencil /></Button>
                <Button size="icon" variant="ghost" disabled={busy} onClick={() => remove(nominee)} aria-label={`Remove ${nominee.name}`}><Trash2 /></Button>
              </>}
            </li>)}
          </ul>
          {!data.nominees.some((nominee) => nominee.category === category) && <p className="empty-text">No nominees in this category yet.</p>}
        </section>
        <Results data={data} />
      </>}
    </main>
    <Footer />
    <ConfirmDialog request={confirmation} onDismiss={() => setConfirmation(null)} />
  </>;
}
