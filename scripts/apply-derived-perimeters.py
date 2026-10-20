"""Adds the outlines in data/derived-perimeters.json to data/catalog.json (also run by import-data.py).
They are approximations drawn from JP Gradski Parking's published zone streets and bay counts plus
OpenStreetMap streets, street-parking tags and parking areas; never surveyed boundaries."""
from pathlib import Path
import json
ROOT = Path(__file__).resolve().parents[1]

def apply(catalog, derived):
    source = {'label': 'Derived outline · JP Gradski Parking zone streets and OpenStreetMap',
              'url': 'https://www.gradskiparking.com.mk/zonsko-parking-zoni.nspx', 'retrievedAt': derived['generatedAt'], 'license': 'ODbL 1.0'}
    places = {p['id']: p for p in catalog['places']}
    for pid, outline in derived['places'].items():
        place = places.get(pid)
        if not place or (place.get('geometry') and place.get('boundaryEvidence') != 'derived'): continue  # never replace a real outline
        place['geometry'] = outline['geometry']
        place['boundaryEvidence'] = 'derived'
        place['boundarySource'] = source
        if outline.get('capacity') and place.get('capacity') is None: place['capacity'] = outline['capacity']
    return catalog

if __name__ == '__main__':
    path = ROOT / 'data' / 'catalog.json'
    catalog = apply(json.loads(path.read_text(encoding='utf-8')), json.loads((ROOT / 'data' / 'derived-perimeters.json').read_text(encoding='utf-8')))
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    print(sum(p.get('boundaryEvidence') == 'derived' for p in catalog['places']), 'derived outlines in the catalog')
