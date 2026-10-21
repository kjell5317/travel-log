#!/usr/bin/env node
// Builds the reference data the app ships with:
//   src/data/airports.json  - every airport with an IATA code
//   src/data/countries.json - every ISO country/territory with UN status and continent
//   src/data/cities.json    - cities (GeoNames cities5000), loaded on demand by the city search
//
// Sources:
//   OurAirports (public domain, updated nightly)  https://ourairports.com/data/
//   OpenFlights (ODbL) - only used for closed airports whose IATA code OurAirports
//                        no longer lists (e.g. TXL, SXF, THF)
//   world-countries npm package (ODbL) - ISO numeric codes, UN membership, flags
//   GeoNames (CC BY 4.0) - cities with at least 5,000 inhabitants, for places without an airport
//
// Run with `npm run update-data`.

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'src', 'data');
const require = createRequire(import.meta.url);

const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data';
const OPENFLIGHTS = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';
const GEONAMES = 'https://download.geonames.org/export/dump';
/**
 * Other Latin-script names, so searches like "München" or "Wien" work: cities from 50,000 inhabitants get
 * the names that start like their own (München for Munich), cities from 300,000 a broader set (Wien, Mailand).
 */
const ALT_NAMES_FROM_POPULATION = 50000;
const MANY_ALT_NAMES_FROM_POPULATION = 300000;

// Places with an IATA code that neither database lists (mostly rail stations sold as flights).
// [name, city, ISO country, lat, lon, type]
const EXTRA_CODES = {
  ZPD: ['Oldenburg (Oldb) Hauptbahnhof', 'Oldenburg', 'DE', 53.1439, 8.2222, 'R'],
};

// Airports labelled by a city the served-city rule doesn't pick (see addServedCities), e.g. one under 200,000.
const SERVED_CITIES = {
  OST: 'Bruges',
};

// world-countries lists the Vatican as a UN member; it is a permanent observer.
const UN_OBSERVERS = new Set(['VA', 'PS']);

const TYPE_CODES = {
  large_airport: 'L',
  medium_airport: 'M',
  small_airport: 'S',
  heliport: 'H',
  seaplane_base: 'W',
  closed: 'C',
};

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Reads one file from a zip archive (stored or deflated), via the central directory. */
function unzipFile(zip, name) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');
  let entry = zip.readUInt32LE(eocd + 16);
  for (let i = zip.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = zip.readUInt16LE(entry + 10);
    const size = zip.readUInt32LE(entry + 20);
    const nameLength = zip.readUInt16LE(entry + 28);
    const local = zip.readUInt32LE(entry + 42);
    if (zip.toString('utf8', entry + 46, entry + 46 + nameLength) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    }
    entry += 46 + nameLength + zip.readUInt16LE(entry + 30) + zip.readUInt16LE(entry + 32);
  }
  throw new Error(`${name} not found in zip`);
}

const foldName = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Many airports list the suburb they're in as their city ("Balice" for Kraków, "Zaventem" for Brussels).
 * When a city of 200,000+ that is at least 5× the listed town lies within 25 km, that city is stored as the
 * airport's "served city" (7th field), used to label places by name. Towns used as stand-ins further away
 * from a big city (Palanga, 29 km from Klaipėda) keep their own name, and so do airports whose listed city is
 * itself big, even if spelled differently (Oostende/Ostend) or farther away (London for Stansted).
 */
function addServedCities(airports, cityData) {
  const grid = new Map();
  for (const [name, , , lat, lon, population] of cityData.cities) {
    const key = `${Math.floor(lat)},${Math.floor(lon)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push({ name, lat, lon, population });
  }
  let count = 0;
  for (const row of Object.values(airports)) {
    const [, municipality, , lat, lon] = row;
    const near = [];
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        for (const c of grid.get(`${Math.floor(lat) + dLat},${Math.floor(lon) + dLon}`) ?? []) {
          const d = distanceKm(lat, lon, c.lat, c.lon);
          if (d <= 100) near.push({ ...c, d });
        }
      }
    }
    const town = foldName(municipality.replace(/\s*\(.*\)\s*$/, '').split(',')[0].trim());
    const isTown = (c) => {
      const name = foldName(c.name);
      if (name === town) return true;
      return c.d <= 30 && (name.includes(town) || town.includes(name) || editDistance(name, town) <= 2);
    };
    const ownPopulation = Math.max(0, ...near.filter(isTown).map((c) => c.population));
    const big = near
      .filter((c) => c.d <= 25 && c.population >= 200000 && c.population >= 5 * ownPopulation)
      .sort((a, b) => b.population - a.population)[0];
    if (big && foldName(big.name) !== town) {
      row[6] = big.name;
      count++;
    }
  }
  return count;
}

/**
 * Compact city list: { regions: [...], cities: [[name, country, regionIndex, lat, lon, population, altNames?]] },
 * altNames being other Latin-script names joined with "|".
 */
async function buildCities() {
  const [citiesZip, admin1] = await Promise.all([fetchBuffer(`${GEONAMES}/cities5000.zip`), fetchText(`${GEONAMES}/admin1CodesASCII.txt`)]);
  const regionNames = new Map(admin1.split('\n').filter(Boolean).map((line) => line.split('\t')).map(([code, name]) => [code, name]));
  const regions = [];
  const regionIndex = new Map();
  const cities = [];
  for (const line of unzipFile(citiesZip, 'cities5000.txt').split('\n')) {
    const f = line.split('\t');
    if (f.length < 15) continue;
    const [, name, ascii, alternates, lat, lon, , , country, , admin1Code] = f;
    const population = Number(f[14]) || 0;
    const regionName = regionNames.get(`${country}.${admin1Code}`);
    let region = -1;
    if (regionName) {
      if (!regionIndex.has(regionName)) {
        regionIndex.set(regionName, regions.length);
        regions.push(regionName);
      }
      region = regionIndex.get(regionName);
    }
    const row = [name, country, region, round(Number(lat)), round(Number(lon)), population];
    if (population >= ALT_NAMES_FROM_POPULATION && alternates) {
      const own = [foldName(name), foldName(ascii)];
      const seen = new Set(own);
      const similar = [];
      const other = [];
      for (const candidate of alternates.split(',')) {
        const folded = foldName(candidate);
        if (seen.has(folded) || candidate.length > 30 || /\s/.test(candidate)) continue;
        if (!/^[\p{Script=Latin}][\p{Script=Latin}'.-]*$/u.test(candidate) || /^[A-Z]{3,4}$/.test(candidate)) continue;
        seen.add(folded);
        (own.some((o) => o.slice(0, 3) === folded.slice(0, 3)) ? similar : other).push(candidate);
      }
      const byLength = (a, b) => a.length - b.length;
      const alt = [...similar.sort(byLength).slice(0, 20), ...(population >= MANY_ALT_NAMES_FROM_POPULATION ? other.sort(byLength).slice(0, 48) : [])];
      if (alt.length) row.push(alt.join('|'));
    }
    cities.push(row);
  }
  cities.sort((a, b) => b[5] - a[5]);
  return { regions, cities };
}

/** RFC 4180 CSV parser (quoted fields, escaped quotes, newlines inside quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvObjects(text) {
  const [header, ...rows] = parseCsv(text);
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const round = (n) => Math.round(n * 1e4) / 1e4;

function distanceSq(lat1, lon1, lat2, lon2) {
  const dLat = lat1 - lat2;
  const dLon = (lon1 - lon2) * Math.cos((lat1 * Math.PI) / 180);
  return dLat * dLat + dLon * dLon;
}

async function main() {
  console.log('Downloading OurAirports, OpenFlights and GeoNames data…');
  const [airportsCsv, countriesCsv, openflightsCsv, cityData] = await Promise.all([
    fetchText(`${OURAIRPORTS}/airports.csv`),
    fetchText(`${OURAIRPORTS}/countries.csv`),
    fetchText(OPENFLIGHTS),
    buildCities(),
  ]);

  const ourAirports = csvObjects(airportsCsv);
  const airports = {};
  for (const a of ourAirports) {
    const code = a.iata_code?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{3}$/.test(code)) continue;
    airports[code] = [
      a.name,
      a.municipality || '',
      a.iso_country,
      round(Number(a.latitude_deg)),
      round(Number(a.longitude_deg)),
      TYPE_CODES[a.type] ?? 'S',
    ];
  }
  const activeCount = Object.keys(airports).length;

  // OpenFlights: fill in codes OurAirports dropped (mostly closed airports).
  // Its country column is a free-text name, so take the country of the
  // nearest OurAirports entry instead (closed ones are kept there, just without IATA).
  const located = ourAirports
    .map((a) => ({ lat: Number(a.latitude_deg), lon: Number(a.longitude_deg), country: a.iso_country }))
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon) && a.country);
  let historicCount = 0;
  for (const r of parseCsv(openflightsCsv)) {
    // id, name, city, country, IATA, ICAO, lat, lon, alt, tz, dst, tzdb, type, source
    const [, name, city, , iata, , lat, lon, , , , , type] = r;
    if (type !== 'airport' || !/^[A-Z]{3}$/.test(iata ?? '') || airports[iata]) continue;
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    let best = null;
    let bestD = Infinity;
    for (const a of located) {
      const d = distanceSq(la, lo, a.lat, a.lon);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    airports[iata] = [name, city, best?.country ?? '', round(la), round(lo), 'C'];
    historicCount++;
  }

  for (const [code, row] of Object.entries(EXTRA_CODES)) airports[code] ??= row;
  const served = addServedCities(airports, cityData);
  for (const [code, city] of Object.entries(SERVED_CITIES)) if (airports[code]) airports[code][6] = city;

  const sortedAirports = Object.fromEntries(Object.entries(airports).sort(([a], [b]) => a.localeCompare(b)));

  // Countries: OurAirports country list (ISO alpha-2 + continent) joined with world-countries.
  const worldCountries = require('world-countries/countries.json');
  const byCca2 = new Map(worldCountries.map((c) => [c.cca2, c]));
  const countries = csvObjects(countriesCsv)
    .map((c) => {
      const wc = byCca2.get(c.code);
      const observer = UN_OBSERVERS.has(c.code);
      return {
        code: c.code,
        name: wc?.name.common ?? c.name,
        continent: c.continent,
        ccn3: wc?.ccn3 || null,
        un: Boolean(wc?.unMember) && !observer,
        observer,
        flag: wc?.flag ?? '',
        // Approximate centre, used as the marker when a no-flight trip names a country instead of an airport.
        lat: wc?.latlng ? round(wc.latlng[0]) : null,
        lon: wc?.latlng ? round(wc.latlng[1]) : null,
        // Other names to search by, e.g. "USA", "UK", "Holland", "Ivory Coast".
        alt: [...new Set([wc?.name.official, ...(wc?.altSpellings ?? [])])].filter(
          (s) => s && s !== c.code && s !== wc?.name.common,
        ),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const unCount = countries.filter((c) => c.un).length;
  if (unCount !== 193) console.warn(`⚠ Expected 193 UN member states, found ${unCount}`);

  await writeFile(path.join(outDir, 'airports.json'), JSON.stringify(sortedAirports) + '\n');
  await writeFile(path.join(outDir, 'countries.json'), JSON.stringify(countries, null, 1) + '\n');
  await writeFile(path.join(outDir, 'cities.json'), JSON.stringify(cityData) + '\n');

  const size = (await readFile(path.join(outDir, 'airports.json'))).length;
  console.log(
    `Wrote ${activeCount} airports + ${historicCount} historic airports (${(size / 1024).toFixed(0)} KB), ` +
      `${countries.length} countries (${unCount} UN members), ${cityData.cities.length} cities; ${served} airports labelled by the city they serve.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
