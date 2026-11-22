"use client";

/**
 * El personaje del cuaderno (ticket 12g): quién comenta solo aquí, elegido en la cabecera, y los personajes de David.
 * Es la forma de los varios lectores de riddled.ai («Make a Riddler»: criterios distintos sobre la misma frase), sin su
 * marca ni sus textos. En la cabecera ocupa un hueco del tamaño de un botón de texto, con el punto de su tinta; crear,
 * editar y borrar personajes se hace en un diálogo que solo se abre desde su menú.
 */
import { useRef, useState, type FormEvent } from "react";
import { CheckIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Tinta } from "./cuadernos";
import { colorDePersonaje as punto, todos, type ListaPersonajes, type Personaje } from "./personajes";
import { TINTAS, colorDeTinta } from "./tintas";

/** Lo que David escribe de un personaje suyo; con `id`, edita ese. */
export interface CambioPersonaje { id?: string; nombre: string; descripcion: string; tinta: Tinta }

export interface PersonajeCuadernoProps {
	lista: ListaPersonajes;
	/** El que comenta solo en este cuaderno. */
	actual: Personaje;
	elegir(id: string): void;
	/** Rechaza con el mensaje del plugin si no se pudo (nombre repetido, tope...). */
	guardar(cambio: CambioPersonaje): Promise<void>;
	borrar(id: string): Promise<void>;
}


export function PersonajeCuaderno({ lista, actual, elegir, guardar, borrar }: PersonajeCuadernoProps) {
	const [gestionando, setGestionando] = useState(false);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button" data-personaje
						aria-label={`Comenta solo: ${actual.nombre}. Cambiar de personaje.`} title="El personaje que comenta solo en este cuaderno"
						className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
					>
						<span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: punto(actual) }} />
						<span>{actual.nombre}</span>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-64 font-sans">
					<DropdownMenuRadioGroup value={actual.id} onValueChange={elegir}>
						{todos(lista).map(p => (
							<DropdownMenuRadioItem key={p.id} value={p.id} data-personaje-opcion={p.id} className="items-start">
								<span aria-hidden="true" className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: punto(p) }} />
								<span className="min-w-0">
									<span className="block">{p.nombre}</span>
									<span className="block text-[11px] leading-4 text-muted-foreground">{p.descripcion}</span>
								</span>
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
					<DropdownMenuSeparator />
					<DropdownMenuItem data-gestionar-personajes onSelect={() => setGestionando(true)}>Tus personajes…</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{gestionando && <GestorPersonajes lista={lista} guardar={guardar} borrar={borrar} cerrar={() => setGestionando(false)} />}
		</>
	);
}

/** Los personajes propios y el formulario para crear o editar uno. Las tintas son las del cuaderno. */
export function GestorPersonajes({ lista, guardar, borrar, cerrar }: { lista: ListaPersonajes; guardar(cambio: CambioPersonaje): Promise<void>; borrar(id: string): Promise<void>; cerrar(): void }) {
	return (
		<Dialog open onOpenChange={(abierto) => { if (!abierto) cerrar(); }}>
			<DialogContent className="max-w-md font-sans" data-gestor-personajes>
				<DialogHeader>
					<DialogTitle>Tus personajes</DialogTitle>
					<DialogDescription>Cada uno comenta con tu criterio y vale para todos los cuadernos. Los cuatro de serie no se tocan.</DialogDescription>
				</DialogHeader>
				<ContenidoGestor lista={lista} guardar={guardar} borrar={borrar} />
			</DialogContent>
		</Dialog>
	);
}

/** Lo que hay dentro del diálogo: la lista de los propios y el formulario. Aparte del diálogo para poder montarlo solo. */
export function ContenidoGestor({ lista, guardar, borrar }: { lista: ListaPersonajes; guardar(cambio: CambioPersonaje): Promise<void>; borrar(id: string): Promise<void> }) {
	const [editando, setEditando] = useState<Personaje | "nuevo" | null>(lista.propios.length === 0 ? "nuevo" : null);
	const [error, setError] = useState<string | null>(null);
	const [enviando, setEnviando] = useState(false);
	const [tinta, setTinta] = useState<Tinta>("texto");
	// Sin controlar, como el propósito: lo escrito se lee al enviar, y el formulario se rehace con `key` al abrir otro personaje.
	const nombre = useRef<HTMLInputElement>(null), descripcion = useRef<HTMLTextAreaElement>(null);
	const [clave, setClave] = useState(0);
	const [valores, setValores] = useState({ nombre: "", descripcion: "" });
	const { max } = lista;

	const abrir = (p: Personaje | "nuevo") => {
		setEditando(p); setError(null);
		setValores({ nombre: p === "nuevo" ? "" : p.nombre, descripcion: p === "nuevo" ? "" : p.descripcion }); setClave(k => k + 1);
		setTinta(p === "nuevo" ? "texto" : p.tinta);
	};
	const enviar = async (e: FormEvent) => {
		e.preventDefault();
		if (enviando || !editando) return;
		setEnviando(true); setError(null);
		try {
			await guardar({ ...(editando !== "nuevo" ? { id: editando.id } : {}), nombre: nombre.current?.value ?? "", descripcion: descripcion.current?.value ?? "", tinta });
			setEditando(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
		setEnviando(false);
	};
	const quitar = async (p: Personaje) => {
		if (!window.confirm(`¿Borrar a «${p.nombre}»? Sus comentarios se quedan en los cuadernos con su firma.`)) return;
		setError(null);
		try { await borrar(p.id); if (editando !== "nuevo" && editando?.id === p.id) setEditando(null); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
	};
	const lleno = lista.propios.length >= max.personajes;

	return (
		<>
				{lista.propios.length > 0 && (
					<ul className="space-y-1" aria-label="Tus personajes">
						{lista.propios.map(p => (
							<li key={p.id} data-personaje-propio={p.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
								<span aria-hidden="true" className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: punto(p) }} />
								<span className="min-w-0 flex-1 text-sm"><span className="block">{p.nombre}</span><span className="block text-xs text-muted-foreground">{p.descripcion}</span></span>
								<Button type="button" size="icon-sm" variant="ghost" aria-label={`Editar a ${p.nombre}`} onClick={() => abrir(p)}><PencilIcon /></Button>
								<Button type="button" size="icon-sm" variant="ghost" aria-label={`Borrar a ${p.nombre}`} onClick={() => void quitar(p)}><Trash2Icon /></Button>
							</li>
						))}
					</ul>
				)}
				{editando ? (
					<form key={clave} onSubmit={(e) => void enviar(e)} className="space-y-2.5" data-formulario-personaje>
						<label className="block text-xs text-muted-foreground">Nombre
							<input
								ref={nombre} name="nombre" defaultValue={valores.nombre} maxLength={max.nombre} required autoFocus autoComplete="off"
								className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
							/>
						</label>
						<label className="block text-xs text-muted-foreground">Cómo quieres que comente, con tus palabras
							<textarea
								ref={descripcion} name="descripcion" defaultValue={valores.descripcion} maxLength={max.descripcion} required rows={3}
								placeholder="Por ejemplo: defiende la postura contraria y pide un caso real."
								className="mt-1 w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
							/>
						</label>
						<fieldset className="flex items-center gap-1" aria-label="Tinta del personaje">
							<span className="mr-1 text-xs text-muted-foreground">Tinta</span>
							{TINTAS.map(t => (
								<button
									key={t.id} type="button" aria-label={t.etiqueta} aria-pressed={tinta === t.id} title={t.etiqueta} data-tinta-personaje={t.id}
									onClick={() => setTinta(t.id)}
									className={cn("inline-flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", tinta === t.id ? "bg-accent" : "hover:bg-accent/60")}
								><span className="size-3 rounded-full" style={{ backgroundColor: colorDeTinta(t.id) }}>{tinta === t.id && <CheckIcon className="size-3 text-background" />}</span></button>
							))}
						</fieldset>
						{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
						<div className="flex justify-end gap-2">
							{lista.propios.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => { setEditando(null); setError(null); }}>Cancelar</Button>}
							<Button type="submit" size="sm" disabled={enviando || (editando === "nuevo" && lleno)}>{editando === "nuevo" ? "Crear" : "Guardar"}</Button>
						</div>
					</form>
				) : (
					<div className="flex items-center justify-between gap-2">
						{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : <span className="text-xs text-muted-foreground">{lleno ? `Has llegado a ${max.personajes} personajes.` : `${lista.propios.length} de ${max.personajes}`}</span>}
						<Button type="button" size="sm" disabled={lleno} onClick={() => abrir("nuevo")} data-nuevo-personaje>Nuevo personaje</Button>
					</div>
				)}
		</>
	);
}
