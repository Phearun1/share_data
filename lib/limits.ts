// Shared between the client (pre-upload check) and the upload API route.
//
// Netlify Functions cap a request payload at 6 MB, and binary bodies are
// base64-encoded (~+33%), leaving ~4.5 MB usable. We cap at 4 MB for headroom.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "4 MB";
