import crypto from 'crypto';
import path from 'path';
export function createResponseGenerator() {
  return {



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