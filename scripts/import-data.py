"""Refresh public source snapshots; never infer sign codes from proximity.
Run with --refresh to fetch OSM/POC. Without it, rebuild from cached raw data.
"""
from pathlib import Path
import argparse, json, urllib.request, xml.etree.ElementTree as ET, re
from datetime import datetime, timezone
ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data' / 'raw'
RAW.mkdir(parents=True, exist_ok=True)
BOUNDS = [41.91,21.30,42.08,21.58]
POC = [('0','165','1j7-1iNXCr5mJ-tZGzkLLeVzsiHLxtKk',100),('1','167','1xnoRny4atJ93nFx2c_7bkcwnPG5hx28',70),('2','169','1uTRQcFS3Y_bFdEin9j7C55BR1zhiRNQ',60)]
args = argparse.ArgumentParser(); args.add_argument('--refresh',action='store_true'); args=args.parse_args()
def fetch(url,data=None):
    request=urllib.request.Request(url,data=data,headers={'User-Agent':'ParkSkopje-catalog/0.1 (local research)'})
    return urllib.request.urlopen(request,timeout=60).read()
if args.refresh:
    query='[out:json][timeout:45];nwr["amenity"="parking"](41.91,21.30,42.08,21.58);out center geom;'
    (RAW/'osm-parking.json').write_bytes(fetch('https://overpass-api.de/api/interpreter',query.encode()))
    for zone,page,mid,price in POC:
        (RAW/f'poc-zone-{zone}.kml').write_bytes(fetch('https://www.google.com/maps/d/kml?mid='+mid+'&forcekml=1'))
now=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def source(label,url,license=None):
    out={'label':label,'url':url,'retrievedAt':now}
    if license: out['license']=license
    return out
city_source=source('JP Gradski Parking published tariff','https://www.gradskiparking.com.mk/javni-parkiralishta-i-zonsko.nspx')
garage_source=source('JP Gradski Parking garage tariff','https://www.gradskiparking.com.mk/cenovnik-katna-garaza.nspx')
poc_source=source('POC published price list','https://poc.mk/')
def tariff(first,next=None,limit=None,src=city_source):
    return {'firstHour':first,'nextHour':first if next is None else next,'maxStayMinutes':limit,'evidence':'official','source':src}
def integer(value):
    return int(value) if str(value).isdigit() else None
places=[]
osm=json.loads((RAW/'osm-parking.json').read_text(encoding='utf-8'))
for e in osm['elements']:
    t=e.get('tags',{}); center=e.get('center',e)
    if 'lat' not in center:
        points=[p for p in e.get('geometry',[]) if 'lat' in p]
        if not points: continue
        center={'lat':(min(p['lat'] for p in points)+max(p['lat'] for p in points))/2,'lon':(min(p['lon'] for p in points)+max(p['lon'] for p in points))/2}
    kind={'multi-storey':'garage','underground':'underground','lane':'street','street_side':'street'}.get(t.get('parking'),'surface')
    access={'yes':'public','public':'public','customers':'customers','private':'restricted','no':'restricted','permit':'restricted','residents':'restricted'}.get(t.get('access'),'unknown')
    name=t.get('name:mk',t.get('name', 'Паркинг' if kind=='surface' else 'Гаража'))
    official_tariff=None
    operator=t.get('operator')
    if e['id'] in [477575780,902213604]: official_tariff=tariff(30,src=garage_source); operator='gradski'
    if e['id']==176448644: official_tariff=tariff(250,src=poc_source); operator='poc'
    # POC homepage's 50-denar Judicial Palace lot is not assumed to be the garage.
    # Unknown and OSM-only prices stay out of verified-price rankings.
    if e['id']==37626715 and t.get('fee')=='no':
        official_tariff=None
    coordinates=[[p['lon'],p['lat']] for p in e.get('geometry',[]) if 'lat' in p]
    geometry=None
    if len(coordinates)>3 and coordinates[0]==coordinates[-1]: geometry={'type':'Polygon','coordinates':[coordinates]}
    p={'id':f"osm:{e['type']}:{e['id']}",'name':name,'nameEn':t.get('name:en',t.get('int_name')),'coordinate':{'latitude':center['lat'],'longitude':center['lon']},'kind':kind,'operator':operator,'zoneCode':None,'access':access,'tariff':official_tariff,'capacity':integer(t.get('capacity')),'openingHours':t.get('opening_hours'),'verification':'osm','source':source('OpenStreetMap contributors',f"https://www.openstreetmap.org/{e['type']}/{e['id']}",'ODbL 1.0')}
    if geometry: p['geometry']=geometry
    places.append(p)
ns={'k':'http://www.opengis.net/kml/2.2'}
for zone,page,mid,price in POC:
    tree=ET.fromstring((RAW/f'poc-zone-{zone}.kml').read_bytes())
    for i,mark in enumerate(tree.findall('.//k:Placemark',ns)):
        rings=[]
        for element in mark.findall('.//k:Polygon//k:LinearRing/k:coordinates',ns):
            points=[[float(v) for v in pair.split(',')[:2]] for pair in element.text.strip().split()]
            rings.append(points)
        if not rings: continue
        outer=rings[0]; n=len(outer)-1 if outer[0]==outer[-1] else len(outer)
        coord={'latitude':sum(p[1] for p in outer[:n])/n,'longitude':sum(p[0] for p in outer[:n])/n}
        places.append({'id':f'poc:zone:{zone}:{i}','name':mark.findtext('k:name',default='ПОЦ',namespaces=ns),'coordinate':coord,'geometry':{'type':'Polygon','coordinates':rings},'kind':'zone','operator':'poc','zoneCode':'POC '+zone,'access':'unknown','tariff':tariff(price,src=poc_source),'capacity':None,'openingHours':None,'verification':'official','source':source('POC official sector map',f'https://poc.mk/?page_id={page}')})
# All codes in Parking.MK's published Skopje list, stored as inventory until surveyed.
# These descriptions are not sufficient to assign exact parking sign geometry.
groups={
'A0': [('A0','Средно Водно'),('A01','ВМРО'),('A02','Св. Пантелејмон'),('A05','Орце Николов, Мал ринг'),('A06','Максим Горки')],
'A': [('A3','Даме Груев, полициска станица Беко'),('A4','Даме Груев, Собрание'),('A8','Камен мост')],
'B': [('B2','Бристол'),('B3','Бристол 2'),('B6','Јосип Броз / Димитрие Чуповски'),('B7','Илинден / Стив Наумов'),('B10','Водовод')],
'C': [('C8','Коста Шахов'),('C9','Дебарца / Никола Тримпаре'),('C15','Ѓуро Ѓаковиќ / Мирослав Крлежа'),('C17','Ленинова'),('C19','29 Ноември'),('C33','Транспортен центар'),('C35','Стале Попов'),('C45','МАНУ, МТВ, Судска палата'),('C46','Кеј Димитар Влахов'),('C80','ЗОО'),('C81','Град Скопје')],
'D': [('D1','Хотел Русија'),('D2','Три Бисери'),('D3','Бисер'),('D4','Веро, Аеродром'),('D5','Владимир Комаров'),('D6','Палма Аеродром / Владимир Комаров'),('D7','Аеродром Глорија'),('D8','Бојмија'),('D9','Црква / 23-ти Октомври'),('D40','8 Септември'),('D42','МИДА / Орце Николов'),('D62','Тениски терени АБЦ')]}
zone_source=source('JP Gradski Parking published zone names and streets','https://www.gradskiparking.com.mk/zonsko-parking-zoni.nspx')
rates={'A0':tariff(75,50),'A':tariff(40,limit=120),'B':tariff(30,limit=240),'C':tariff(25),'D':tariff(25)}
zones=[{'code':code,'name':name,'operator':'gradski','tariff':rates[group],'geometryStatus':'awaiting-survey','source':source('Parking.MK zone inventory','https://parking.mk/?language=en&page=static&section=town_skopje') if code=='A02' else zone_source} for group,rows in groups.items() for code,name in rows]
destinations=[{'id':'square','name':'Плоштад Македонија / Macedonia Square','coordinate':{'latitude':41.9961,'longitude':21.4316}}, {'id':'citymall','name':'Skopje City Mall','coordinate':{'latitude':42.0045,'longitude':21.3912}}, {'id':'ramstore','name':'Рамстор / Ramstore Mall','coordinate':{'latitude':41.9902,'longitude':21.4298}}, {'id':'zoo','name':'Зоолошка градина / Skopje Zoo','coordinate':{'latitude':42.0068,'longitude':21.4178}}, {'id':'station','name':'Транспортен центар / Railway Station','coordinate':{'latitude':41.9905,'longitude':21.4442}}, {'id':'bazaar','name':'Стара чаршија / Old Bazaar','coordinate':{'latitude':42.0021,'longitude':21.4368}}]
# Street anchors are deliberately approximate: never invent legal zone boundaries.
streets=json.loads((RAW/'streets.json').read_text(encoding='utf-8'))['elements'] if (RAW/'streets.json').exists() else []
zone_streets={'A05':'Орце Николов','A06':'Максим Горки','A3':'Даме Груев','A4':'Даме Груев','B2':'Мито Хаџивасилев Јасмин','B3':'Св. Кирил и Методиј','B6':'Димитрие Чуповски','B7':'Стив Наумов','B10':'Лазар Личеноски','C8':'Коста Шахов','C9':'Никола Тримпаре','C15':'Мирослав Крлежа','C17':'Ленинова','C19':'Костурски Херои','C33':'Никола Карев','C35':'Стале Попов','C45':'Кеј Димитар Влахов','C46':'Кеј Димитар Влахов','C80':'Илинден','C81':'Илинден','D1':'АСНОМ','D2':'Булевар Февруарски поход','D3':'Булевар Јане Сандански','D4':'Булевар Јане Сандански','D5':'Владимир Комаров','D6':'Владимир Комаров','D7':'Булевар Јане Сандански','D8':'Бојмија','D9':'23-ти Октомври','D40':'Париска','D42':'Орце Николов','D62':'Илинден'}
# D2 uses the named Tri Biseri landmark from OSM, not a guessed street boundary.
zone_streets.pop('D2', None)
map_snapshot_path=ROOT/'data/gradski-map-anchors.json'
map_snapshot=json.loads(map_snapshot_path.read_text(encoding='utf-8')) if map_snapshot_path.exists() else {'anchors':{}}
for zone in zones:
    matches=[e for e in streets if e['tags']['name']==zone_streets.get(zone['code'])]
    if zone['code']=='C33':
        matches=[e for e in matches if e['center']['lon']>21.438 and e['center']['lat']<42]
    if zone['code'] in ['A05','D42']:
        matches=[e for e in matches if (e['center']['lon']>21.426 if zone['code']=='A05' else e['center']['lon']<21.417)]
    if zone['code'] in ['C80','C81','D62']:
        matches=[e for e in matches if 21.408<e['center']['lon']<21.428]
    coord=None; anchor_source=None
    if matches:
        lat=sum(e['center']['lat'] for e in matches)/len(matches); lon=sum(e['center']['lon'] for e in matches)/len(matches)
        anchor=min(matches,key=lambda e:(e['center']['lat']-lat)**2+(e['center']['lon']-lon)**2)
        coord={'latitude':anchor['center']['lat'],'longitude':anchor['center']['lon']}
        anchor_source=source('Approximate street reference · OpenStreetMap',f"https://www.openstreetmap.org/way/{anchor['id']}",'ODbL 1.0')
    geocode={'A0':'vodno','A8':'stonebridge','D2':'tribiseri'}.get(zone['code'])
    if geocode and (RAW/f'{geocode}-geocode.json').exists():
        items=json.loads((RAW/f'{geocode}-geocode.json').read_text(encoding='utf-8'))
        if items:
            a=items[0]; coord={'latitude':float(a['lat']),'longitude':float(a['lon'])}
            anchor_source=source('Approximate landmark reference · OpenStreetMap',f"https://www.openstreetmap.org/{a['osm_type']}/{a['osm_id']}",'ODbL 1.0')
    if zone['code'] in map_snapshot['anchors']:
        coord=map_snapshot['anchors'][zone['code']]['coordinate']
        anchor_source=map_snapshot['source']
    if not coord: continue
    places.append({'id':'gradski:zone:'+zone['code'],'name':zone['name'],'coordinate':coord,'kind':'zone','operator':'gradski','zoneCode':zone['code'],'access':'unknown','tariff':zone['tariff'],'capacity':None,'openingHours':None,'verification':'official','locationPrecision':'area','source':zone['source'],'anchorSource':anchor_source})
# An offline destination index, including Latin names when OSM supplies them.
seen=set()
for e in streets:
    tags=e['tags']; name=tags['name']
    if name in seen: continue
    seen.add(name)
    aliases=list(dict.fromkeys(tags[k] for k in ['name','name:en','int_name','old_name'] if k in tags))
    destinations.append({'id':f"street:{e['id']}",'name':' / '.join(aliases),'coordinate':{'latitude':e['center']['lat'],'longitude':e['center']['lon']}})
# Give anonymous parking useful nearby street context, without assigning a sign code.
from math import cos, radians
for place in places:
    if place['name'] not in ['Паркинг','Гаража'] or not streets: continue
    lat=place['coordinate']['latitude']; lon=place['coordinate']['longitude']
    near=min(streets,key=lambda e:(e['center']['lat']-lat)**2+((e['center']['lon']-lon)*cos(radians(lat)))**2)
    meters=111000*((near['center']['lat']-lat)**2+((near['center']['lon']-lon)*cos(radians(lat)))**2)**0.5
    if meters<200:
        place['name']+=' · до '+near['tags']['name']
        place['nameEn']='Parking near '+near['tags'].get('name:en',near['tags']['name'])
catalog={'generatedAt':now,'places':places,'zones':zones,'destinations':destinations,'coverage':{'complete':False,'bounds':BOUNDS,'notes':['OSM amenity=parking features within the city-area bounding box, not a complete municipal register.','OSM points may be feature centres, not verified vehicle entrances.','POC polygons show tariff sectors; they do not establish that every street or space inside is legal parking.','Gradski labels use operator map coordinates where available, otherwise street/landmark references. They are not legal boundaries or vehicle entrances. A02 still has no map anchor.','The operator lists D42 (MIDA); A42 is not verified.','Baseline prices exclude schedule, holiday, pollution surcharges and permit exemptions. Check the sign.','POC/municipal geometry reuse permissions must be confirmed before commercial publication.']}}
(ROOT/'data'/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Built {len(places)} map features, {len(zones)} sign-code inventory records.')
