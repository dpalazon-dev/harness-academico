"use client";

/**
 * El hilo de un comentario (ticket 12c): la conversación con el tutor junto a la frase de David. Se despliega dentro de la
 * tarjeta del margen; David escribe, el tutor contesta con el modelo fuerte y nada de lo que se dice entra en la página:
 * la conclusión la escribe David al volver a la nota.
 *
 * Teclado: Intro envía, Mayús+Intro salta de línea, Ctrl o ⌘+Intro vuelve a la nota y Escape cierra el hilo sin darlo por
 * atendido. El campo recibe el foco al abrirse.
 */
import { useEffect, useRef } from "react";
import { CornerDownLeftIcon, SendHorizontalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Comentario, Dibujo } from "./cuadernos";
import type { EsperaHilo } from "./margen";
import { firmaDe } from "./personajes";
import { DibujoMermaid } from "./dibujo-mermaid";
import { BotonEscuchar, type AccionesVoz } from "./escuchar-cuaderno";


/** Lo que sigue al último mensaje: la respuesta que se espera, o por qué no llegó. */
export function EstadoEspera({ espera, reintentar }: { espera: EsperaHilo; reintentar?(): void }) {
	if (espera.estado === "pensando") return <p className="mt-1 text-muted-foreground motion-safe:animate-pulse" role="status">Pensando…</p>;
	return (
		<p role="alert" className="mt-1 text-destructive">
			{espera.error ?? "No se pudo contestar."}
			{reintentar && <> <button type="button" data-recorrido onClick={reintentar} className="rounded-sm font-sans text-xs underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">Reintentar</button></>}
		</p>
	);
}

const boton = "inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-sans text-xs font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

export function HiloMargen({ comentario: c, firma, espera, borrador, cambiarBorrador, enviar, volver, cerrar, reintentar, dibujos, voz }: {
	comentario: Comentario;
	/** El nombre vigente de quien escribió el comentario; sin él, la firma guardada. */
	firma?: string;
	espera?: EsperaHilo;
	borrador: string;
	cambiarBorrador(texto: string): void;
	enviar(texto: string): void;
	volver(): void;
	cerrar(): void;
	reintentar(): void;
	/** Los dibujos del tutor en este comentario (ticket 12h), cada uno bajo el mensaje que lo trajo; el mismo dibujo cuelga también del párrafo. */
	dibujos?: { lista: readonly Dibujo[]; quitar?(comentarioId: string, dibujoId: string): void; clave: string };
	/** Escuchar (ticket 12j): cada mensaje del tutor lleva su botón. */
	voz?: AccionesVoz;
}) {
	const campo = useRef<HTMLTextAreaElement>(null);
	useEffect(() => { campo.current?.focus(); }, []);
	const esperando = espera?.estado === "pensando";
	const mandar = () => {
		const texto = borrador.trim();
		if (texto && !esperando) enviar(texto);
	};
	return (
		<div
			data-hilo={c.id}
			onKeyDown={(e) => { if (e.key === "Escape" && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); cerrar(); } }}
		>
			<ol aria-label="Hilo del comentario" className="mt-2 grid gap-3">
				{c.thread.map(m => (
					<li key={m.id} data-rol={m.role} className={cn(m.role === "david" && "rounded-md bg-muted/60 px-2.5 py-1.5")}>
						<div className="flex items-center gap-1.5">
							<p className="font-sans text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{m.role === "david" ? "Tú" : firma ?? firmaDe(c)}</p>
							{voz && m.role === "tutor" && <BotonEscuchar mensajeId={m.id} texto={m.text} firma={firma ?? firmaDe(c)} voz={voz} className="ml-auto" />}
						</div>
						<p className="mt-0.5 whitespace-pre-wrap">{m.text}</p>
						{dibujos?.lista.filter(d => d.mensajeId === m.id).map(d => (
							<DibujoMermaid key={d.id} id={`hilo-${d.id}`} codigo={d.mermaid} firma={firma ?? firmaDe(c)} clave={dibujos.clave} compacto quitar={dibujos.quitar && (() => dibujos.quitar!(c.id, d.id))} />
						))}
					</li>
				))}
				{espera?.pendiente && (
					<li data-rol="david" data-pendiente="" className="rounded-md bg-muted/60 px-2.5 py-1.5 opacity-70">
						<p className="font-sans text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Tú</p>
						<p className="mt-0.5 whitespace-pre-wrap">{espera.pendiente}</p>
					</li>
				)}
			</ol>
			{espera && <EstadoEspera espera={espera} reintentar={espera.estado === "error" ? reintentar : undefined} />}
			<textarea
				ref={campo} name="respuesta-hilo" data-campo="respuesta-hilo" rows={1} value={borrador}
				aria-label="Tu respuesta al tutor" placeholder="Responde al tutor…"
				onChange={(e) => cambiarBorrador(e.target.value)}
				onKeyDown={(e) => {
					if (e.nativeEvent.isComposing || e.key !== "Enter" || e.shiftKey) return;
					e.preventDefault();
					if (e.ctrlKey || e.metaKey) volver(); else mandar();
				}}
				className="field-sizing-content mt-3 block max-h-48 min-h-8 w-full resize-none border-0 border-b border-border bg-transparent px-0 py-1 font-prose text-[0.8125rem] leading-[1.35rem] outline-none placeholder:text-muted-foreground/60 focus:border-foreground/40"
			/>
			<div className="mt-2 flex items-center gap-1">
				<button type="button" data-recorrido data-hilo-volver onClick={volver} className={boton} title="Ctrl+Intro">
					<CornerDownLeftIcon className="size-3.5" />Volver a la nota
				</button>
				<button type="button" data-recorrido data-hilo-enviar disabled={!borrador.trim() || esperando} onClick={mandar} className={cn(boton, "ml-auto disabled:opacity-40")} title="Intro">
					<SendHorizontalIcon className="size-3.5" />Enviar
				</button>
			</div>
		</div>
	);
}
