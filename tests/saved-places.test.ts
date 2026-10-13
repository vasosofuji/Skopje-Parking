import test from "node:test";
import assert from "node:assert/strict";
import { SAVED_PLACE_LIMIT, readSavedPlaces, savedDestination, savedPlaceAt, withSavedPlace, type SavedPlace } from "../src/domain/saved-places";

const at = { latitude: 41.996, longitude: 21.431 };
const place = (id: string, kind: SavedPlace["kind"] = "custom", name = id): SavedPlace => ({ id, kind, name, coordinate: at });

test("stored saved places are validated, deduplicated and capped, with Home and Work first", () => {
  const raw = JSON.stringify([
    place("gym"), place("h1", "home", "  Home  "), place("h2", "home"), place("gym", "custom", "Duplicate"), place("w", "work"),
    { ...place("far"), coordinate: { latitude: 91, longitude: 21 } }, { ...place("nan"), coordinate: { latitude: NaN, longitude: 21 } },
    place("blank", "custom", "   "), { ...place("odd"), kind: "toString" }, { ...place("long"), name: "x".repeat(80) }, null, "junk",
  ]);
  const places = readSavedPlaces(raw);
  assert.deepEqual(places.map(p => p.id), ["h1", "w", "gym", "long"]);
  assert.equal(places[0].name, "Home");
  assert.equal(places[3].name.length, 60);
  assert.deepEqual(readSavedPlaces("{bad"), []);
  assert.deepEqual(readSavedPlaces(JSON.stringify({ id: "x" })), []);
  assert.equal(readSavedPlaces(JSON.stringify(Array.from({ length: 30 }, (_, i) => place(`p${i}`)))).length, SAVED_PLACE_LIMIT);
});

test("saving replaces the old Home, refuses a 21st place and matches nearby destinations", () => {
  const home = place("old-home", "home"), list = [home, place("a")];
  assert.deepEqual(withSavedPlace(list, place("new-home", "home"))!.map(p => p.id), ["new-home", "a"]);
  assert.deepEqual(withSavedPlace(list, place("b"))!.map(p => p.id), ["old-home", "a", "b"]);
  const full = Array.from({ length: SAVED_PLACE_LIMIT }, (_, i) => place(`p${i}`));
  assert.equal(withSavedPlace(full, place("one-more")), null);
  assert.equal(withSavedPlace(full, place("home", "home")), null, "a new Home still needs a free slot");
  assert.equal(withSavedPlace([...full.slice(1), home], place("new-home", "home"))?.length, SAVED_PLACE_LIMIT, "replacing Home needs no extra slot");
  assert.equal(savedPlaceAt(list, { latitude: at.latitude + 0.0002, longitude: at.longitude })?.id, "old-home", "about 22 m away");
  assert.equal(savedPlaceAt(list, { latitude: at.latitude + 0.001, longitude: at.longitude }), null);
  assert.deepEqual(savedDestination(home), { id: "saved:old-home", name: "old-home", coordinate: at });
});
