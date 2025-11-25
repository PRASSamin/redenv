import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { client } from "./app/redenv";

// This function can be marked `async` if using `await` inside
export async function middleware(request: NextRequest) {
  await client.load();
  console.log(process.env.PRAS);
  return NextResponse.next();
}
