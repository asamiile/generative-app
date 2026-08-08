import { NextResponse } from "next/server";

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:8000";
const APP_API_TOKEN = process.env.APP_API_TOKEN ?? "";

export async function GET() {
  const res = await fetch(`${BACKEND_API_URL}/api/providers`, {
    headers: { Authorization: `Bearer ${APP_API_TOKEN}` },
  });
  const data = await res.text();
  return new NextResponse(data, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
