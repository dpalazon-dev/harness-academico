/**
 * POST /api/stt/transcribe — local dictation (ticket 12i). The renderer
 * sends the whole recording as 16 kHz mono linear16 PCM when the learner
 * stops; Parakeet runs on this machine and the text comes back. The API
 * proxy applies the usual desktop/browser access policy.
 */
import { handleTranscribe } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	return handleTranscribe(request);
}
