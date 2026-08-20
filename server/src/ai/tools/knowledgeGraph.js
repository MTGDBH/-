import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPythonTool } from '../../lib/htnPredictor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', '..', '..', '..', 'elderly-health-rag', 'graphrag_index.py');

export async function queryKnowledgeGraph(question, disease = null, context = {}, options = {}) {
  const result = await runPythonTool(SCRIPT, {
    question,
    disease,
    context,
    options: {
      top_k: Math.max(1, Math.min(8, Number(options.topK || options.top_k || 6))),
      max_hops: Math.max(1, Math.min(2, Number(options.maxHops || options.max_hops || 2))),
      include_trace: options.includeTrace !== false,
      audience: options.audience || 'elderly',
      explain_level: options.explainLevel || 'standard',
      backend: options.backend || 'local_hybrid',
    },
  });
  // CLI 接口通过 argparse，runPythonTool 只能传 stdin；用 query 参数兼容服务端调用。
  return result;
}
