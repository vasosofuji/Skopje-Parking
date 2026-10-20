# Zone source check — 1 October 2026

The Gradski Parking [public map](https://www.gradskiparking.com.mk/mapa-lokacii-nova.nspx) embeds named point coordinates in its page. The importer reads those numbers as data without executing the page's JavaScript. Thirty distinct codes in the app's current inventory now use those operator coordinates; A01 gains its first map label. Karpoš's D40 and D62 are among the corrected points. D42 still uses an approximate Orce Nikolov street reference.

The map uses legacy A1/A5/A6 names. The operator's [zone inventory](https://www.gradskiparking.com.mk/zonsko-parking-zoni.nspx) identifies the same Agromehanika, Orce Nikolov and Maksim Gorki sites as A01/A05/A06. The importer uses this documented crosswalk. C11 occurs on the legacy map but is absent from the current inventory, so it was not added as an active zone. No old capacity values were imported.

The snapshot is in `data/gradski-map-anchors.json`; refresh with `python scripts/import-zone-anchors.py`. The normal catalog generator also uses this snapshot, preserving the operator source URL and retrieval date.

The [City of Skopje GIS parking-zone layer](https://gisportal.skopje.gov.mk/arcgis/rest/services/INFRA/Komunalni_objekti/MapServer/57) advertises polygon queries, but its public count query returned `{"count":0}`. Its fields describe numbered planning zones, not the letter/number sign codes. It supplies no importable boundaries at present.

The catalog now has 35 Gradski map labels for 36 inventory codes, plus the existing 13 POC sector polygons. A02 remains without a map anchor. Operator points identify areas; they are not surveyed boundaries or verified entrances, and do not trigger arrival detection. Community polygons can fill the missing boundaries with source photos. This research does not establish complete city coverage.

## Derived outlines — 20 October 2026

`data/derived-perimeters.json` adds approximate outlines; `scripts/apply-derived-perimeters.py` merges them into the catalog, and `scripts/import-data.py` runs it. Each zone grows along its published streets from the operator's anchor until the estimated bays reach the operator's count. Estimates follow OpenStreetMap street-parking tags (parallel 5.5 m a bay, perpendicular 2.6 m) and add adjacent OSM parking areas. Each zone stays inside its own nearest-anchor cell, so outlines never overlap. Outlines carry `boundaryEvidence: "derived"` and keep `locationPrecision: "area"`. One-tap SMS pay matches them by distance to the kerb outline (40 m plus GPS accuracy), never by the exact-outline checks, and lots inside them inherit no sign.

32 of the 35 Gradski zones have an outline. C33, D3 and D5 stay points, because OSM shows under half of their published bays near the anchor. 16 point-only lots gained an outline: 3 underground garages take the outline above them (two buildings, and the Majka Tereza square for Kresnensko Vostanie), and 13 got street-side strips sized from their capacity, or 10 bays if unknown. 6 point lots are duplicate pins inside existing catalog lots, and 16 have no street or outline nearby; all of these stay points. None of this is surveyed: the sign and the kerb markings always decide.
