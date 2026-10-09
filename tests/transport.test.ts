import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../src/services/transport';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

test('native AbortSignal without timeout sends readiness and the write, and releases both timers', async () => {
  const native = createRequire(import.meta.url)('abort-controller');
  assert.equal(typeof native.AbortSignal.timeout, 'undefined');
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const exports: { createTransport?: typeof createTransport } = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/services/transport.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, AbortController: native.AbortController, AbortSignal: native.AbortSignal,
    setTimeout(callback: () => void, delay: number) { const timer = setTimeout(callback, delay); pending.add(timer); return timer; },
    clearTimeout(timer: ReturnType<typeof setTimeout>) { pending.delete(timer); clearTimeout(timer); },
  });
  const calls: string[] = [];
  const request = exports.createTransport!('https://test.example', { fetcher: (async (url, init) => {
    calls.push(String(url));
    assert.ok(init?.signal instanceof native.AbortSignal);
    return Response.json(String(url).endsWith('/health') ? { status: 'ok' } : { saved: true });
  }) as typeof fetch });
  assert.deepEqual(await request('/report', { method: 'POST' }), { saved: true });
  assert.deepEqual(calls, ['https://test.example/health', 'https://test.example/report']);
  assert.equal(pending.size, 0);
});

test('concurrent calls wait for one cold-start probe and send each write once', async () => {
  let now = 0;
  const calls: string[] = [];
  let probes = 0;
  const fetcher = (async (url: string | URL | Request) => {
    const path = String(url);
    calls.push(path);
    if (path.endsWith('/health')) {
      probes++;
      return probes === 1 ? new Response('starting', {status:503}) : Response.json({status:'ok'});
    }
    return Response.json({saved:true});
  }) as typeof fetch;
  const request = createTransport('https://test.example', {fetcher, clock:()=>now, pause:async ms=>{now+=ms;}});
  const results = await Promise.all([request('/report', {method:'POST'}), request('/price', {method:'POST'})]);
  assert.deepEqual(results, [{saved:true},{saved:true}]);
  assert.equal(probes,2);
  assert.equal(calls.filter(p=>p.endsWith('/report')).length,1);
  assert.equal(calls.filter(p=>p.endsWith('/price')).length,1);
});

test('native body reads that ignore abort still time out, release timers and never replay a write', async () => {
  const native = createRequire(import.meta.url)('abort-controller');
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const exports: { createTransport?: typeof createTransport } = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/services/transport.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, AbortController: native.AbortController,
    setTimeout(callback: () => void) { const timer = setTimeout(callback, 5); pending.add(timer); return timer; },
    clearTimeout(timer: ReturnType<typeof setTimeout>) { pending.delete(timer); clearTimeout(timer); },
  });
  let writes = 0, probes = 0;
  let writeSignal: AbortSignal | undefined;
  const request = exports.createTransport!('https://test.example', { fetcher: (async (url, init) => {
    if (String(url).endsWith('/health')) { probes++; return Response.json({ status: 'ok' }); }
    writes++; writeSignal = init?.signal ?? undefined;
    return { ok: true, json: () => new Promise(() => {}) } as Response;
  }) as typeof fetch });
  await assert.rejects(request('/report', { method: 'POST' }), /check whether your change was saved/);
  assert.equal(writeSignal?.aborted, true);
  assert.equal(writes, 1);
  assert.equal(pending.size, 0);
  await assert.rejects(request('/catalog'), /Connection interrupted/);
  assert.equal(probes, 2);
  assert.equal(pending.size, 0);
});

test('an interrupted write is never automatically replayed', async () => {
  let writes = 0;
  const fetcher = (async (url: string | URL | Request) => {
    if(String(url).endsWith('/health')) return Response.json({status:'ok'});
    writes++;
    throw new Error('socket closed after commit');
  }) as typeof fetch;
  const request = createTransport('https://test.example', {fetcher});
  await assert.rejects(request('/report', {method:'POST'}), /check whether your change was saved/);
  assert.equal(writes,1);
});

test('unavailable database fails within the warm-up budget without sending a write', async () => {
  let now = 0;
  const fetcher = (async (url: string | URL | Request) => {
    assert.ok(String(url).endsWith('/health'));
    return Response.json({status:'unavailable'}, {status:503});
  }) as typeof fetch;
  const request = createTransport('https://test.example', {fetcher, clock:()=>now, pause:async ms=>{now+=ms;}});
  await assert.rejects(request('/report', {method:'POST'}), /Could not connect/);
  assert.equal(now,75000);
});

test('a throttled readiness probe stops retrying and respects its cooldown', async () => {
  let now=0, calls=0;
  const request=createTransport('https://test.example',{clock:()=>now,fetcher:(async()=>{
    calls++;
    return calls===1 ? Response.json({error:'limited'},{status:429,headers:{'Retry-After':'45'}}) : Response.json({status:'ok'});
  }) as typeof fetch,pause:async()=>{throw new Error('must not retry throttled probe');}});
  await assert.rejects(request('/report',{method:'POST'}),/Too many requests/);
  await assert.rejects(request('/report',{method:'POST'}),/Too many requests/);
  assert.equal(calls,1);
  now=45001;
  await request('/catalog');
  assert.equal(calls,3);
});

test('authenticated requests do not follow redirects or attach browser cookies',async()=>{
  const request=createTransport('https://test.example',{fetcher:(async(url: string | URL | Request, init?: RequestInit)=>{
    assert.equal(init?.credentials,'omit'); assert.equal(init?.redirect,'error');
    return Response.json(String(url).endsWith('/health')?{status:'ok'}:{saved:true});
  }) as typeof fetch});
  await request('/report',{method:'POST',headers:{Authorization:'Bearer test-only-token'}});
});

test('no network gives up after a few probes instead of the 75-second wake-up budget', async () => {
  let now = 0, probes = 0;
  const fetcher = (async () => { probes++; throw new TypeError('Failed to fetch'); }) as typeof fetch;
  const request = createTransport('https://test.example', {fetcher, clock:()=>now, pause:async ms=>{now+=ms;}});
  await assert.rejects(request('/report', {method:'POST'}), /Could not connect/);
  assert.equal(probes, 3);
  assert.ok(now <= 6000);
});
