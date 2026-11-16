import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { area, generateWithClearance, booleanPaths, type Point } from '../src/geometry';
import { defaults } from '../src/settings';
import { detectPalette, mapRaster, rasterSize, colorRegions, extrude, verifyMesh, meshVolume, buildModel, positionedVertices, packPieces, type ModelPiece } from '../src/image-model';
import { exportModel, exportPlate, exportObj } from '../src/image-export';
const palette = ['#FFFFFF', '#000000', '#C12E1F', '#0A2989'];
const raster = { width: 8, height: 4, labels: new Uint8Array([0,0,1,1,2,2,3,3,0,1,1,2,2,3,3,0,1,1,2,2,3,3,0,0,1,2,2,3,3,0,0,1]) };
const pattern = (extra = {}) => generateWithClearance({ ...defaults, width: 64, height: 36, count: 4, tabStyle: 'jigsaw', tabSize: 2, ...extra });

test('four-color detection is deterministic and nearest-color mapping uses four slots only', () => {
  const data = new Uint8ClampedArray(palette.flatMap(c => [...[1,3,5].map(i => parseInt(c.slice(i,i+2),16)),255]));
  assert.deepEqual(new Set(detectPalette(data)), new Set(palette));
  assert.deepEqual(detectPalette(data), detectPalette(data));
  assert.deepEqual([...mapRaster(data,4,1,palette).labels],[0,1,2,3]);
  assert.equal(detectPalette(new Uint8ClampedArray([255,255,255,255])).length,4);
  assert.ok(rasterSize(256,.2).width > rasterSize(256,.4).width);
  assert.equal(rasterSize(256,.4).height/rasterSize(256,.4).width,9/16);
});
test('merged raster polygons cover the full image exactly without overlapping colors', () => {
  const regions = colorRegions(raster,64,36);
  assert.ok(Math.abs(regions.flat().reduce((sum,p)=>sum+area(p),0)-64*36)<.001);
  for (let a=0;a<4;a++) for (let b=a+1;b<4;b++) assert.equal(booleanPaths(regions[a],regions[b],'intersection').length,0);
});
test('hole-aware extrusion has correct volume, winding and closed edges', () => {
  const outer: Point[] = [[0,0],[10,0],[10,10],[0,10]], hole: Point[] = [[2,2],[2,8],[8,8],[8,2]];
  const m = extrude([outer,hole],1.4,2); verifyMesh(m);
  assert.ok(Math.abs(meshVolume(m)-64*.6)<1e-8);
  const broken = { ...m, triangles: m.triangles.slice(3) };
  assert.throws(()=>verifyMesh(broken),/validation failed/);
});
test('both nozzle settings preserve backing/image layer counts and clipped color coverage', () => {
  for (const nozzle of [.2,.4]) for (const geometry of ['rectangular','voronoi'] as const) {
    const p=pattern({geometry,clearance:.23});
    const m=buildModel(raster,p,palette,2,nozzle,false);
    assert.equal(m.backing,2); assert.equal(m.layer,nozzle/2);
    for (const piece of m.pieces) {
      const base=piece.solids[0]; assert.equal(base.slot,2);
      assert.ok(Math.abs(Math.max(...base.mesh.vertices.filter((_,i)=>i%3===2))-7*m.layer)<1e-9);
      const a=Math.abs(area(p.pieces[piece.id].outline));
      assert.ok(Math.abs(piece.solids.slice(1).reduce((v,s)=>v+meshVolume(s.mesh),0)-a*3*m.layer)<.001);
      for (const s of piece.solids) {
        verifyMesh(s.mesh); const vs=positionedVertices(piece,s.mesh);
        for (let i=0;i<vs.length;i+=3) { assert.ok(vs[i]>=-1e-5 && vs[i]<=64+1e-5); assert.ok(vs[i+1]>=-1e-5 && vs[i+1]<=36+1e-5); }
      }
    }
  }
});
test('packed pieces retain cut tolerance plus 2mm, stay on plates and split when needed', () => {
  const m=buildModel(raster,pattern({width:256,height:144,count:4}),palette,0,.4,true,150);
  assert.ok(m.plates>1); assert.equal(m.spacing,2.2);
  for (const p of m.pieces) {
    assert.ok(p.x>=0 && p.y>=0 && p.x+p.bounds.width<=150+1e-5 && p.y+p.bounds.height<=150+1e-5);
    for (const q of m.pieces.filter(q=>q.id>p.id && q.plate===p.plate)) {
      const dx=Math.max(q.x-p.x-p.bounds.width,p.x-q.x-q.bounds.width,0);
      const dy=Math.max(q.y-p.y-p.bounds.height,p.y-q.y-q.bounds.height,0);
      assert.ok(Math.hypot(dx,dy)>=m.spacing-1e-5);
    }
  }
  const fake: ModelPiece={id:0,solids:[],bounds:{x:0,y:0,width:300,height:20},x:0,y:0,plate:0};
  assert.throws(()=>packPieces([fake],256,2,true,144),/exceeds/);
});
test('3MF archive contains closed meshes, multipart piece assemblies and four AMS mappings', () => {
  const m=buildModel(raster,pattern(),palette,3,.4,true);
  const files=unzipSync(exportPlate(m,0));
  const xml=strFromU8(files['3D/3dmodel.model']), config=strFromU8(files['Metadata/model_settings.config']);
  assert.match(xml,/unit="millimeter"/);
  assert.equal((xml.match(/<base /g)||[]).length,4);
  assert.equal((xml.match(/<item /g)||[]).length,m.pieces.length);
  let checkedMeshes = 0;
  for (const object of xml.matchAll(/<object[^>]*><mesh><vertices>(.*?)<\/vertices><triangles>(.*?)<\/triangles><\/mesh><\/object>/g)) {
    const vertices=[...object[1].matchAll(/x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].flatMap(v=>v.slice(1).map(Number));
    const triangles=[...object[2].matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].flatMap(v=>v.slice(1).map(Number));
    verifyMesh({vertices,triangles}); checkedMeshes++;
  }
  assert.equal(checkedMeshes,m.pieces.reduce((n,p)=>n+p.solids.length,0));
  assert.match(config,/key="extruder" value="4"/);
  const settings=JSON.parse(strFromU8(files['Metadata/project_settings.config']));
  assert.equal(settings.layer_height,'0.2'); assert.equal(settings.initial_layer_print_height,'0.2');
  const manifest=JSON.parse(strFromU8(files['Metadata/puzzle.json']));
  assert.equal(manifest.backingSlot,4); assert.equal(manifest.backingLayers,7); assert.equal(manifest.imageLayers,3);
  const multiple=buildModel(raster,pattern({width:256,height:144,count:4}),palette,0,.4,true,150);
  const download=exportModel(multiple); assert.match(download.filename,/\.zip$/);
  assert.equal(Object.keys(unzipSync(download.bytes)).filter(p=>p.endsWith('.3mf')).length,multiple.plates);
});
test('noisy raster and narrow Voronoi cuts retain watertight solids', () => {
  const labels=Uint8Array.from({length:32*18},(_,i)=>(Math.imul(i+11,1664525)>>>8)%4);
  const m=buildModel({width:32,height:18,labels},pattern({geometry:'voronoi',count:9,jitter:.6}),palette,0,.4,true);
  assert.equal(m.pieces.length,9);
});


test('photo-like raster with touching islands keeps full coverage at production detail', () => {
  const width=320,height=180,data=new Uint8ClampedArray(width*height*4);
  let random=17;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=(y*width+x)*4; random=Math.imul(random,1664525)+1013904223|0;
    const noise=(random>>>24)/4;
    data[i]=x/width*220+noise;data[i+1]=y/height*220+noise;data[i+2]=(Math.sin(x/20)*.5+.5)*200+noise;data[i+3]=255;
  }
  const colors=detectPalette(data);
  const m=buildModel(mapRaster(data,width,height,colors),pattern({width:256,height:144,count:25}),colors,1,.4,true);
  assert.equal(m.pieces.length,25);
  assert.ok(m.pieces.reduce((n,p)=>n+p.solids.reduce((n,s)=>n+s.mesh.triangles.length,0),0)>100000);
});


test('OBJ ZIP preserves millimeters, piece groups, valid face indices and four MTL colors', () => {
  const model=buildModel(raster,pattern(),palette,3,.4,true);
  const files=unzipSync(exportObj(model).bytes);
  const obj=strFromU8(files['image-puzzle-plate-1.obj']),mtl=strFromU8(files['image-puzzle-plate-1.mtl']);
  assert.match(obj,/coordinates in millimeters/);assert.match(obj,/mtllib image-puzzle-plate-1.mtl/);
  assert.equal((obj.match(/^o Piece_/gm)||[]).length,model.pieces.length);
  assert.equal((mtl.match(/^newmtl /gm)||[]).length,4);
  const vertices=(obj.match(/^v /gm)||[]).length;
  for(const face of obj.matchAll(/^f (\d+) (\d+) (\d+)$/gm)) for(const n of face.slice(1).map(Number)) assert.ok(n>0&&n<=vertices);
  assert.match(obj,/usemtl AMS_4/);
});
