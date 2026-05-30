import { NextResponse } from "next/server";
import { getState } from "@/lib/chain";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getState();
  return NextResponse.json(state);
}
