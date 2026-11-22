"use client";

/**
 * «Escuchar» en la cabecera del cuaderno y en cada comentario (ticket 12j). El interruptor sigue la forma del del modo del 12e
 * (un punto de tinta y una palabra), discreto, con la tinta del margen cuando está encendido. El botón de un comentario lo lee
 * a demanda, con el interruptor como esté. Ni la marca ni los textos de riddled.ai: solo su forma.
 */
import { SquareIcon, Volume2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VozVista } from "./escuchar";
import { colorDeTinta } from "./tintas";

const TINTA = `var(--tinta-margen, ${colorDeTinta(undefined)})`;

const TEXTO_AVISO = {
	"sin-espanol": "Sin voz en español: se usa la predeterminada.",
	fallo: "No se pudo leer en voz alta.",
} as const;

export function EscucharCuaderno({ voz }: { voz: VozVista }) {
	const { disponible, activo, leyendo, aviso, alternar } = voz;
	return (
		<>
			<button
				type="button" role="switch" aria-checked={disponible && activo} aria-disabled={disponible ? undefined : true} data-escuchar-interruptor
				title={disponible ? "Que el tutor te lea en voz alta sus comentarios nuevos, con las voces de tu equipo" : "Este equipo no ofrece síntesis de voz"}
				onClick={() => { if (disponible) alternar(); }}
				className={cn(
					"inline-flex h-7 items-center gap-2 rounded-full border border-border px-2.5 text-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-ring",
					disponible ? "hover:bg-accent hover:text-accent-foreground" : "cursor-not-allowed text-muted-foreground opacity-70",
				)}
			>
				<span
					aria-hidden="true"
					className={cn("size-2 rounded-full transition-opacity", disponible && activo ? "opacity-100" : "bg-muted-foreground/40 opacity-60", leyendo && "motion-safe:animate-pulse")}
					style={disponible && activo ? { backgroundColor: TINTA } : undefined}
				/>
				<span>Escuchar</span>
			</button>
			{!disponible && <span role="status" data-escuchar-aviso="sin-voz" className="text-muted-foreground">Sin voz en este equipo</span>}
			{aviso && <span role="status" data-escuchar-aviso={aviso} className="text-muted-foreground">{TEXTO_AVISO[aviso]}</span>}
		</>
	);
}

/** Lo que un comentario necesita para escucharse: el estado de la voz y cómo leer o parar. */
export type AccionesVoz = Pick<VozVista, "disponible" | "leyendo" | "leer" | "parar">;

/** El botón de un mensaje del tutor: «Escuchar», y «Detener» mientras suena ese mensaje. Sin voz en el equipo, no se pinta. */
export function BotonEscuchar({ mensajeId, texto, firma, voz, className }: { mensajeId: string; texto: string; firma: string; voz: AccionesVoz; className?: string }) {
	if (!voz.disponible) return null;
	const suena = voz.leyendo === mensajeId;
	return (
		<button
			type="button" data-recorrido data-escuchar-mensaje={mensajeId}
			aria-label={suena ? "Detener la lectura" : `Escuchar el comentario de ${firma}`}
			onClick={() => { if (suena) voz.parar(); else voz.leer(mensajeId, texto); }}
			className={cn("inline-flex h-6 items-center gap-1 rounded-md font-sans text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)}
		>
			{suena ? <SquareIcon className="size-3" aria-hidden="true" /> : <Volume2Icon className="size-3.5" aria-hidden="true" />}
			{suena ? "Detener" : "Escuchar"}
		</button>
	);
}
