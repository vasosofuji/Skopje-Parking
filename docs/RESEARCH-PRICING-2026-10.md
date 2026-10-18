# Skopje parking prices and rules, checked 18 October 2026

Sources were read on 18 October 2026. Each section notes what the catalog (`data/catalog.json`) already has and what it lacks. Nothing here has been imported yet.

## JP Gradski Parking (city operator)

Source: [price list](https://www.gradskiparking.com.mk/javni-parkiralishta-i-zonsko.nspx).

| Zone | Street zone, MKD/hour | Barrier lots, MKD/hour |
| --- | --- | --- |
| A0 (A0, A01, A05, A06) | 75 first hour, 50 each later hour | n/a |
| A | 40 | 40 |
| B | 30 | 40 |
| C | 25 | 30 |
| D | 25 | 30 |

The street rates in the catalog (A0 75/50, A 40, B 30, C/D 25) match.

- Time limits ([zones page](https://www.gradskiparking.com.mk/zonsko-parking-zoni.nspx)): A is 2 hours and B is 4 hours. A0, C and D have no limit. The catalog already has these.
- SMS ([how to pay](https://www.gradskiparking.com.mk/zonsko-nacini-naplata.nspx)): send `A3 SK1234AB` to 144 144 to start and `S` to stop. The plate goes in with no dashes or spaces. Only Macedonian numbers work. The app already matches this.
- Other payment options: scratch tickets, a QR code on the zone boards, and the Parking.mk app.
- Fines and fees: an unpaid-parking surcharge ticket is 990 MKD. Parking in a disabled bay without a permit is 3,000 MKD. A guest card costs 450 MKD for 30 hours in zones A and B, and 300 MKD in C and D.
- Monthly passes: A 4,000, B 3,000, C 2,000, D 1,000. Residents pay 0 for a first vehicle and 300 for a second (zone D residents pay nothing).
- Towing ([Pajak](https://www.gradskiparking.com.mk/cenovnik-pajak.nspx)): towing to the depot is 2,500 MKD, or 3,500 MKD from a green area. If the owner arrives during the tow and removes the car, it is 1,500 MKD. Storage after the first 24 hours is 500 MKD per day.
- Garages ([price list](https://www.gradskiparking.com.mk/cenovnik-katna-garaza.nspx)): Beko and 26 Juli are 30 MKD/hour, 2,000/month and 20,000/year. The catalog has both.

### Official bay counts per zone (catalog `capacity` is null for every zone)

From the zones page: A0 154, A01 42, A05 39, A06 24, A3 53, A4 85, A8 151, B2 57, B3 49, B6 26, B7 77, B10 24, C8 7, C9 22, C15 73, C17 22, C19 26, C33 136, C35 53, C45 380, C46 193, C80 99, C81 131, D1 31, D2 780, D3 1652, D4 727, D5 116, D6 154, D7 660, D8 63, D9 410, D40 65, D42 79, D62 33 (5 of them taxi).

### Barrier lots ([list](https://www.gradskiparking.com.mk/parking-zoni.nspx)), all missing a tariff in the catalog

| Lot | Spaces | MKD/hour | Hours | Catalog match |
| --- | --- | --- | --- | --- |
| Kočo Racin | 177 | 40 | 24 h | osm:way:174111000 (capacity 198) |
| Gradska bolnica | 111 | 40 | 24 h | osm:way:32490191 |
| Zoil | 123 | 40 | 07:00-21:00 | osm:way:163061297 |
| Nova Makedonija | 173 | 30 | 24 h | osm:way:32913544 |
| Tutunski kombinat | 134 | 30 | 07:00-21:00 | osm:way:1537498909 |
| Treska | 98 | 30 | 24 h | not matched |
| AMSM | 111 + 6 trucks | 30 | 24 h | osm:way:32560557 |
| Naroden front | 99 | 30 | 24 h | not matched (several "до Народен Фронт" lots) |
| Klinički centar | 911 | 30 | 24 h | not matched |
| 8-mi Septemvri | 46 | 30 | 07:00-21:00 | likely osm:way:176343667 |

## JP Parkinzi na Opština Centar (POC)

Source: the 2026 price list adopted 15.04.2026 ([price lists page](https://poc.mk/?page_id=161), scanned PDF). SMS ([page](https://poc.mk/?page_id=298)): send `1 SK1234MM 2` (zone, plate, hours) to 14 14 14. There is no stop SMS; a reminder arrives 10 minutes before the time runs out. Each SMS costs 5 MKD + VAT.

| Zone | MKD/hour | Day card | Prepaid day | Monthly |
| --- | --- | --- | --- | --- |
| Zone 0 | 100 | n/a | n/a | n/a |
| **Zone X** | **80** | 1,600 | 800 | n/a |
| Zone I | 70 | 1,600 | 800 | 2,500 (guest day 300, week 1,200) |
| Zone II | 60 | 1,400 | 700 | 2,500 (guest day 300, week 1,200) |

**Zone X is not in the catalog or in `skopje-rules.ts`.** The POC website home page still lists only 0/1/2. The SMS token for Zone X is not published.

The wheel clamp ("блокатор") costs 1,500 MKD. A reserved bay is 12,000 MKD per month, or 18,000 in Zone 0.

Closed lots, MKD/hour: Dom na gradežnici 250, Paloma Bjanka 100, Trgotekstil 70, Avtomakedonija and Zelen pazar 70, Dilajla 60, Sudska palata garage 50. Each lot has a penalty ticket of 2,500 and an extra day ticket of 1,500. The catalog has a tariff only for Dom na gradežnici. Sudska palata (osm:way:229923843) and Avtomakedonija (osm:way:174522668) exist without a tariff.

## Skopje International Airport

Source: [airport parking page](https://skp.airports.com.mk/en-EN/park/page/parking). Prices: 1 h 100, 2 h 150, 3 h 200, 3-4 h 300, 4-6 h 400, 6-8 h 500, 24 h 1,000, 3-5 days 3,500, 5-7 days 4,500, then 400 for each extra day (MKD, VAT included). The Hug & Fly bay is free for 10 minutes, and disabled bays are free for 24 hours.

The airport (21.62 E) lies outside the API's coordinate box (longitude 21.30-21.58), so drivers cannot add it.

## Not found

Skopje City Mall, East Gate and Ramstor do not publish garage tariffs online. Airport rates before 2026 (80 MKD for the first hour) are outdated.
