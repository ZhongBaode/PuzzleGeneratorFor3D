import { generateWithClearance } from './geometry';
import { buildModel } from './image-model';
import { exportModel, exportObj } from './image-export';
self.onmessage = ({ data }) => {
  try {
    if (data.action === 'export') {
      const result = data.format === 'obj' ? exportObj(data.model) : exportModel(data.model); self.postMessage({ id: data.id, result }, { transfer: [result.bytes.buffer] });
    } else {
      const pattern = generateWithClearance(data.settings);
      if (data.action === 'cuts') self.postMessage({ id: data.id, pattern });
      else {
        const model = buildModel(data.raster, pattern, data.palette, data.backing, data.nozzle, data.exploded);
        self.postMessage({ id: data.id, model });
      }
    }
  } catch (e) { self.postMessage({ id: data.id, error: e instanceof Error ? e.message : 'Model generation failed.' }); }
};
