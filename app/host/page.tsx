import type { Metadata } from "next";
import { Host } from "@/components/host";

export const metadata: Metadata = { title: "Voting host | PNB Mindanao 6", robots: { index: false, follow: false } };

export default function Page() {
  return <Host />;
}
