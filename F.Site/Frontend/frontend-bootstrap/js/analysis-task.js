export const ANALYSIS_TASK = "analysis";
export const ANALYSIS_TASK_PREFIX = "analysis-";
export const ANALYSIS_VARIANTS = ["extracting", "conversion"];
export function analysisVariantFromTask(task = "") {
  if (task === ANALYSIS_TASK) return "";
  if (!String(task).startsWith(ANALYSIS_TASK_PREFIX)) return null;
  const variant = String(task).slice(ANALYSIS_TASK_PREFIX.length);
  return ANALYSIS_VARIANTS.includes(variant) ? variant : null;
}
export function analysisVariantFromJob(job = "") {
  if (!String(job).endsWith("-analysis")) return null;
  const variant = String(job).slice(0, job.length - "-analysis".length);
  return ANALYSIS_VARIANTS.includes(variant) ? variant : null;
}

export function overrideTask(flow, job) {
  if (flow !== ANALYSIS_TASK) return flow;
  const variant = analysisVariantFromJob(job);
  return variant ? `${ANALYSIS_TASK_PREFIX}${variant}` : ANALYSIS_TASK;
}