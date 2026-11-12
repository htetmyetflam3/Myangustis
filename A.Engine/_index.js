
export { JUNK_DIR, ENV_RESULT, getLogen } from '../index-path.js';
export { BindEngine } from './architecture/init/bridge.js';


export async function getEngineData() {
  const paths = await import('./architecture/_path.js');
  return paths.getEngineData();
}
