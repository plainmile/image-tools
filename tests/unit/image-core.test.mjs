import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDimensions, aspectDimension, fitLockedAspectDimensions, drawRect, validateFile, inputImageFormat, sanitizeStem, kbLimitToBytes,
  exportFilename, formatBytes, MAX_FILE_BYTES, MAX_FILES, MAX_BATCH_BYTES, BYTES_PER_KB, BYTES_PER_MB, jpegBytesWithDpi, fitWithin, MAX_BATCH_OUTPUT_PIXELS, validateBatchPixels, addBatchOutputBytes, mergeSelectedImages, MAX_BATCH_OUTPUT_BYTES, isAnimatedImage, encodeWithTarget
} from '../../src/lib/image-core.mjs';

test('dimensions: exact positive integers and resource limits', () => {
  assert.deepEqual(assertDimensions(600, 400), { width: 600, height: 400 });
  assert.throws(() => assertDimensions(0, 600), /Width/);
  assert.throws(() => assertDimensions(600.1, 600), /Width/);
  assert.throws(() => assertDimensions(9000, 9000), /32-megapixel/);
});
test('aspect dimensions stay proportional', () => {
  assert.equal(aspectDimension(1200, 800, 600, 'width'), 400);
  assert.equal(aspectDimension(1200, 800, 200, 'height'), 300);
});
test('locked exact sizes limit both axes together rather than silently distorting tall images',()=>{
  assert.deepEqual(fitLockedAspectDimensions(100,2000,800,'width'),
    {width:500,height:10000,limited:true});
  assert.deepEqual(fitLockedAspectDimensions(100,2000,10,'width'),
    {width:10,height:200,limited:false});
  assert.deepEqual(fitLockedAspectDimensions(100,2000,10000,'height'),
    {width:500,height:10000,limited:false});
  assert.deepEqual(fitLockedAspectDimensions(1200,800,200,'height'),
    {width:300,height:200,limited:false});
  // 8,000 by 8,000 is 64 MP, despite each axis being below 10,000.
  assert.deepEqual(fitLockedAspectDimensions(200,200,8000,'width'),
    {width:5656,height:5656,limited:true});
  assert.throws(()=>aspectDimension(100,2000,800,'width'),/Height/);
  assert.throws(()=>fitLockedAspectDimensions(100,2000,0,'width'),/Width/);
  assert.throws(()=>fitLockedAspectDimensions(100,2000,10,'depth'),/Invalid dimension/);
});
test('contain mode never crops the original image', () => {
  const d = drawRect(1200, 600, 600, 600, 'contain');
  assert.deepEqual(d, { sx: 0, sy: 0, sw: 1200, sh: 600, dx: 0, dy: 150, dw: 600, dh: 300 });
});
test('within mode fills the integer output canvas without letterboxing', () => {
  const d=drawRect(1920,1080,801,451,'within');
  assert.deepEqual(d,{sx:0,sy:0,sw:1920,sh:1080,dx:0,dy:0,dw:801,dh:451});
});
test('cover mode crops symmetrically and allows pan', () => {
  const d = drawRect(1200, 600, 600, 600, 'cover');
  assert.equal(d.sx, 300);
  assert.equal(d.sw, 600);
  assert.equal(drawRect(1200, 600, 600, 600, 'cover', 1, 1).sx, 600);
  assert.equal(drawRect(1200, 600, 600, 600, 'cover', 1, -1).sx, 0);
});
test('reject unsupported images and huge inputs', () => {
  assert.throws(() => validateFile({ name: 'bad.svg', size: 2, type: 'image/svg+xml' }), /Supported/);
  assert.throws(() => validateFile({ name: 'bad.png', size: 0, type: 'image/png' }), /empty/);
  assert.throws(() => validateFile({ name: 'bad.png', size: 50_000_000, type: 'image/png' }), /40 MB/);
  assert.equal(MAX_FILES, 30);
});
test('safe exported names and accurate file size', () => {
  assert.equal(sanitizeStem('../../a:bad?.png'), '..-..-a-bad-');
  assert.equal(exportFilename('scan.webp', 'jpeg'), 'scan-edited.jpg');
  assert.equal(BYTES_PER_KB,1000);
  assert.equal(BYTES_PER_MB,1000000);
  assert.equal(formatBytes(999),'999 B');
  assert.equal(formatBytes(1000),'1.0 KB');
  assert.equal(formatBytes(1024),'1.0 KB');
  assert.equal(formatBytes(100000),'100.0 KB');
  assert.equal(formatBytes(99500),'99.5 KB');
  assert.equal(formatBytes(999999),'1000.0 KB');
  assert.equal(formatBytes(1000000),'1.00 MB');
  assert.equal(formatBytes(1048576),'1.05 MB');
});

test('KB upload limit is decimal bytes so 100 KB passes both 100,000-byte and 100-KiB portals', () => {
  assert.equal(kbLimitToBytes(0), 0);
  assert.equal(kbLimitToBytes(undefined), 0);
  assert.equal(kbLimitToBytes(1), 1000);
  assert.equal(kbLimitToBytes(1.5), 1500);
  assert.equal(kbLimitToBytes('100'), 100000);
  assert.equal(kbLimitToBytes(20_000), 20_000_000);
  assert.throws(()=>kbLimitToBytes(-1), /Target size/);
  assert.throws(()=>kbLimitToBytes(20_001), /Target size/);
  assert.throws(()=>kbLimitToBytes(Infinity), /Target size/);
});

test('browser batch memory limit is explicit', async () => {
  assert.equal(MAX_FILE_BYTES, 40_000_000);
  assert.equal(MAX_BATCH_BYTES, 160_000_000);
  assert.doesNotThrow(()=>validateFile({name:'exact.png',size:40_000_000,type:'image/png'}));
  assert.throws(()=>validateFile({name:'oversize.png',size:40_000_001,type:'image/png'}),/40 MB/);
  const same=(name,size)=>({file:{name,type:'image/png',size,lastModified:12}});
  assert.equal((await mergeSelectedImages([same('a.png',80_000_000)],[same('b.png',80_000_000)])).items.length,2);
  await assert.rejects(()=>mergeSelectedImages([same('a.png',80_000_000)],[same('b.png',80_000_001)]),/160 MB/);
});
test('JPEG density is patched to 300 dpi for existing JFIF', () => {
  const jpeg = Uint8Array.from([
    0xff,0xd8,0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0,
    0xff,0xd9
  ]);
  const result=jpegBytesWithDpi(jpeg,300);
  assert.equal(result.length,jpeg.length);
  assert.equal(result[13],1);
  assert.deepEqual(Array.from(result.slice(14,18)),[1,44,1,44]);
});
test('JPEG density is inserted if the browser omitted the JFIF header', () => {
  const jpeg=Uint8Array.from([0xff,0xd8,0xff,0xda,0,2,0xff,0xd9]);
  const result=jpegBytesWithDpi(jpeg,300);
  assert.equal(result.length,jpeg.length+18);
  assert.deepEqual(Array.from(result.slice(2,6)),[0xff,0xe0,0,16]);
  assert.deepEqual(Array.from(result.slice(14,18)),[1,44,1,44]);
  assert.throws(()=>jpegBytesWithDpi(new Uint8Array([1,2,3])),/Invalid JPEG/);
});

test('fit within bounding box preserves aspect ratio and does not upscale small images', () => {
  assert.deepEqual(fitWithin(120,80,55,35),{width:53,height:35});
  assert.deepEqual(fitWithin(120,80,800,800),{width:120,height:80});
  assert.deepEqual(fitWithin(800,1200,800,800),{width:533,height:800});
  assert.deepEqual(fitWithin(1920,1080,800,800),{width:800,height:450});
  assert.deepEqual(fitWithin(1080,1920,800,800),{width:450,height:800});
  assert.deepEqual(fitWithin(10000,10000,10000,10000),{width:5656,height:5656});
  assert.throws(()=>fitWithin(100,100,0,100),/Width/);
});

test('batch resource budget blocks multi-image megapixel explosions',()=>{
  assert.equal(MAX_BATCH_OUTPUT_PIXELS,120_000_000);
  assert.equal(validateBatchPixels([{width:120,height:80},{width:120,height:80}],55,35,'within'),3710);
  assert.throws(()=>validateBatchPixels(Array.from({length:5},()=>({width:120,height:80})),8000,4000,'contain'),/120-megapixel/);
});

test('original format is determined from MIME or safe extension fallback', () => {
  assert.equal(inputImageFormat({name:'transparency.png',type:'image/png'}),'png');
  assert.equal(inputImageFormat({name:'photo.jpg',type:'image/jpeg'}),'jpeg');
  assert.equal(inputImageFormat({name:'sample.webp',type:'image/webp'}),'webp');
  assert.equal(inputImageFormat({name:'photo.jpeg',type:''}),'jpeg');
  assert.equal(inputImageFormat({name:'photo.png',type:'application/octet-stream'}),'png');
  assert.throws(()=>inputImageFormat({name:'pretend.png',type:'image/svg+xml'}),/Supported images/);
  assert.throws(()=>validateFile({name:'animated.gif',type:'image/gif',size:128}),/Supported images/);
});

test('ZIP output budget protects the browser from unbounded in-memory archives', () => {
  assert.equal(MAX_BATCH_OUTPUT_BYTES, 128_000_000);
  assert.equal(addBatchOutputBytes(20, 50), 70);
  assert.equal(addBatchOutputBytes(MAX_BATCH_OUTPUT_BYTES - 7, 7), MAX_BATCH_OUTPUT_BYTES);
  assert.throws(() => addBatchOutputBytes(MAX_BATCH_OUTPUT_BYTES - 7, 8), /128 MB/);
  assert.throws(() => addBatchOutputBytes(-1, 1), /Invalid exported byte/);
  assert.throws(() => addBatchOutputBytes(0, Number.NaN), /Invalid exported byte/);
});

test('animated APNG is detected before the first IDAT chunk, still PNG is accepted', async () => {
  const sig=Uint8Array.from([137,80,78,71,13,10,26,10]);
  const chunk=(type,payload=[])=>Uint8Array.from([
    0,0,0,payload.length,...[...type].map(c=>c.charCodeAt(0)),...payload,0,0,0,0
  ]);
  const asFile=(bytes,name='example.png',type='image/png')=>{
    const blob=new Blob([bytes]);return {name,type,size:blob.size,slice:(...args)=>blob.slice(...args)};
  };
  const idat=chunk('IDAT');
  const still=asFile(new Uint8Array([...sig,...chunk('IHDR',Array(13).fill(0)),...idat]));
  const animated=asFile(new Uint8Array([...sig,...chunk('IHDR',Array(13).fill(0)),...chunk('acTL',Array(8).fill(0)),...idat]));
  assert.equal(await isAnimatedImage(still),false);
  assert.equal(await isAnimatedImage(animated),true);
});

test('WebP VP8X animation flag is recognized; ordinary still WebP is accepted', async () => {
  const fakeWebp=(flag)=>{
    const bytes=Uint8Array.from([
      82,73,70,70,28,0,0,0,87,69,66,80,86,80,56,88,10,0,0,0,flag
    ]);
    const blob=new Blob([bytes]);
    return {name:'test.webp',type:'image/webp',size:blob.size,slice:(...args)=>blob.slice(...args)};
  };
  assert.equal(await isAnimatedImage(fakeWebp(0)),false);
  assert.equal(await isAnimatedImage(fakeWebp(2)),true);
  assert.equal(await isAnimatedImage(fakeWebp(0x12)),true);
});

test('mislabeled GIF, JPEG, PNG and WebP inputs cannot bypass format or animation checks',async()=>{
  const file=(bytes,name,type)=>{
    const blob=new Blob([Uint8Array.from(bytes)]);
    return {name,type,size:blob.size,slice:(...args)=>blob.slice(...args)};
  };
  const jpeg=[0xff,0xd8,0xff,0xe0,0,16];
  const png=[137,80,78,71,13,10,26,10,0,0,0,0];
  const webp=[82,73,70,70,28,0,0,0,87,69,66,80,86,80,56,32];
  const gif=[71,73,70,56,57,97,1,0,1,0,0,0];
  assert.equal(await isAnimatedImage(file(jpeg,'real.jpg','image/jpeg')),false);
  assert.equal(await isAnimatedImage(file(webp,'real.webp','image/webp')),false);
  await assert.rejects(isAnimatedImage(file(gif,'renamed.png','image/png')),/Image contents do not match/);
  await assert.rejects(isAnimatedImage(file(jpeg,'renamed.png','image/png')),/Image contents do not match/);
  await assert.rejects(isAnimatedImage(file(png,'renamed.jpg','image/jpeg')),/Image contents do not match/);
  await assert.rejects(isAnimatedImage(file(png,'renamed.webp','image/webp')),/Image contents do not match/);
  await assert.rejects(isAnimatedImage(file([0,1,2],'empty.jpg','image/jpeg')),/Image contents do not match/);
});

test('KB encoding checks minimum JPEG/WebP quality instead of reporting an impossible limit',async()=>{
  // Only exactly quality=0.05 can produce 350 bytes: all 11 intermediate
  // binary-search points produce 351+ bytes.
  const canvas={toBlob:(callback,mime,quality)=>
    callback(new Blob([new Uint8Array(Math.ceil(300 + Number(quality||0)*1000))],{type:mime}))};
  for(const format of ['jpeg','webp']){
    const result=await encodeWithTarget(canvas,format,350,0.9);
    assert.equal(result.blob.size,350);
    assert.equal(result.quality,0.05);
    assert.equal(await encodeWithTarget(canvas,format,349,0.9),null);
    const normal=await encodeWithTarget(canvas,format,1300,0.9);
    assert.equal(normal.quality,0.9);
  }
});

test('batch selection appends new images while skipping repeated File objects',async()=>{
  const file=(name,size=200,lastModified=10)=>({name,size,lastModified,type:'image/png'});
  const first={file:file('one.png')};
  const b={file:file('two.png')};
  const c={file:file('one.png',200,11)};
  const original=[first];
  const merged=await mergeSelectedImages(original,[first,b,b,c]);
  assert.equal(merged.added,2);
  assert.equal(merged.duplicates,2);
  assert.deepEqual(merged.items,[first,b,c]);
  assert.deepEqual(original,[first], 'old selection is not mutated');
  const repeated=await mergeSelectedImages(merged.items,[first,b]);
  assert.equal(repeated.added,0);
  assert.equal(repeated.duplicates,2);
  assert.deepEqual(repeated.items,merged.items);
});

test('combined batch limits are checked before changing the selected items',async()=>{
  const file=(name,size)=>({file:{name,type:'image/png',size,lastModified:1}});
  const old=[file('existing.png',1000)];
  const overCount=Array.from({length:30},(_,i)=>file('extra-'+i+'.png',20));
  await assert.rejects(()=>mergeSelectedImages(old,overCount),/Maximum 30/);
  const large=[file('already.png',MAX_BATCH_BYTES-500)];
  await assert.rejects(()=>mergeSelectedImages(large,[file('new.png',501)]),/160 MB/);
  assert.equal(old.length,1);
  assert.equal((await mergeSelectedImages(old,[file('extra.png',20)])).items.length,2);
});

test('metadata-colliding but different image bytes must both survive batch selection',async()=>{
  const bytes=new Uint8Array(150_000).fill(1);
  const make=(content)=>({file:new File([content],'same-name.png',{
    type:'image/png',lastModified:1710000000000
  })});
  const first=make(bytes);
  const identical=make(bytes);
  const changed=new Uint8Array(bytes);
  // Different only in the final chunk. Checking a short prefix is unsafe.
  changed[changed.length-1]=2;
  const different=make(changed);
  const selected=await mergeSelectedImages([first],[identical,different]);
  assert.equal(selected.duplicates,1);
  assert.equal(selected.added,1);
  assert.equal(selected.items.length,2);
  assert.equal(selected.items[0],first);
  assert.equal(selected.items[1],different);
  assert.equal((await mergeSelectedImages(selected.items,[make(changed)])).added,0);
});

test('unverifiable metadata collisions are not silently treated as duplicates',async()=>{
  const a={file:{name:'image.png',size:5,type:'image/png',lastModified:123}};
  const b={file:{name:'image.png',size:5,type:'image/png',lastModified:123}};
  const result=await mergeSelectedImages([a],[b]);
  assert.equal(result.added,1);
  assert.equal(result.duplicates,0);
  assert.deepEqual(result.items,[a,b]);
});

test('unrelated file metadata never triggers a content read',async()=>{
  const make=(name)=>({file:{name,size:2,type:'image/png',lastModified:123,
    slice:()=>{throw new Error('unexpected file read');}
  }});
  const result=await mergeSelectedImages([make('a.png')],[make('b.png')]);
  assert.equal(result.added,1);
});
