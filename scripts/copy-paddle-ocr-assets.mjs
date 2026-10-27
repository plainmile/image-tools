import {mkdir,readdir,copyFile,stat,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';

const out='public/ocr/paddle';
await mkdir(join(out,'wasm'),{recursive:true});
const dist='node_modules/onnxruntime-web/dist';
// ORT dynamically imports a .mjs loader alongside its .wasm binary.
// Copying only .wasm produces a 404 for ort-wasm-simd-threaded.jsep.mjs.
const runtime=(await readdir(dist)).filter(n=>/^ort-wasm.*\.(?:wasm|mjs)$/.test(n));
for(const name of ['ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm',
                   'ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']) {
  if(!runtime.includes(name))throw Error('ONNX Runtime asset missing: '+name);
}
for(const name of runtime)await copyFile(join(dist,name),join(out,'wasm',name));
const models=[
  ['det','PP-OCRv5_mobile_det'],
  ['rec','PP-OCRv5_mobile_rec'],
];
for(const [kind,name] of models){
  const target=join(out,kind+'.tar');
  const remote='https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/'+name+'_onnx_infer.tar';
  let valid=false;
  try{valid=(await stat(target)).size>1_000_000;}catch{}
  if(!valid){
    const temp=target+'.part';
    const response=await fetch(remote,{signal:AbortSignal.timeout(240000)});
    if(!response.ok||!response.body)throw Error('Failed model '+kind+': HTTP '+response.status);
    try{
      await pipeline(Readable.fromWeb(response.body),createWriteStream(temp));
      if((await stat(temp)).size<1_000_000)throw Error('Downloaded model is incomplete: '+kind);
      await rename(temp,target);
    }finally{await rm(temp,{force:true});}
  }
  // A successful HTTP download is not enough: browser-side PaddleOCR.js
  // requires an uncompressed tar with matching model metadata and ONNX.
  const entries=execFileSync('tar',['-tf',target],{encoding:'utf8'}).trim().split('\n');
  const onnx=entries.find(p=>p==='inference.onnx'||p.endsWith('/inference.onnx'));
  const yml=entries.find(p=>p==='inference.yml'||p.endsWith('/inference.yml'));
  if(!onnx||!yml)throw Error('Invalid '+kind+' model tar: missing inference.onnx or inference.yml');
  const yaml=execFileSync('tar',['-xOf',target,yml],{encoding:'utf8'});
  if(!yaml.includes('model_name: '+name)){
    throw Error('Invalid '+kind+' model metadata: model_name does not match '+name);
  }
}
console.log('Paddle OCR benchmark assets ready: ONNX models and matching local WASM/MJS loaders.');
