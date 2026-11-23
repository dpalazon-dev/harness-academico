"use client";

import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";

/**
 * La cola de mensajes (diseño 3A, aprobado por David el 23-nov-2026): lo que
 * se escribe mientras el tutor responde NO entra en el turno en curso; espera
 * aquí, se puede editar o quitar, y se envía junto, como un solo mensaje,
 * cuando el turno termina.
 */
export interface MensajeEnCola {
	id: string;
	texto: string;
}

export function encolar(cola: readonly MensajeEnCola[], texto: string, id: string): MensajeEnCola[] {
	const limpio = texto.trim();
	return limpio ? [...cola, { id, texto: limpio }] : [...cola];
}

export function quitar(cola: readonly MensajeEnCola[], id: string): MensajeEnCola[] {
	return cola.filter(m => m.id !== id);
}

/** El mensaje que se envía al terminar el turno: los encolados, en orden, separados por una línea en blanco. */
export function textoDeCola(cola: readonly MensajeEnCola[]): string {
	return cola.map(m => m.texto).join("\n\n");
}

/** ¿Se puede vaciar la cola ya? Solo con el turno terminado y nada esperando respuesta del estudiante. */
export function colaLista(estado: { ocupado: boolean; pendiente: boolean; compactando: boolean; enviando: boolean }): boolean {
	return !estado.ocupado && !estado.pendiente && !estado.compactando && !estado.enviando;
}

export function ColaMensajes({
	cola,
	onEditar,
	onQuitar,
}: {
	cola: readonly MensajeEnCola[];
	onEditar: (m: MensajeEnCola) => void;
	onQuitar: (m: MensajeEnCola) => void;
}) {
	if (cola.length === 0) return null;
	return (
		<ul className="flex flex-col gap-1 px-2 pb-2" aria-label="Mensajes en cola" data-testid="cola-mensajes">
			{cola.map(m => (
				<li key={m.id} className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-background px-3 py-1.5">
					<span className="shrink-0 rounded-sm border border-border px-1.5 font-ui text-xs text-muted-foreground">En cola</span>
					<span className="lh-input min-w-0 flex-1 truncate text-base">{m.texto}</span>
					<Hint label="Editar">
						<Button variant="ghost" size="icon-xs" aria-label="Editar el mensaje en cola" onClick={() => onEditar(m)}>
							<Pencil />
						</Button>
					</Hint>
					<Hint label="Quitar">
						<Button variant="ghost" size="icon-xs" aria-label="Quitar el mensaje de la cola" onClick={() => onQuitar(m)}>
							<X />
						</Button>
					</Hint>
				</li>
			))}
		</ul>
	);
}
