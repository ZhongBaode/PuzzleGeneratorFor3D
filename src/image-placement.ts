import type { ModelPiece, Mesh } from './image-model';
export function positionedVertices(p: ModelPiece, mesh: Mesh) {
  return mesh.vertices.map((v, i) => i % 3 === 0 ? v - p.bounds.x + p.x : i % 3 === 1 ? v + p.bounds.y + p.bounds.height + p.y : v);
}
