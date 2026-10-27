import {mkdir,readdir,copyFile,stat,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';

const out='public/ocr/paddle';
await mkdir(join(out,'wasm'),{recursive:true});
const dist='node_modules/onnxruntime-web/dist';
const wasm=(await readdir(dist)).filter(n=>n.startsWith('ort-wasm')&&n.endsWith('.wasm'));
if(!wasm.length)throw Error('ORT wasm assets unavailable. Never use external CDN fallback.');
for(const name of wasm)await copyFile(join(dist,name),join(out,'wasm',name));
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
}
console.log('Paddle OCR benchmark assets ready (models hosted on same origin, no runtime CDN).');
