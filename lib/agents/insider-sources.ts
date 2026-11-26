import type { InsiderTrade } from "@/lib/data/edgar";
import type { ReportSource } from "./report-prompt";

export function insiderTradeSources(trades: InsiderTrade[]): ReportSource[] {
  void trades;
  throw new Error("not implemented");
}
