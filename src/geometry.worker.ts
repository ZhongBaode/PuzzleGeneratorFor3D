import { generateWithClearance, GeometryIssue } from './geometry';
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, pattern: generateWithClearance(data.settings) }); }
  catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Geometry could not be generated.', diagnostic: error instanceof GeometryIssue ? error.diagnostic : undefined }); }
};
