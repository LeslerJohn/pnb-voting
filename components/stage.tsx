"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { ChevronLeft, ChevronRight, Images, Maximize, Pause, Play, ScanLine, Users } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Footer, Header, PollHero, Portrait, Results, useSnapshot } from "@/components/shared";
import { categories } from "@/lib/types";

export function Stage() {
  const { data, problem } = useSnapshot("stage");
  const [url, setUrl] = useState("");
  const [image, setImage] = useState("");
  const [notice, setNotice] = useState("");
  const [spotlight, setSpotlight] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [slide, setSlide] = useState(0);
  const total = data?.nominees.length ?? 0;
  const nominee = total ? data?.nominees[slide % total] : undefined;

  useEffect(() => {
    if (!spotlight || !playing || total < 2 || data?.phase === "revealed") return;
    const timer = window.setInterval(() => setSlide((value) => (value + 1) % total), 6000);
    return () => window.clearInterval(timer);
  }, [spotlight, playing, total, data?.phase]);
  useEffect(() => {
    try {
      const target = new URL("/", process.env.NEXT_PUBLIC_VOTING_URL || window.location.origin);
      if (!["http:", "https:"].includes(target.protocol)) throw new Error("Invalid voting URL");
      setUrl(target.href);
      void QRCode.toDataURL(target.href, { width: 380, margin: 3, errorCorrectionLevel: "M" })
        .then(setImage).catch(() => setNotice("The QR code could not be drawn. Use the link below."));
    } catch {
      setNotice("The voting link is invalid. Check NEXT_PUBLIC_VOTING_URL.");
    }
  }, []);

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setNotice("Fullscreen is unavailable in this browser."); }
  }

  return <MotionConfig reducedMotion="user">
    <Header view="stage" actions={<>
      {total > 0 && data?.phase !== "revealed" && <Button variant="outline" size="sm" onClick={() => setSpotlight(!spotlight)}>
        {spotlight ? <ScanLine /> : <Images />}{spotlight ? "Show voting QR" : "Show nominees"}
      </Button>}
      <Button variant="outline" size="sm" onClick={fullscreen}><Maximize /> Fullscreen</Button>
    </>} />
    <main className={`page-shell stage-shell ${data?.phase === "revealed" || spotlight ? "stage-compact" : ""}`}>
      <PollHero phase={data?.phase} />
      {(problem || notice) && <p className="notice" role="alert">{problem || notice}</p>}
      <AnimatePresence mode="wait" initial={false}>
        {data?.phase === "revealed" ? <motion.div key="results" initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .35 }}>
          <Results data={data} />
        </motion.div> :
        spotlight && nominee ? <motion.section key="spotlight" className="spotlight" exit={{ opacity: 0 }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div className="spotlight-slide" key={nominee.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}>
              <div className="spotlight-portrait"><Portrait nominee={nominee} priority /></div>
              <div><p className="eyebrow">{categories.find(({ id }) => id === nominee.category)?.label}</p><h2>{nominee.name}</h2></div>
            </motion.div>
          </AnimatePresence>
          <div className="spotlight-controls">
            <Button variant="outline" size="icon" aria-label="Previous nominee" disabled={total < 2} onClick={() => setSlide((value) => (value + total - 1) % total)}><ChevronLeft /></Button>
            <span>{slide % total + 1} of {total}</span>
            <Button variant="outline" size="icon" aria-label="Next nominee" disabled={total < 2} onClick={() => setSlide((value) => (value + 1) % total)}><ChevronRight /></Button>
            <Button variant="outline" disabled={total < 2} onClick={() => setPlaying(!playing)}>{playing ? <Pause /> : <Play />}{playing ? "Pause" : "Autoplay"}</Button>
          </div>
        </motion.section> :
        <motion.section className="qr-panel" key="qr" exit={{ opacity: 0 }}>
          <div className="qr-copy">
            <p className="eyebrow"><ScanLine size={19} /> Mobile ballot</p>
            <h2>{data?.phase === "closed" ? "Voting is closed" : "Scan to vote"}</h2>
            <p>{data?.phase === "closed" ? "Stay tuned for the announcement." : "Open your phone camera and scan. Use your attendee code to choose one nominee for each award."}</p>
            {url && <a className="voting-url" href={url}>{url}</a>}
            {data?.turnout != null && <p className="turnout"><Users size={19} /><motion.strong key={data.turnout} initial={{ opacity: .5, y: 4 }} animate={{ opacity: 1, y: 0 }}>{data.turnout}</motion.strong> ballots submitted</p>}
          </div>
          {image && data?.phase !== "closed" && <img className="qr-image" src={image} alt="QR code for the PNB voting ballot" width="380" height="380" />}
        </motion.section>}
      </AnimatePresence>
    </main>
    <Footer />
  </MotionConfig>;
}
