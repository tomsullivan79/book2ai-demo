import { NextResponse } from 'next/server';
import { listPacks } from '@/lib/packs';

export async function GET() {
  const packs = listPacks().map((p) => ({ id: p.id, title: p.title }));
  return NextResponse.json({ packs });
}
