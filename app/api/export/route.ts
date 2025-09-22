// app/api/export/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

function toCsvCell(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const needsQuote = /[",\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = Math.max(1, Math.min(31, Number(url.searchParams.get("days") || 7)));
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("b2ai_query_log")
      .select("ts,q,answer_len,top")
      .gte("ts", sinceIso)
      .order("ts", { ascending: false })
      .limit(50000);

    if (error) throw error;

    const rows = data ?? [];
    const header = ["ts", "q", "answer_len", "top_json"];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [toCsvCell(r.ts), toCsvCell(r.q), toCsvCell(r.answer_len), toCsvCell(r.top)].join(",")
      ),
    ];
    const csv = lines.join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="book2ai-logs-${days}d.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: "export_error", detail: String(e) }, { status: 500 });
  }
}
