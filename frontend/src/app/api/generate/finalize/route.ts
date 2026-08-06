import { NextRequest, NextResponse } from "next/server";
import { backendFetch } from "@/lib/backendFetch";

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:8000";
const APP_API_TOKEN = process.env.APP_API_TOKEN ?? "";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const res = await backendFetch(`${BACKEND_API_URL}/api/generate/finalize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APP_API_TOKEN}`,
    },
    body,
  });
  const data = await res.text();
  return new NextResponse(data, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
