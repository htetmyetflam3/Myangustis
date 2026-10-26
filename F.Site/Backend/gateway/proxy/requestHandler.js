export function createInputHandler({ textHolder, metadataGuard, rawSaver }) {
  return async function handleInput({
    req,
    formId,
    parsedText,
    quarantinePath,
    submitId = null,
  }) {
    const source = req.file ? 'file' : 'text';
    const originalName = req.file?.originalname || null;
    await metadataGuard.validateSubmission({
      userId: req.userId,
      formId,
      source,
    });
    const textContent = await textHolder({ req, source, parsedText });
    const result = await rawSaver({
      formId,
      textContent,
      submitId,
      metadata: {
        userId: req.userId,
        visitorHash: req.visitorHash,
        source,
        originalName,
        quarantinePath,
      },
    });
    return result;
  };
}