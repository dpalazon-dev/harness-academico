/** Plugin-scoped notification to frontend listeners after every write. Since the seven-tab view was retired (ticket 11) nothing subscribes: the study shell re-reads after its own calls. */
export const CHANGED_TOPIC = 'estudio-cambiado';
