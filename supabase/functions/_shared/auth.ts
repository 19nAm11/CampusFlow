type AuthenticatedUser = { id: string };

type AuthResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; status: number; message: string };

// Use the project's Auth service to verify the token rather than trusting its
// presence or decoding client-supplied JWT claims without verification.
export async function authenticateUser(request: Request): Promise<AuthResult> {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return { ok: false, status: 401, message: "Please sign in before using this feature." };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("CAMPUSFLOW_PUBLISHABLE_KEY");
  if (!supabaseUrl || !publishableKey) {
    console.error("Authentication configuration is missing.");
    return { ok: false, status: 500, message: "Authentication is not configured." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${match[1]}` },
      signal: controller.signal,
      // Do not forward credentials to a redirect destination.
      redirect: "error",
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 401, message: "Your session is invalid. Please sign in again." };
    }
    if (!response.ok) {
      console.error("Authentication service failed.", { status: response.status });
      return { ok: false, status: 503, message: "Unable to verify your session. Please try again." };
    }

    const user: unknown = await response.json();
    if (!user || typeof user !== "object" || Array.isArray(user) ||
      !("id" in user) || typeof user.id !== "string" || !user.id.trim()) {
      return { ok: false, status: 503, message: "Unable to verify your session. Please try again." };
    }
    return { ok: true, user: { id: user.id } };
  } catch {
    return { ok: false, status: 503, message: "Unable to verify your session. Please try again." };
  } finally {
    clearTimeout(timer);
  }
}
