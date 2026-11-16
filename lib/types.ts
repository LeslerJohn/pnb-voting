export const categories = [
  { id: "female", label: "Best Dress Female" },
  { id: "male", label: "Best Dress Male" },
] as const;

export type Category = typeof categories[number]["id"];
export type Phase = "setup" | "open" | "closed" | "revealed";
export type Nominee = { id: string; category: Category; name: string; photo: string | null };
export type Snapshot = {
  phase: Phase;
  nominees: Nominee[];
  turnout: number | null;
  issued: number | null;
  results: { id: string; votes: number }[] | null;
};

export const phaseLabels: Record<Phase, string> = {
  setup: "Voting opens soon", open: "Voting is open", closed: "Voting is closed", revealed: "Results are in",
};

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "The connection failed. Try again.");
  return data as T;
}
