"use client";

import { GitBranch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * «Bifurcar desde aquí» bajo cada respuesta del tutor (diseño 4A): crea una
 * conversación nueva con el historial hasta esta respuesta y la abre. Se
 * enseña al pasar el ratón o al llegar con el teclado; un error se dice en
 * la misma línea.
 */
export function BifurcarMensaje({ chatId, messageId }: { chatId: string; messageId: string }) {
	const router = useRouter();
	const [estado, setEstado] = useState<"quieto" | "creando" | { error: string }>("quieto");
	const bifurcar = async () => {
		setEstado("creando");
		try {
			const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/fork`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ messageId }),
			});
			const datos = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
			if (!res.ok || !datos.id) throw new Error(datos.error ?? "No se pudo bifurcar la conversación.");
			setEstado("quieto");
			router.push(`/chat/${datos.id}`);
		} catch (error) {
			setEstado({ error: error instanceof Error && error.message ? error.message : "No se pudo bifurcar la conversación." });
		}
	};
	const error = typeof estado === "object" ? estado.error : null;
	return (
		<div className={`mt-1 flex items-center gap-2 transition-opacity ${error ? "opacity-100" : "opacity-0 group-hover/mensaje:opacity-100 focus-within:opacity-100"}`} data-testid="acciones-mensaje">
			<Button
				variant="ghost"
				size="xs"
				className="text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]"
				disabled={estado === "creando"}
				onClick={() => void bifurcar()}
			>
				<GitBranch />
				{estado === "creando" ? "Bifurcando…" : "Bifurcar desde aquí"}
			</Button>
			{error && (
				<span role="alert" className="font-ui text-xs text-error">
					{error} <button type="button" className="underline underline-offset-2" onClick={() => setEstado("quieto")}>Cerrar</button>
				</span>
			)}
		</div>
	);
}

/** Aviso al principio de una rama: de qué conversación salió, con enlace al original. */
export function AvisoRama({ forkedFrom }: { forkedFrom: { chatId: string; title: string } }) {
	return (
		<p className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 font-ui text-xs text-muted-foreground" data-testid="aviso-rama">
			<GitBranch className="size-3 shrink-0" aria-hidden />
			<span className="min-w-0 truncate">Bifurcada de «{forkedFrom.title}»</span>
			<Link href={`/chat/${forkedFrom.chatId}`} className="ml-auto shrink-0 text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lh-accent)]">
				Ir al original
			</Link>
		</p>
	);
}
