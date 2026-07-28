import "dotenv/config";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = resolve(workspace, "src/data/rail-content.v1.json");
const temporaryPath = `${snapshotPath}.next`;
const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const configuredSources = [
  { key: "RAIL_STATIONS_URL", publisher: "國營臺灣鐵路股份有限公司", kind: "stations" },
  { key: "RAIL_TOURISM_URL", publisher: "交通部觀光署／新北市政府觀光旅遊局", kind: "tourism" }
].filter((source) => process.env[source.key]);

if (configuredSources.length === 0) {
  validate(snapshot);
  process.stdout.write("Snapshot is valid. Set RAIL_STATIONS_URL or RAIL_TOURISM_URL to refresh official data.\n");
  process.exit(0);
}

const retrievedAt = new Date().toISOString();
for (const source of configuredSources) {
  const sourceUrl = process.env[source.key];
  const response = await fetch(sourceUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${source.key} returned HTTP ${response.status}; existing snapshot was not changed`);
  const payload = await response.json();
  if (source.kind === "stations") mergeStations(snapshot, records(payload));
  if (source.kind === "tourism") mergePois(snapshot, records(payload));
  snapshot.sources = snapshot.sources.filter((item) => item.publisher !== source.publisher);
  snapshot.sources.push({ publisher: source.publisher, sourceUrl, retrievedAt, sourceUpdatedAt: response.headers.get("last-modified") ?? undefined });
}

validate(snapshot);
await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
await rename(temporaryPath, snapshotPath);
process.stdout.write(`Updated ${snapshotPath}. Review and commit the snapshot diff manually.\n`);

function records(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "Data", "Stations", "Tourism", "records", "result"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.[key]?.records)) return payload[key].records;
  }
  throw new Error("Official data payload does not contain a recognized record array; existing snapshot was not changed");
}

function mergeStations(target, incoming) {
  for (const station of target.stations) {
    const match = incoming.find((item) => stationName(item) === station.name);
    if (!match) continue;
    const lat = numberFrom(match, ["StationPosition.PositionLat", "PositionLat", "lat", "Latitude"]);
    const lng = numberFrom(match, ["StationPosition.PositionLon", "PositionLon", "lng", "Longitude"]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) Object.assign(station, { lat, lng });
  }
}

function mergePois(target, incoming) {
  for (const poi of target.pois) {
    const match = incoming.find((item) => String(item.Name ?? item.name ?? item.ScenicSpotName ?? "").includes(poi.name.replace(/周邊|入口/g, "")));
    if (match?.Name || match?.ScenicSpotName) poi.name = String(match.Name ?? match.ScenicSpotName);
  }
}

function stationName(item) {
  return String(item?.StationName?.Zh_tw ?? item?.StationName?.ZhTw ?? item?.StationName ?? item?.name ?? item?.Name ?? "").replace(/車站$|站$/u, "");
}

function numberFrom(value, paths) {
  for (const path of paths) {
    const result = path.split(".").reduce((current, key) => current?.[key], value);
    const numeric = Number(result);
    if (Number.isFinite(numeric)) return numeric;
  }
  return Number.NaN;
}

function validate(value) {
  if (value.schemaVersion !== 1) throw new Error("Unsupported snapshot schema");
  if (!value.route?.stationIds?.length || value.route.stationIds.length !== value.stations?.length) throw new Error("Route/station mismatch");
  const ids = new Set(value.stations.map((station) => station.id));
  if (value.route.stationIds.some((id) => !ids.has(id))) throw new Error("Route contains an unknown station");
  if (value.stories.some((story) => !story.sources?.length || !story.reviewStatus)) throw new Error("Every story needs review status and sources");
  if (value.sources.some((source) => !source.publisher || !source.sourceUrl || !source.retrievedAt)) throw new Error("Every source needs publisher, URL, and retrieval date");
}
