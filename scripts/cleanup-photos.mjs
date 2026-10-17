import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

// Development janitor. A hosted worker must use server-side secrets instead.
const config = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }),
);
if (!["127.0.0.1", "localhost"].includes(new URL(config.API_URL).hostname))
  throw new Error("Local API required");
const client = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: photos, error } = await client
  .from("hazard_photos")
  .select("id,object_path")
  .is("observation_id", null)
  .lt("created_at", new Date(Date.now() - 3600000).toISOString())
  .limit(100);
if (error) throw error;
if (photos.length) {
  const removal = await client.storage
    .from("hazard-photos")
    .remove(photos.map((photo) => photo.object_path));
  if (removal.error) throw removal.error;
  const pruning = await client.rpc("prune_hazard_photo_reservations", {
    p_photo_ids: photos.map((photo) => photo.id),
  });
  if (pruning.error) throw pruning.error;
  console.log(`Removed ${pruning.data} abandoned photo reservations.`);
} else console.log("No abandoned photos to clean up.");
