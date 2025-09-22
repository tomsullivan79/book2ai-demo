import { NextResponse } from "next/server";

export async function GET() {
  const hasKey = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY!.startsWith("sk-");
  return NextResponse.json({ hasKey });
}
