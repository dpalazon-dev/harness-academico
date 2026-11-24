import { PaginaPlan } from "@/components/estudio/plan";

/** Un plan del espacio activo: su objetivo y sus temas, tareas e hitos (spec `.scratch/planes`). */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return <PaginaPlan key={id} id={id} />;
}
