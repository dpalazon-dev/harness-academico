import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

// A loopback server on a reused port cannot impersonate this launch. Only
// the fingerprint is public. The API capability never leaves its process.
export function GET() {
	const secret = process.env.LH_DESKTOP_API_SECRET;
	if (!secret || process.env.LH_DESKTOP_SERVER !== "1") return new Response(null, { status: 404 });
	return new Response(null, { headers: {
		"cache-control": "no-store",
		"x-harness-instance": createHash("sha256").update(secret).digest("hex"),
	} });
}
