// Cloud mode (deployed on Netlify + Supabase): files upload directly from the
// browser to Supabase Storage, whose free-tier per-file limit is 50 MB.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "50 MB";

// Local mode (run on your own machine over the LAN): files stream to local disk,
// so the only real limit is disk space. Cap generously to avoid runaway writes.
export const MAX_LOCAL_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_LOCAL_LABEL = "2 GB";
