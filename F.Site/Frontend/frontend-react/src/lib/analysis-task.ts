export type AnalysisVariant = "extracting" | "conversion";
export type AnalysisTask = "analysis" | `analysis-${AnalysisVariant}`;

export const ANALYSIS_TASK = "analysis";
export const ANALYSIS_TASK_PREFIX = "analysis-";
export const ANALYSIS_VARIANTS: AnalysisVariant[] = ["extracting", "conversion"];


export function analysisVariantFromTask(task = ""): AnalysisVariant | "" | null {
  if (task === ANALYSIS_TASK) return "";
  if (!String(task).startsWith(ANALYSIS_TASK_PREFIX)) return null;
  const variant = String(task).slice(ANALYSIS_TASK_PREFIX.length);
  return (ANALYSIS_VARIANTS as string[]).includes(variant)
    ? (variant as AnalysisVariant)
    : null;
}


export function analysisVariantFromJob(job = ""): AnalysisVariant | null {
  if (!String(job).endsWith("-analysis")) return null;
  const variant = String(job).slice(0, job.length - "-analysis".length);
  return (ANALYSIS_VARIANTS as string[]).includes(variant)
    ? (variant as AnalysisVariant)
    : null;
}


export function overrideTask(flow: string, job?: string): string {
  if (flow !== ANALYSIS_TASK) return flow;
  const variant = analysisVariantFromJob(job ?? "");
  return variant ? `${ANALYSIS_TASK_PREFIX}${variant}` : ANALYSIS_TASK;
}
