"use client";

/**
 * ⌘K (ticket 08, historias 12, 13 y 47): una paleta que busca en todo lo
 * estudiado con la operación `paleta` del plugin (conocimiento confirmado,
 * texto de los documentos con su página, notas y conversaciones) y lanza
 * acciones: el paso propuesto, abrir una unidad o una fuente, preguntar al
 * tutor, crear una unidad y crear un cuaderno. ⌘⇧F la abre limitada a conversaciones. No existe
 * en las pantallas de intento, que no dan acceso a fuentes (ticket 06).
 *
 * Las acciones hacen lo mismo que sus botones: el paso propuesto pasa por
 * `destinoDelPaso` como en el inicio, el tutor por `useAbrirConversacion`
 * como en la unidad, las fuentes por `rutaLector` como en Biblioteca y la
 * unidad nueva por `crear-unidad`, la operación del formulario «Nueva unidad», y el
 * cuaderno nuevo por `crearCuaderno`, como el botón «Nuevo cuaderno» (ticket 09).
 *
 * `ContenidoPaleta` y `FormularioUnidad` son puras; `Paleta` las conecta con
 * el plugin, el router y los atajos del núcleo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
	ArrowRightIcon, BookOpenIcon, BrainIcon, CircleDotIcon, FileTextIcon, LightbulbIcon, MessageSquareIcon, NotebookPenIcon, PlusIcon,
} from "lucide-react";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import { fuzzyScore, kbdEventForAction } from "@/src/core";
import { cn } from "@/lib/utils";
import { llamarEstudio } from "./llamar";
import { useAbrirConversacion } from "./abrir-conversacion";
import { destinoDelPaso } from "./paso";
import { rutaLector } from "./documentos";
import { sinBarraLateral } from "./barra-lateral";
import { crearCuaderno, rutaCuaderno } from "./cuadernos";
import type { LecturaInicio, LecturaPlan, PasoDeUnidad } from "./tipos";
import type { DocumentoEstudio } from "./documentos";
import type { ConversacionLista } from "./conversaciones";

/** `BusquedaPaleta` de `plugins/estudio/src/paleta.ts`. */
export type TipoResultado = "conocimiento" | "documento" | "nota" | "conversacion";
export type DestinoPaleta =
	| { tipo: "documento"; documentId: string; pagina: number | null }
	| { tipo: "unidad"; unitId: string }
	| { tipo: "cuaderno"; notebookId: string }
	| { tipo: "conversacion"; chatId: string };
export interface ResultadoPaleta { id: string; titulo: string; fragmento: string; pagina: number | null; destino: DestinoPaleta | null }
export interface BusquedaPaleta {
	grupos: { tipo: TipoResultado; resultados: ResultadoPaleta[] }[];
	vacio: "base_vacia" | "consulta_vacia" | "sin_coincidencias" | null;
}

export type ModoPaleta = "todo" | "conversaciones";

export interface DatosPaleta {
	paso: PasoDeUnidad | null;
	unidades: { id: string; titulo: string; propuesta: boolean }[];
	fuentes: { id: string; titulo: string }[];
	conversaciones: { id: string; titulo: string }[];
	/** La unidad de la página abierta, si es una: «Preguntar al tutor» la lleva como contexto. */
	unidadActual: { id: string; titulo: string } | null;
}

export type Eleccion =
	| { tipo: "ruta"; ruta: string }
	| { tipo: "paso"; paso: PasoDeUnidad }
	| { tipo: "tutor" }
	| { tipo: "nueva-unidad" }
	| { tipo: "nuevo-cuaderno" };

/** La pantalla de cada destino. */
export function rutaDeDestino(d: DestinoPaleta): string {
	switch (d.tipo) {
		case "documento": return rutaLector(d.documentId, d.pagina ? { pagina: d.pagina } : {});
		case "unidad": return `/unidad/${encodeURIComponent(d.unitId)}`;
		case "cuaderno": return rutaCuaderno(d.notebookId);
		case "conversacion": return `/chat/${encodeURIComponent(d.chatId)}`;
	}
}

const plegar = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "");
/** Filtro de lo que la paleta ya tiene (unidades, fuentes, acciones): todas las palabras, sin acentos ni mayúsculas. */
export function coincide(consulta: string, ...campos: string[]): boolean {
	return consulta.trim() === "" || fuzzyScore(plegar(consulta), ...campos.map(plegar)) !== null;
}

const GRUPO: Record<TipoResultado, { titulo: string; icono: typeof BookOpenIcon }> = {
	conocimiento: { titulo: "Conocimiento", icono: LightbulbIcon },
	documento: { titulo: "Documentos", icono: FileTextIcon },
	nota: { titulo: "Notas", icono: NotebookPenIcon },
	conversacion: { titulo: "Conversaciones", icono: MessageSquareIcon },
};

/** Sin consulta, las fuentes se limitan para que la lista empiece por lo que se hace. */
const FUENTES_SIN_CONSULTA = 5;
const CONVERSACIONES_RECIENTES = 8;

export function ContenidoPaleta({
	modo, consulta, onConsulta, datos, busqueda, buscando, error, onElegir,
}: {
	modo: ModoPaleta;
	consulta: string;
	onConsulta(valor: string): void;
	/** null mientras carga. */
	datos: DatosPaleta | null;
	busqueda: BusquedaPaleta | null;
	buscando: boolean;
	error?: string | null;
	onElegir(eleccion: Eleccion): void;
}) {
	const hay = consulta.trim() !== "";
	const soloConversaciones = modo === "conversaciones";
	const paso = !soloConversaciones && datos?.paso && coincide(consulta, datos.paso.accion, datos.paso.titulo) ? datos.paso : null;
	const unidades = soloConversaciones ? [] : (datos?.unidades ?? []).filter(u => coincide(consulta, u.titulo));
	const fuentes = soloConversaciones ? [] : (datos?.fuentes ?? []).filter(f => coincide(consulta, f.titulo)).slice(0, hay ? undefined : FUENTES_SIN_CONSULTA);
	const recientes = soloConversaciones && !hay ? (datos?.conversaciones ?? []).slice(0, CONVERSACIONES_RECIENTES) : [];
	const tutor = datos?.unidadActual ? `Preguntar al tutor sobre «${datos.unidadActual.titulo}»` : "Preguntar al tutor";
	const acciones = soloConversaciones ? [] : [
		{ clave: "tutor", texto: tutor, icono: MessageSquareIcon, eleccion: { tipo: "tutor" } as const },
		{ clave: "nueva-unidad", texto: "Nueva unidad", icono: PlusIcon, eleccion: { tipo: "nueva-unidad" } as const },
		{
			clave: "nuevo-cuaderno", texto: datos?.unidadActual ? `Nuevo cuaderno para «${datos.unidadActual.titulo}»` : "Nuevo cuaderno",
			icono: NotebookPenIcon, eleccion: { tipo: "nuevo-cuaderno" } as const,
		},
	].filter(a => coincide(consulta, a.texto));
	const grupos = hay ? busqueda?.grupos ?? [] : [];
	const encontrado = !!paso || unidades.length > 0 || fuentes.length > 0 || recientes.length > 0 || grupos.length > 0;
	const aviso = datos === null ? "Cargando…"
		: hay && buscando && grupos.length === 0 ? "Buscando en lo estudiado…"
		: !encontrado && (hay || soloConversaciones) ? (soloConversaciones && !hay ? "Aún no hay conversaciones en este espacio." : "Nada con ese texto en este espacio.")
		: null;

	// Sin el filtro de cmdk, la selección no vuelve sola al principio: al llegar los datos o los resultados,
	// el primer elemento queda seleccionado (y visible), no el que lo era mientras cargaba.
	const valores = [
		...(paso ? ["paso"] : []),
		...unidades.map(u => `unidad:${u.id}`),
		...fuentes.map(f => `fuente:${f.id}`),
		...recientes.map(c => `reciente:${c.id}`),
		...grupos.flatMap(g => g.resultados.filter(r => r.destino !== null).map(r => `resultado:${r.id}`)),
		...acciones.map(a => `accion:${a.clave}`),
	];
	const firma = valores.join("|");
	const [seleccion, setSeleccion] = useState(valores[0] ?? "");
	useEffect(() => { setSeleccion(firma.split("|")[0] ?? ""); }, [firma]);

	return (
		<Command shouldFilter={false} loop value={seleccion} onValueChange={setSeleccion} className="font-prose [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
			<CommandInput
				value={consulta}
				onValueChange={onConsulta}
				placeholder={soloConversaciones ? "Busca en tus conversaciones" : "Busca en lo estudiado o elige qué hacer"}
				aria-label={soloConversaciones ? "Buscar conversaciones" : "Buscar o hacer"}
				className="h-12 text-[15px]"
			/>
			{error && <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">{error}</p>}
			<CommandList className="max-h-[min(60vh,420px)] px-1 pb-1">
				{aviso && <p role="status" className="px-3 py-3 text-sm text-muted-foreground">{aviso}</p>}
				{paso && (
					<CommandGroup heading="Siguiente paso">
						<CommandItem value="paso" onSelect={() => onElegir({ tipo: "paso", paso })}>
							<CircleDotIcon />
							<span className="min-w-0 flex-1">
								<span className="block truncate">{paso.accion} · {paso.titulo}</span>
								<span className="block truncate text-xs text-muted-foreground">{paso.motivo}</span>
							</span>
							<CommandShortcut className="tracking-normal">{paso.boton}</CommandShortcut>
						</CommandItem>
					</CommandGroup>
				)}
				{unidades.length > 0 && (
					<CommandGroup heading="Unidades">
						{unidades.map(u => (
							<CommandItem key={u.id} value={`unidad:${u.id}`} onSelect={() => onElegir({ tipo: "ruta", ruta: rutaDeDestino({ tipo: "unidad", unitId: u.id }) })}>
								<BrainIcon />
								<span className={cn("flex-1 truncate", u.propuesta && "italic text-muted-foreground")}>{u.titulo}</span>
								{u.propuesta && <CommandShortcut className="tracking-normal">propuesta</CommandShortcut>}
							</CommandItem>
						))}
					</CommandGroup>
				)}
				{fuentes.length > 0 && (
					<CommandGroup heading="Fuentes">
						{fuentes.map(f => (
							<CommandItem key={f.id} value={`fuente:${f.id}`} onSelect={() => onElegir({ tipo: "ruta", ruta: rutaLector(f.id) })}>
								<BookOpenIcon />
								<span className="flex-1 truncate">{f.titulo}</span>
							</CommandItem>
						))}
					</CommandGroup>
				)}
				{recientes.length > 0 && (
					<CommandGroup heading="Conversaciones recientes">
						{recientes.map(c => (
							<CommandItem key={c.id} value={`reciente:${c.id}`} onSelect={() => onElegir({ tipo: "ruta", ruta: rutaDeDestino({ tipo: "conversacion", chatId: c.id }) })}>
								<MessageSquareIcon />
								<span className="flex-1 truncate">{c.titulo}</span>
							</CommandItem>
						))}
					</CommandGroup>
				)}
				{grupos.map(g => {
					const { titulo, icono: Icono } = GRUPO[g.tipo];
					return (
						<CommandGroup key={g.tipo} heading={titulo}>
							{g.resultados.map(r => (
								<CommandItem
									key={r.id}
									value={`resultado:${r.id}`}
									disabled={r.destino === null}
									onSelect={() => { if (r.destino) onElegir({ tipo: "ruta", ruta: rutaDeDestino(r.destino) }); }}
									className="items-start data-[disabled=true]:opacity-70"
								>
									<Icono className="mt-0.5" />
									<span className="min-w-0 flex-1">
										<span className="block truncate">{r.titulo}</span>
										<span className="line-clamp-2 text-xs text-muted-foreground">{r.fragmento}</span>
									</span>
									{r.pagina !== null && <CommandShortcut className="tracking-normal">p. {r.pagina}</CommandShortcut>}
									{r.destino === null && <CommandShortcut className="tracking-normal">sin página</CommandShortcut>}
								</CommandItem>
							))}
						</CommandGroup>
					);
				})}
				{acciones.length > 0 && (
					<>
						{encontrado && <CommandSeparator className="my-1" />}
						<CommandGroup heading="Acciones">
							{acciones.map(a => (
								<CommandItem key={a.clave} value={`accion:${a.clave}`} onSelect={() => onElegir(a.eleccion)}>
									<a.icono />
									<span className="flex-1 truncate">{a.texto}</span>
								</CommandItem>
							))}
						</CommandGroup>
					</>
				)}
			</CommandList>
			<div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
				<span><Kbd>↑</Kbd> <Kbd>↓</Kbd> moverse</span>
				<span><Kbd>↵</Kbd> abrir</span>
				<span><Kbd>Esc</Kbd> cerrar</span>
			</div>
		</Command>
	);
}

/** El formulario «Nueva unidad» de la vista antigua, dentro de la paleta: título, capacidad y criterio. */
export function FormularioUnidad({ enviando, error, onCrear, onVolver }: {
	enviando: boolean;
	error?: string | null;
	onCrear(campos: { title: string; capability: string; criterion: string }): void;
	onVolver(): void;
}) {
	const [title, setTitle] = useState("");
	const [capability, setCapability] = useState("");
	const [criterion, setCriterion] = useState("");
	const campo = "lh-input w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";
	return (
		<form
			className="grid gap-3 p-4 font-prose"
			onSubmit={(e) => { e.preventDefault(); if (title.trim()) onCrear({ title: title.trim(), capability: capability.trim(), criterion: criterion.trim() }); }}
		>
			<h2 className="font-title text-lg">Nueva unidad</h2>
			{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
			<label className="grid gap-1 text-sm">
				Título
				<input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} className={campo} />
			</label>
			<label className="grid gap-1 text-sm">
				Qué quiero poder hacer
				<textarea rows={2} value={capability} onChange={(e) => setCapability(e.target.value)} className={cn(campo, "resize-none")} />
			</label>
			<label className="grid gap-1 text-sm">
				Cómo sabré que lo puedo hacer
				<textarea rows={2} value={criterion} onChange={(e) => setCriterion(e.target.value)} className={cn(campo, "resize-none")} />
			</label>
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" onClick={onVolver}>Volver</Button>
				<Button type="submit" disabled={enviando || !title.trim()}>{enviando ? "Creando…" : "Crear unidad"}<ArrowRightIcon /></Button>
			</div>
		</form>
	);
}

const RETARDO_BUSQUEDA = 180;
const CUADRO_INICIO = 'textarea[aria-label="Mensaje al tutor"]';

/** La paleta conectada. `AppShell` no la monta en las pantallas de intento. */
export function Paleta() {
	const ruta = usePathname();
	const router = useRouter();
	const [abierta, setAbierta] = useState(false);
	const [modo, setModo] = useState<ModoPaleta>("todo");
	const [vista, setVista] = useState<"lista" | "nueva-unidad">("lista");
	const [consulta, setConsulta] = useState("");
	const [datos, setDatos] = useState<DatosPaleta | null>(null);
	const [busqueda, setBusqueda] = useState<BusquedaPaleta | null>(null);
	const [buscando, setBuscando] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [creando, setCreando] = useState(false);
	const conversacion = useAbrirConversacion(true);
	/** Lo que hay que enfocar al cerrar, en lugar de devolver el foco a donde estaba. */
	const alCerrar = useRef<(() => void) | null>(null);
	const rutaActual = useRef(ruta);
	rutaActual.current = ruta;

	const cargar = useCallback(async (actual: string) => {
		setDatos(null);
		const [plan, inicio, documentos, conversaciones] = await Promise.allSettled([
			llamarEstudio<LecturaPlan>("plan"),
			llamarEstudio<LecturaInicio>("inicio"),
			llamarEstudio<DocumentoEstudio[]>("documentos"),
			llamarEstudio<ConversacionLista[]>("conversaciones"),
		]);
		const unidades = plan.status === "fulfilled" ? plan.value.unidades : [];
		const enUnidad = /^\/unidad\/([^/?#]+)/.exec(actual)?.[1];
		const actualId = enUnidad ? decodeURIComponent(enUnidad) : null;
		const unidadActual = unidades.find(u => u.id === actualId) ?? null;
		setDatos({
			paso: inicio.status === "fulfilled" ? inicio.value.paso : null,
			unidades: unidades.map(u => ({ id: u.id, titulo: u.titulo, propuesta: u.propuesta })),
			fuentes: documentos.status === "fulfilled" ? documentos.value.filter(d => d.status === "listo").map(d => ({ id: d.id, titulo: d.title })) : [],
			conversaciones: conversaciones.status === "fulfilled" ? conversaciones.value.map(c => ({ id: c.id, titulo: c.title })) : [],
			unidadActual: unidadActual && { id: unidadActual.id, titulo: unidadActual.titulo },
		});
		if ([plan, inicio, documentos, conversaciones].every(r => r.status === "rejected")) setError("Estudio no responde: la búsqueda no está disponible.");
	}, []);

	const abrir = useCallback((siguiente: ModoPaleta) => {
		setModo(siguiente);
		setVista("lista");
		setConsulta("");
		setBusqueda(null);
		setError(null);
		setAbierta(true);
		void cargar(rutaActual.current);
	}, [cargar]);

	// ⌘K alterna la paleta; ⌘⇧F la abre (o la cambia) limitada a conversaciones.
	const estado = useRef({ abierta, modo });
	estado.current = { abierta, modo };
	useEffect(() => {
		const todo = () => { if (estado.current.abierta && estado.current.modo === "todo") setAbierta(false); else abrir("todo"); };
		const conversaciones = () => abrir("conversaciones");
		window.addEventListener(kbdEventForAction("command-palette"), todo);
		window.addEventListener(kbdEventForAction("sessions-search"), conversaciones);
		return () => {
			window.removeEventListener(kbdEventForAction("command-palette"), todo);
			window.removeEventListener(kbdEventForAction("sessions-search"), conversaciones);
		};
	}, [abrir]);

	// Navegar cierra la paleta; una pantalla de intento no la admite.
	useEffect(() => { setAbierta(false); }, [ruta]);

	// Si abrir la conversación falla después de cerrar, la paleta vuelve con el motivo.
	useEffect(() => {
		if (!conversacion.error) return;
		abrir("todo");
		setError(conversacion.error);
	}, [conversacion.error, abrir]);

	useEffect(() => {
		const texto = consulta.trim();
		if (!abierta || texto === "" || vista !== "lista") { setBusqueda(null); setBuscando(false); return; }
		setBuscando(true);
		let vigente = true;
		const t = setTimeout(() => {
			llamarEstudio<BusquedaPaleta>("paleta", { consulta: texto, ...(modo === "conversaciones" ? { tipos: ["conversacion"] } : {}) })
				.then((r) => { if (vigente) { setBusqueda(r); setError(null); } })
				.catch((e: unknown) => { if (vigente) { setBusqueda(null); setError(e instanceof Error ? e.message : "No se pudo buscar."); } })
				.finally(() => { if (vigente) setBuscando(false); });
		}, RETARDO_BUSQUEDA);
		return () => { vigente = false; clearTimeout(t); };
	}, [abierta, consulta, modo, vista]);

	const elegir = (e: Eleccion) => {
		switch (e.tipo) {
			case "ruta":
				setAbierta(false);
				router.push(e.ruta);
				return;
			case "paso": {
				setAbierta(false);
				// Como el paso del inicio o de la unidad: desde el inicio, los repasos vuelven al inicio.
				const destino = destinoDelPaso(e.paso, e.paso.unitId, ruta === "/" ? "inicio" : "unidad");
				if (destino.tipo === "tutor") void conversacion.abrir(e.paso.titulo, { tipo: "unidad", unitId: e.paso.unitId });
				else router.push(destino.ruta);
				return;
			}
			case "tutor": {
				setAbierta(false);
				const unidad = datos?.unidadActual;
				// En una unidad, como «Estudiar con el tutor»; fuera, el cuadro del inicio es donde se le pregunta.
				if (unidad) void conversacion.abrir(unidad.titulo, { tipo: "unidad", unitId: unidad.id });
				else if (ruta !== "/") router.push("/");
				else alCerrar.current = () => document.querySelector<HTMLTextAreaElement>(CUADRO_INICIO)?.focus();
				return;
			}
			case "nueva-unidad":
				setError(null);
				setVista("nueva-unidad");
				return;
			case "nuevo-cuaderno":
				void nuevoCuaderno();
				return;
		}
	};

	/** Como el botón «Nuevo cuaderno»: en una unidad, queda vinculado a ella. */
	const nuevoCuaderno = async () => {
		setError(null);
		try {
			const c = await crearCuaderno(datos?.unidadActual?.id);
			setAbierta(false);
			router.push(rutaCuaderno(c.id, { nuevo: true }));
		} catch (err) {
			setError(err instanceof Error ? err.message : "No se pudo crear el cuaderno.");
		}
	};

	const crearUnidad = async (campos: { title: string; capability: string; criterion: string }) => {
		setCreando(true);
		setError(null);
		try {
			const unidad = await llamarEstudio<{ id: string }>("crear-unidad", campos);
			setAbierta(false);
			router.push(`/unidad/${encodeURIComponent(unidad.id)}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "No se pudo crear la unidad.");
		} finally {
			setCreando(false);
		}
	};

	if (sinBarraLateral(ruta)) return null;
	return (
		<>
			<Dialog open={abierta} onOpenChange={setAbierta}>
				<DialogContent
					showCloseButton={false}
					className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
					onCloseAutoFocus={(ev) => {
						const enfocar = alCerrar.current;
						alCerrar.current = null;
						if (enfocar) { ev.preventDefault(); enfocar(); }
					}}
				>
					<DialogTitle className="sr-only">{modo === "conversaciones" ? "Buscar conversaciones" : "Buscar o hacer"}</DialogTitle>
					<DialogDescription className="sr-only">Busca en lo estudiado o elige una acción. Flechas para moverse, Intro para abrir y Escape para cerrar.</DialogDescription>
					{vista === "nueva-unidad" ? (
						<FormularioUnidad enviando={creando} error={error} onCrear={(c) => void crearUnidad(c)} onVolver={() => { setError(null); setVista("lista"); }} />
					) : (
						<ContenidoPaleta
							modo={modo}
							consulta={consulta}
							onConsulta={setConsulta}
							datos={datos}
							busqueda={busqueda}
							buscando={buscando}
							error={error}
							onElegir={elegir}
						/>
					)}
				</DialogContent>
			</Dialog>
			{conversacion.dialogo}
		</>
	);
}
