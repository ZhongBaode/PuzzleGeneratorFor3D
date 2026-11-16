import { strToU8, zipSync } from 'fflate';
import { positionedVertices, type Model } from './image-model';
import { escapeXml as esc } from './svg';
const f = (v: number) => String(+v.toFixed(9));
/** Core 3MF assemblies retain one independently movable object per piece and one material volume per color. */
export function exportPlate(model: Model, plate: number): Uint8Array {
  const resources: string[] = [], items: string[] = [], config: string[] = []; let id = 2;
  for (const p of model.pieces.filter(p => p.plate === plate)) {
    const components: string[] = [], parts: string[] = [];
    for (const solid of p.solids) {
      const object = id++, vertices = positionedVertices(p, solid.mesh), triangles = solid.mesh.triangles;
      const vs: string[] = [], ts: string[] = [];
      for (let i = 0; i < vertices.length; i += 3) vs.push(`<vertex x="${f(vertices[i])}" y="${f(vertices[i + 1])}" z="${f(vertices[i + 2])}"/>`);
      for (let i = 0; i < triangles.length; i += 3) ts.push(`<triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" v3="${triangles[i + 2]}"/>`);
      resources.push(`<object id="${object}" type="model" name="${esc(solid.name)}" pid="1" pindex="${solid.slot}"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>`);
      components.push(`<component objectid="${object}"/>`);
      parts.push(`<part id="${object}" subtype="normal_part"><metadata key="name" value="${esc(solid.name)}"/><metadata key="extruder" value="${solid.slot + 1}"/></part>`);
    }
    const object = id++;
    resources.push(`<object id="${object}" type="model" name="Piece ${p.id + 1}"><components>${components.join('')}</components></object>`);
    items.push(`<item objectid="${object}"/>`);
    config.push(`<object id="${object}"><metadata key="name" value="Piece ${p.id + 1}"/>${parts.join('')}</object>`);
  }
  if (!items.length) throw new Error('No pieces on this plate.');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Puzzle Foundry</metadata><metadata name="Title">Image puzzle · plate ${plate + 1}</metadata><resources><basematerials id="1">${model.palette.map((c, i) => `<base name="AMS ${i + 1}" displaycolor="${c}FF"/>`).join('')}</basematerials>${resources.join('')}</resources><build>${items.join('')}</build></model>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/octet-stream"/><Default Extension="json" ContentType="application/json"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(xml),
    'Metadata/model_settings.config': strToU8(`<?xml version="1.0"?><config>${config.join('')}</config>`),
    'Metadata/project_settings.config': strToU8(JSON.stringify({
      filament_colour: model.palette, filament_type: ['PLA', 'PLA', 'PLA', 'PLA'], filament_diameter: ['1.75', '1.75', '1.75', '1.75'],
      nozzle_diameter: [String(model.nozzle)], layer_height: String(model.layer), initial_layer_print_height: String(model.layer),
    })),
    'Metadata/puzzle.json': strToU8(JSON.stringify({ generator: 'Puzzle Foundry', units: 'mm', width: model.width, height: model.height, nozzle: model.nozzle, layerHeight: model.layer, backingLayers: 7, imageLayers: 3, backingSlot: model.backing + 1, palette: model.palette, clearance: model.clearance, extraSpacing: model.exploded ? 2 : 0, minimumPackedGap: model.spacing, plate: plate + 1, plates: model.plates, pieceIds: model.pieces.filter(p => p.plate === plate).map(p => p.id + 1) })),
  });
}
export function exportModel(model: Model) {
  if (model.plates === 1) return { bytes: exportPlate(model, 0), filename: 'image-puzzle.3mf', type: 'model/3mf' };
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < model.plates; i++) files[`image-puzzle-plate-${i + 1}.3mf`] = exportPlate(model, i);
  files['PRINT-README.txt'] = strToU8(`Open each 3MF separately in Bambu Studio. Use a ${model.nozzle} mm nozzle and ${model.layer} mm for both first and subsequent layers. Map AMS slots 1–4 to the four chosen colors. Backing: 7 layers; image: 3 layers. Keep each piece as a multipart object; do not drop its color volumes to the bed independently. Inspect the sliced layer and filament assignments before printing. No printer profile or G-code is included.`);
  return { bytes: zipSync(files), filename: 'image-puzzle-plates.zip', type: 'application/zip' };
}

/** OBJ is supplied as a ZIP because its four material colors live in a companion MTL file. */
export function exportObj(model: Model) {
  const files: Record<string, Uint8Array> = {};
  const mtl = model.palette.map((hex, i) => {
    const color = [1, 3, 5].map(n => (parseInt(hex.slice(n, n + 2), 16) / 255).toFixed(6));
    return `newmtl AMS_${i + 1}\nKa 0 0 0\nKd ${color.join(' ')}\nKs 0 0 0\nd 1\nillum 1`;
  }).join('\n\n');
  for (let plate = 0; plate < model.plates; plate++) {
    const name = `image-puzzle-plate-${plate + 1}`, lines = [`# Puzzle Foundry; coordinates in millimeters; Z up`, `mtllib ${name}.mtl`];
    let offset = 1;
    for (const p of model.pieces.filter(p => p.plate === plate)) {
      lines.push(`o Piece_${p.id + 1}`);
      p.solids.forEach((s, part) => {
        lines.push(`g Piece_${p.id + 1}_part_${part + 1}`, `usemtl AMS_${s.slot + 1}`);
        const v = positionedVertices(p, s.mesh);
        for (let i = 0; i < v.length; i += 3) lines.push(`v ${f(v[i])} ${f(v[i + 1])} ${f(v[i + 2])}`);
        for (let i = 0; i < s.mesh.triangles.length; i += 3) lines.push(`f ${s.mesh.triangles.slice(i, i + 3).map(n => n + offset).join(' ')}`);
        offset += v.length / 3;
      });
    }
    files[`${name}.obj`] = strToU8(lines.join('\n'));
    files[`${name}.mtl`] = strToU8(mtl);
  }
  files['PRINT-README.txt'] = strToU8(`Coordinates are millimeters, Z up. Keep each OBJ beside its matching MTL when importing. Four material names AMS_1 through AMS_4 correspond to the confirmed palette. Each Piece object contains backing and color groups; preserve their relative positions. Use a ${model.nozzle} mm nozzle and ${model.layer} mm first and subsequent layers (7 backing + 3 image layers). OBJ importers may ignore MTL or split multipart objects; use the companion 3MF export for stronger material/AMS metadata. Map the four actual filaments and inspect the sliced layers before printing. Each OBJ/MTL pair is a separate plate.`);
  return { bytes: zipSync(files), filename: 'image-puzzle-obj.zip', type: 'application/zip' };
}
