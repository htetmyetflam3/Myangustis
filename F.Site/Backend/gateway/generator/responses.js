import crypto from 'crypto';
import path from 'path';
export function createResponseGenerator() {
  return {
    /** When the caller already issued a submitId (the upload endpoint answers
        with it before parsing), it is honoured instead of minting a second
        one -- the id the visitor polls must be the id the raw file carries. */
    generate({ formId, sessionId, originalName, submitId = null }) {
      const id =
        typeof submitId === 'string' && /^[0-9a-f-]{36}$/i.test(submitId)
          ? submitId
          : crypto.randomUUID();
      let ext = '';
      if (originalName && typeof originalName === 'string') {
        const parsed = path.parse(originalName);
        if (parsed.ext && parsed.ext.length > 1) {
          ext = parsed.ext;
        }
      }
      const filename = `${id}${ext}`;
      return { submitId: id, filename };
    },
  };
}