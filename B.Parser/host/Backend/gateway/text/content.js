export function createTextHolder() {
  return async function holdText({ req, source, parsedText }) {
    let textContent;
    if (source === 'file') {
      textContent = parsedText;
    } else {
      textContent = req.body?.text;
      if (!textContent || typeof textContent !== 'string') {
        throw new Error('No text provided');
      }
    }
    return textContent;
  };
}