import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPythonTool } from '../../lib/htnPredictor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', '..', '..', '..', 'elderly-health-rag', 'graphrag_index.py');

export async function queryKnowledgeGraph(question, disease = null, context = {}) {
  const result = await runPythonTool(SCRIPT, { question, disease, context });
  // CLI 接口通过 argparse，runPythonTool 只能传 stdin；用 query 参数兼容服务端调用。
  return result;
}
