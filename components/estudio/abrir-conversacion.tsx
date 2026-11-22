"use client";

/**
 * Conversaciones con contexto (ADR 0003): «Estudiar con el tutor» (y, en los
 * tickets 05 y 06, «Preguntar al tutor» y «Discutir») crean una conversación
 * nueva cuyo primer mensaje lleva la unidad, el pasaje o el intento, y
 * navegan a ella. La crea el núcleo; Estudio compone el contexto y la
 * registra en su espacio y con su unidad.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SetupDialog } from "@/components/setup-dialog";
import { openModelPicker, selectedModelUnavailable, useModelSetup } from "@/components/setup-cta";

export type ContextoEstudio =
	| { tipo: "unidad"; unitId: string }
	| { tipo: "pasaje"; documentId: string; page: number; quote: string; unitId?: string }
	| { tipo: "intento"; attemptId: string };

/** Crea la conversación con su contexto; devuelve su id o lanza con el motivo. */
export async function crearConversacion(titulo: string, contexto: ContextoEstudio): Promise<string> {
	const res = await fetch("/api/chats", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: titulo, studyContext: contexto }),
	});
	const body = await res.json().catch(() => null) as { id?: unknown; error?: unknown } | null;
	if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "No se pudo abrir la conversación.");
	if (typeof body?.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(body.id)) throw new Error("No se pudo abrir la conversación.");
	return body.id;
}

/** Con las mismas guardas que el inicio: sin modelos o sin clave no se crea
 * una conversación que no podría responder; se ofrece configurarlos. */
export function useAbrirConversacion(initialConfigured: boolean) {
	const router = useRouter();
	const { catalog, configured, zeroKeys } = useModelSetup(initialConfigured);
	const [configurar, setConfigurar] = useState(false);
	const [abriendo, setAbriendo] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const abrir = async (titulo: string, contexto: ContextoEstudio) => {
		if (!configured || zeroKeys) { setConfigurar(true); return; }
		const strong = catalog?.slots.strong?.model;
		if (selectedModelUnavailable(catalog, strong ? `${strong.provider}:${strong.id}` : undefined)) { openModelPicker(); return; }
		setAbriendo(true);
		setError(null);
		try {
			router.push(`/chat/${await crearConversacion(titulo, contexto)}`);
		} catch (e) {
			setError(e instanceof Error ? e.message : "No se pudo abrir la conversación.");
			setAbriendo(false);
		}
	};

	const dialogo = <SetupDialog open={configurar} onClose={() => setConfigurar(false)} onDone={() => setConfigurar(false)} />;
	return { abrir, abriendo, error, dialogo };
}
