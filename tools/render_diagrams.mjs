// Documentation-only renderer. No application service or network call.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require=createRequire(import.meta.url);
const {Graphviz}=require('../.cache/diagram-renderer/node_modules/@hpcc-js/wasm-graphviz');
const g=await Graphviz.load();
const dir=resolve(import.meta.dirname,'../docs/diagrams');
for(const file of (await readdir(dir)).filter(x=>x.endsWith('.dot') && x!=='system-architecture.dot').sort()){
 const svg=await g.layout(await readFile(resolve(dir,file),'utf8'),'svg','dot');
 await writeFile(resolve(dir,file.replace(/\.dot$/,'.svg')),svg);
 console.log(file.replace(/\.dot$/,'.svg'),svg.length);
}
