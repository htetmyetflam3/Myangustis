
export { JUNK_DIR, ENV_RESULT, getLogen } from '../index-path.js';
export { BindEngine } from './Engine/init/bridge.js';


export async function getEngineData() {
  const paths = await import('./Engine/_path.js');
  return paths.getEngineData();
}
