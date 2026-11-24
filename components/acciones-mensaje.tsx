"use client";

import { Check, Copy, GitBranch, Pin, PinOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";

/**
 * Acciones de un mensaje al pasar el ratón (harness conversacional, diseño
 * 3A elegido por David el 23-nov-2026, como Claude Code): solo iconos, con su
 * nombre al pasar. Copiar y Fijar en todos los mensajes; «Bifurcar desde
 * aquí» en las respuestas del tutor (crea una conversación nueva con el
 * historial hasta esa respuesta y la abre).
 */

const FOCO = "focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function AccionesMensaje({
	chatId,
	messageId,
	texto,
	bifurcable,
	fijado,
	onFijar,
}: {
	chatId: string;
	messageId: string;
	texto: string;
	/** Solo las respuestas del tutor ya terminadas. */
	bifurcable: boolean;
	fijado: boolean;
	onFijar: (messageId: string, fijado: boolean) => void;
}) {
	const router = useRouter();
	const [copiado, setCopiado] = useState(false);
	const [estado, setEstado] = useState<"quieto" | "bifurcando" | { error: string }>("quieto");
	const copiar = async () => {
		try {
			await navigator.clipboard.writeText(texto);
			setCopiado(true);
			setTimeout(() => setCopiado(false), 1500);
		} catch {
			setEstado({ error: "No se pudo copiar el mensaje." });
		}
	};
	const bifurcar = async () => {
		setEstado("bifurcando");
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
		<div
			className={`mt-1 flex items-center gap-0.5 transition-opacity ${error || fijado ? "opacity-100" : "opacity-0 group-hover/mensaje:opacity-100 focus-within:opacity-100"}`}
			data-testid="acciones-mensaje"
		>
			<Hint label={copiado ? "Copiado" : "Copiar"}>
				<Button variant="ghost" size="icon-sm" className={`text-muted-foreground ${FOCO}`} aria-label={copiado ? "Copiado" : "Copiar el mensaje"} onClick={() => void copiar()}>
					{copiado ? <Check /> : <Copy />}
				</Button>
			</Hint>
			{bifurcable && (
				<Hint label="Bifurcar desde aquí">
					<Button variant="ghost" size="icon-sm" className={`text-muted-foreground ${FOCO}`} aria-label="Bifurcar desde aquí" disabled={estado === "bifurcando"} onClick={() => void bifurcar()}>
						<GitBranch />
					</Button>
				</Hint>
			)}
			<Hint label={fijado ? "Quitar de fijados" : "Fijar"}>
				<Button
					variant="ghost"
					size="icon-sm"
					className={`${fijado ? "text-[var(--lh-accent)]" : "text-muted-foreground"} ${FOCO}`}
					aria-label={fijado ? "Quitar de fijados" : "Fijar el mensaje"}
					aria-pressed={fijado}
					onClick={() => onFijar(messageId, !fijado)}
				>
					{fijado ? <PinOff /> : <Pin />}
				</Button>
			</Hint>
			{error && (
				<span role="alert" className="ml-2 text-xs text-error">
					{error} <button type="button" className="underline underline-offset-2" onClick={() => setEstado("quieto")}>Cerrar</button>
				</span>
			)}
		</div>
	);
}

/** Texto de un mensaje para copiar o para su ficha en «Fijados». */
export function textoDeMensaje(parts: readonly { type: string; text?: unknown }[]): string {
	return parts.filter(p => p.type === "text" && typeof p.text === "string").map(p => p.text as string).join("\n\n").trim();
}

/** «Fijados» arriba de la conversación: una ficha por mensaje; un clic lleva a él. */
export function FijadosConversacion({ mensajes, onIr }: { mensajes: readonly { id: string; texto: string }[]; onIr: (id: string) => void }) {
	if (mensajes.length === 0) return null;
	return (
		<nav aria-label="Mensajes fijados" className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="fijados">
			<span className="text-muted-foreground">Fijados:</span>
			{mensajes.map(m => (
				<button
					key={m.id}
					type="button"
					onClick={() => onIr(m.id)}
					className={`inline-flex h-7 max-w-64 items-center gap-1.5 rounded-full border border-border px-2.5 hover:bg-accent ${FOCO} outline-none`}
				>
					<Pin className="size-3 shrink-0" aria-hidden />
					<span className="truncate">{m.texto || "Mensaje sin texto"}</span>
				</button>
			))}
		</nav>
	);
}

/** Aviso al principio de una rama: de qué conversación salió, con enlace al original. */
export function AvisoRama({ forkedFrom }: { forkedFrom: { chatId: string; title: string } }) {
	return (
		<p className="flex items-center gap-2 rounded-md bg-card px-3 py-1.5 text-sm text-muted-foreground" data-testid="aviso-rama">
			<GitBranch className="size-3.5 shrink-0" aria-hidden />
			<span className="min-w-0 truncate">Bifurcada de «{forkedFrom.title}»</span>
			<Link href={`/chat/${forkedFrom.chatId}`} className={`ml-auto shrink-0 rounded-sm text-foreground underline underline-offset-2 outline-none ${FOCO}`}>
				Ir al original
			</Link>
		</p>
	);
}
