// Shared between the client (pre-upload check) and the create-upload API route.
//
// Files upload directly from the browser to Supabase Storage, so Netlify's
// 4.5 MB function limit no longer applies. The ceiling is Supabase's free-tier
// per-file limit of 50 MB.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "50 MB";
