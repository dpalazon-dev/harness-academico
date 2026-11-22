import { Inicio } from "@/components/estudio/inicio";
import { readSettingsRecord } from "@/src/server";
import { slotsConfigured } from "@/src/core";

// Dynamic: whether the model slots are configured is server-rendered into the
// page, and every navigation re-reads the record.
export const dynamic = "force-dynamic";

/** Armazón de estudio (ADR 0001 y 0005): the app opens on the study home,
 * not on the LearnHarness graph. */
export default function HomePage() {
	return <Inicio initialConfigured={slotsConfigured(readSettingsRecord()?.models)} />;
}
