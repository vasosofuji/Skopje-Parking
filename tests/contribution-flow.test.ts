import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { ParkingStore } from "../server/store";
import { PostgresParkingStore } from "../server/postgres/store";
import { postgresSql, type StoreDatabase } from "../server/postgres/database";
import { buildApp } from "../server/app";
import { nearestAvailableParking, REPORT_TTL_MS, parkingPrice, confirmedSignCatalog } from "../src/domain/parking";
import { TERMS_VERSION } from "../src/domain/account";
import type { Catalog, Contribution, ParkingPlace, SignInfo } from "../src/domain/types";

const catalog: Catalog = { generatedAt:new Date().toISOString(),places:[],zones:[],destinations:[],coverage:{complete:false,bounds:[],notes:[]} };
const point = {latitude:41.9965,longitude:21.4325};
const contribution: Contribution = {requestId:"flow-fixture-1",name:"Fixture parking",coordinate:point,kind:"surface",zoneCode:null,firstHour:null,nextHour:null};
const geometry = {type:"Polygon" as const,coordinates:[[[21.432,41.996],[21.433,41.996],[21.433,41.997],[21.432,41.997],[21.432,41.996]]]};
const image = {mimeType:"image/png",base64:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGqkAAAAASUVORK5CYII="};
const info: SignInfo = {isParkingSign:true,confidence:1,zoneCode:"B2",operator:"Test",currency:"MKD",firstHour:40,nextHour:40,maxStayMinutes:null,chargingHours:"07:00-23:00",paymentInstructions:null,restrictions:null,rawText:"Б2 · 40 денари / час"};

for (const backend of ["sqlite","postgres"] as const) test(`${backend}: detailed parking, expiring counts, confirmed zone signs and idempotent rewards`, async (t) => {
  let now=Date.now();
  t.mock.method(Date,"now",()=>now);
  let store: ParkingStore | PostgresParkingStore;
  if (backend === "sqlite") store=new ParkingStore(":memory:",catalog,()=>now,true);
  else {
    const pg=await PGlite.create({parsers:{20:Number}});
    for (const file of readdirSync("supabase/migrations").filter(f=>f.endsWith(".sql")).sort()) await pg.exec(readFileSync(`supabase/migrations/${file}`,"utf8"));
    const local=new AsyncLocalStorage<Transaction>();
    const db:StoreDatabase={
      prepare(sql){const query=(values:unknown[])=>(local.getStore()??pg).query(postgresSql(sql),values);return {run:(...v)=>query(v),get:async(...v)=>(await query(v)).rows[0],all:async(...v)=>(await query(v)).rows};},
      transaction:work=>local.getStore()?work():pg.transaction(tx=>local.run(tx,work)),close:()=>pg.close(),
    };
    store=new PostgresParkingStore(db,()=>now,true);
    await store.seed(catalog);
  }
  const app=await buildApp(catalog,store,{requireOnboarding:true});
  try {
    const token=(await store.createSession()).token;
    const headers={authorization:`Bearer ${token}`};
    const write=async(url:string,payload:unknown,method:"POST"|"PUT"="POST")=>app.inject({method,url,headers,payload:payload as object});
    assert.equal((await write("/v1/profile",{username:"flowuser",password:"contribution test password",accepted:true,termsVersion:TERMS_VERSION})).statusCode,200);
    const quick=await write("/v1/contributions",contribution);
    assert.equal(quick.statusCode,201,quick.body);
    const id=quick.json().id;
    assert.equal((await app.inject({url:"/v1/profile",headers})).json().points,10);
    // A forged retry must not earn bonuses for details that were never stored.
    await write("/v1/contributions",{...contribution,geometry,capacity:50,firstHour:40,nextHour:40,freeSpaces:3});
    assert.equal((await app.inject({url:"/v1/profile",headers})).json().points,10);
    const detailed=await write("/v1/contributions",{...contribution,requestId:"detailed-fixture",geometry,capacity:50,freeSpaces:3,firstHour:0,nextHour:0});
    assert.equal(detailed.statusCode,201,detailed.body);
    const detailId=detailed.json().id;
    const schedule = { chargingHours: "Mon-Sat 07:00-23:00", freeWeekends: "sunday" };
    assert.equal((await write(`/v1/places/${detailId}/payment-schedule`,schedule,"PUT")).statusCode,200);
    assert.equal((await write(`/v1/places/${detailId}/payment-schedule`,{...schedule,freeWeekends:"always"},"PUT")).statusCode,400);
    assert.equal((await app.inject({method:"PUT",url:`/v1/places/${detailId}/payment-schedule`,payload:schedule})).statusCode,401);
    let places=(await app.inject("/v1/catalog")).json().places as ParkingPlace[];
    const detail=places.find(p=>p.id===detailId)!;
    assert.deepEqual(detail.paymentSchedule,schedule);
    assert.equal(detail.kind,"surface");assert.equal(detail.capacity,50);assert.equal(detail.availability?.freeSpaces,3);
    assert.equal((await app.inject({url:"/v1/profile",headers})).json().points,63);
    await write(`/v1/places/${id}/capacity`,{capacity:12},"PUT");
    assert.equal((await write(`/v1/places/${id}/reports`,{status:"spaces",freeSpaces:13})).statusCode,400);
    assert.equal((await write(`/v1/places/${id}/reports`,{status:"spaces",freeSpaces:0})).statusCode,400);
    assert.equal((await write(`/v1/places/${id}/reports`,{status:"full",freeSpaces:1})).statusCode,400);
    await write(`/v1/places/${id}/reports`,{status:"spaces",freeSpaces:4});
    assert.equal((await store.availability(id)).freeSpaces,4);
    await write(`/v1/places/${id}/capacity`,{capacity:2},"PUT");
    assert.equal((await app.inject("/v1/catalog")).json().places.find((p:ParkingPlace)=>p.id===id).availability.freeSpaces,undefined,"a corrected capacity invalidates an impossible older count");
    await write(`/v1/places/${id}/reports`,{status:"spaces"});
    assert.equal((await store.availability(id)).freeSpaces,undefined,"an unknown count clears an older exact count");
    await write(`/v1/places/${id}/reports`,{status:"full"});
    assert.equal((await store.availability(id)).freeSpaces,0);
    places=(await app.inject("/v1/catalog")).json().places;
    assert.equal(nearestAvailableParking(places,places.find(p=>p.id===id)!,1500,now)[0].place.id,detailId);
    now+=REPORT_TTL_MS;
    assert.equal((await store.availability(detailId)).status,"unknown");
    assert.equal(nearestAvailableParking(places,places.find(p=>p.id===id)!,1500,now).length,0);

    const zone=await write("/v1/contributions",{...contribution,requestId:"zone-fixture",kind:"zone",geometry});
    assert.equal(zone.statusCode,201,zone.body);
    const sign=(payload:unknown,auth=headers)=>app.inject({method:"POST",url:`/v1/places/${zone.json().id}/signs`,headers:auth,payload:payload as Record<string,unknown>});
    assert.equal((await sign({info:{...info,zoneCode:null,firstHour:null,nextHour:null,chargingHours:null,rawText:""}})).statusCode,400,"empty signs do not earn rewards");
    assert.equal((await sign({info,model:"ocr:mlkit-text-v2",base64:image.base64})).statusCode,400,"photos are never accepted");
    const confirmed=await sign({info,model:"ocr:mlkit-text-v2"});
    assert.equal(confirmed.statusCode,201,confirmed.body);assert.ok(confirmed.json().id);
    const score=(await app.inject({url:"/v1/profile",headers})).json().points;
    await sign({info,model:"manual"});
    assert.equal((await app.inject({url:"/v1/profile",headers})).json().points,score,"one sign award per place");
    places=(await app.inject("/v1/catalog")).json().places;
    assert.equal(places.find(p=>p.id===id)?.signInfo?.sourcePlaceId,zone.json().id);
    assert.equal(parkingPrice(places.find(p=>p.id===id)!)?.firstHour,40);
    assert.equal(parkingPrice(places.find(p=>p.id===detailId)!)?.firstHour,0,"site-specific human price wins over zone sign");
    assert.equal((await sign({info:{...info,firstHour:-1}})).statusCode,400);
    const other=(await store.createSession()).token;
    await app.inject({method:"POST",url:"/v1/profile",headers:{authorization:`Bearer ${other}`},payload:{username:"otheruser",password:"contribution test password",accepted:true,termsVersion:TERMS_VERSION}});
    assert.equal((await sign({info},{authorization:`Bearer ${other}`})).statusCode,201,"any driver can add what a sign says");
    // Later contributions by another driver must never count as this creator's work.
    const retryToken=(await store.createSession()).token;
    const retryHeaders={authorization:`Bearer ${retryToken}`};
    await app.inject({method:"POST",url:"/v1/profile",headers:retryHeaders,payload:{username:"retryuser",password:"contribution test password",accepted:true,termsVersion:TERMS_VERSION}});
    const retryInput={...contribution,requestId:"cross-user-retry"};
    const retryWrite=()=>app.inject({method:"POST",url:"/v1/contributions",headers:retryHeaders,payload:retryInput});
    const retryPlace=(await retryWrite()).json().id;
    assert.equal((await write(`/v1/places/${retryPlace}/prices`,{firstHour:40,nextHour:40})).statusCode,200);
    assert.equal((await write(`/v1/places/${retryPlace}/reports`,{status:"spaces",freeSpaces:2})).statusCode,200);
    await retryWrite();
    assert.equal((await app.inject({url:"/v1/profile",headers:retryHeaders})).json().points,10);
    const scoreBeforeReplay=(await app.inject({url:"/v1/profile",headers})).json().points;
    now+=24*60*60*1000;
    await write("/v1/contributions",{...contribution,requestId:"detailed-fixture"});
    assert.equal((await app.inject({url:"/v1/profile",headers})).json().points,scoreBeforeReplay,"a next-day retry cannot earn another availability award");
  } finally {await app.close();}
});

test("upgraded cached catalogs never present old AI drafts as confirmed prices", () => {
  const place: ParkingPlace = {id:"legacy",name:"Legacy",coordinate:point,kind:"surface",operator:null,zoneCode:"B2",zoneCodeEvidence:"sign",access:"public",tariff:null,capacity:null,openingHours:null,verification:"community",source:{label:"",url:"",retrievedAt:""},signInfo:{...info,readingId:"old",model:"ai",observedAt:new Date().toISOString()}};
  assert.equal(parkingPrice(place),null);
  const restored=confirmedSignCatalog({...catalog,places:[place]}).places[0];
  assert.equal(restored.signInfo,undefined);assert.equal(restored.zoneCode,null);
});
