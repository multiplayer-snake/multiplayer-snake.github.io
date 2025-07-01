import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })

  const {
    data: { session },
  } = await supabase.auth.getSession()

  // If user is not signed in and trying to access protected routes
  if (!session && req.nextUrl.pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/", req.url))
  }

  // If user is signed in and trying to access auth pages
  if (session && (req.nextUrl.pathname === "/auth" || req.nextUrl.pathname === "/")) {
    // Check if user has completed profile setup
    const { data: userProfile } = await supabase.from("users").select("id").eq("id", session.user.id).single()

    if (!userProfile) {
      // User exists but no profile, redirect to complete setup
      return NextResponse.redirect(new URL("/setup", req.url))
    }
  }

  return res
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
