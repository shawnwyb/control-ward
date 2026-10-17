import { supabase } from "./supabase";
import type { HazardType, MutationResult, Photo } from "./types";

/*
 * Idempotency state for in-flight writes. A retry after a lost response must
 * reuse the same request id, so this lives outside React state: it has to
 * survive re-renders, site switches and failed attempts.
 */

type PendingSubmission = {
  requestId: string;
  photoId: string;
  signature: string;
  photo?: Photo;
  file?: File;
  uploaded: boolean;
};

let pendingSubmission: PendingSubmission | undefined;
const pendingCheckins = new Map<string, string>();

export type ReportInput = {
  siteId: string;
  type: HazardType;
  severity: number;
  latitude: number;
  longitude: number;
  file?: File;
};

export async function discardPhoto(): Promise<void> {
  if (pendingSubmission?.photo) {
    // Storage delete policy permits only this user's unattached objects.
    await supabase.storage
      .from("hazard-photos")
      .remove([pendingSubmission.photo.object_path]);
  }
  pendingSubmission = undefined;
}

export function resetPending(): void {
  pendingSubmission = undefined;
  pendingCheckins.clear();
}

export function checkinRequestId(signature: string): string {
  const requestId = pendingCheckins.get(signature) ?? crypto.randomUUID();
  pendingCheckins.set(signature, requestId);
  return requestId;
}

export function completeCheckin(signature: string): void {
  pendingCheckins.delete(signature);
}

export async function submitHazardReport(
  report: ReportInput,
): Promise<MutationResult> {
  const { file } = report;
  const input = {
    p_site_id: report.siteId,
    p_type: report.type,
    p_severity: report.severity,
    p_lat: report.latitude,
    p_lon: report.longitude,
  };
  const signature = JSON.stringify(input);
  if (
    !pendingSubmission ||
    pendingSubmission.signature !== signature ||
    pendingSubmission.file !== file
  ) {
    await discardPhoto();
    pendingSubmission = {
      requestId: crypto.randomUUID(),
      photoId: crypto.randomUUID(),
      signature,
      file,
      uploaded: false,
    };
  }
  const pending = pendingSubmission;
  if (file && !pending.photo) {
    const reservation = await supabase.rpc("reserve_hazard_photo", {
      p_photo_id: pending.photoId,
      p_site_id: report.siteId,
      p_content_type: file.type,
    });
    if (reservation.error) throw reservation.error;
    pending.photo = reservation.data;
  }
  if (file && pending.photo && !pending.uploaded) {
    const upload = await supabase.storage
      .from("hazard-photos")
      .upload(pending.photo.object_path, file, {
        contentType: file.type,
        upsert: false,
      });
    // A timeout can occur after upload succeeded. Existing own reserved objects are safe to reuse.
    if (upload.error && String(upload.error.statusCode) !== "409")
      throw upload.error;
    pending.uploaded = true;
  }
  const result = await supabase.rpc("submit_hazard_report", {
    ...input,
    p_request_id: pending.requestId,
    p_photo_id: pending.photo?.id,
  });
  if (result.error) throw result.error;
  pendingSubmission = undefined;
  return result.data as unknown as MutationResult;
}
