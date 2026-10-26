import { QueueRejection, isAnalysisRecord } from '../queue/processingQueue.js';
export function createHiddenProcessor({ queue, dispatcher, jobTimeoutMs }) {
  return async function processAnalysisJob({ submitId, formId }) {
    const record = formId ? queue.getByFormId(formId) : queue.getBySubmitId(submitId);
    if (!record) return { fired: false, reason: 'unknown' };
    if (!isAnalysisRecord(record)) {
      return { fired: false, reason: 'not-an-analysis-job', submitId: record.submitId };
    }
    if (!dispatcher.configured) {
      return { fired: false, reason: 'engine-not-configured', submitId: record.submitId };
    }
    let jobToken;
    try {
      jobToken = queue.mintAnalysisToken(record.formId, { ttlMs: jobTimeoutMs });
    } catch (error) {
      if (error instanceof QueueRejection) {
        return { fired: false, reason: 'state', submitId: record.submitId };
      }
      throw error;
    }
    const accepted = await dispatcher.dispatch({
      jobToken,
      formId: record.formId,
      submitId: record.submitId,
      userId: record.userId,
      sessionId: record.sessionId,
      filename: record.uploadName,
      extension: record.requestedExtension,
      method: record.method,
      // the analysis column's mode, not the queue's circle
      task: record.mode,
      job: record.job,
    });
    if (!accepted.accepted) {
      queue.abortAnalysis(record.formId, 'Analysis service is unavailable');
      console.warn(
        `[hidden] analysis dispatch for ${record.submitId} was not accepted ` +
          `(${accepted.reason || `engine ${accepted.status}`})`,
      );
      return { fired: false, reason: 'dispatch-refused', submitId: record.submitId };
    }
    return { fired: true, submitId: record.submitId };
  };
}