
export { JUNK_DIR, ENV_RESULT } from '../index-path.js';
export { BindEngine } from './Engine/bridge/bind-engine.js';


export async function getEngineData() {
  const paths = await import('./Engine/_path.js');
  return paths.getEngineData();
}
