import { Sparkles } from "lucide-react";

export function Brand() {
  return <div className="brand">
    <span className="brand-icon"><Sparkles size={21} aria-hidden /></span>
    <div><strong>PNB <span>Mindanao 6</span></strong><small>Philippine National Bank</small></div>
  </div>;
}
