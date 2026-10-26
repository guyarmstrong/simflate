// Dev-only speed check: open the app with ?bench and it times the solver in a
// worker, then reports to runs/bench.log through the dev server.
export async function runBench() {
  const code = `onmessage=async(e)=>{const {instance}=await WebAssembly.instantiate(e.data,{});const x=instance.exports;
    const sq=[[-150,-150],[150,-150],[150,150],[-150,150]];
    const req=new TextEncoder().encode(JSON.stringify({pieces:[{outer:sq}],settings:{pressure:55,character:0.5}}));
    const p=x.bs_alloc(req.length);new Uint8Array(x.memory.buffer,p,req.length).set(req);x.bs_create(p,req.length);
    for(let i=0;i<3;i++)x.bs_step();
    const t=performance.now();for(let i=0;i<10;i++)x.bs_step();postMessage((performance.now()-t)/10);}`;
  const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  const buf = await (await fetch('/blown_wasm.wasm')).arrayBuffer();
  const ms = await new Promise<number>((r) => {
    w.onmessage = (e) => r(e.data);
    w.postMessage(buf);
  });
  w.terminate();
  const line = `bench ${navigator.userAgent.match(/(Edg|Chrome|Firefox)\/[\d.]+/)?.[0] ?? 'webview'} solver ${ms.toFixed(1)} ms/frame`;
  await fetch('/api/log', { method: 'POST', body: line });
  document.title = line;
}
