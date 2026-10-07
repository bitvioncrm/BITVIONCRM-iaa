# File storage

Files live in a private Supabase Storage bucket. The database stores metadata. Public bucket URLs are not used.

## Metadata

`organization_id`, `workspace_id`, `entity_type`, `entity_id`, `category`, `filename`, `mime_type`, `original_size`, `optimized_size`, `checksum` (SHA-256), `storage_path`, `processing_status`, `created_by`, `created_at`.

## Pipeline

Upload, validate type and size, reject unexpected content, hash, if the checksum already exists in the same organization then link that object instead of storing a second copy, optimize by category, write a preview, store privately, set status `ready`.

Statuses: `uploading`, `processing`, `optimizing`, `ready`, `failed`, `quarantined`. The UI stays usable while a job row runs. Failed jobs keep `error`, `retry_count`, `last_attempt`, and `next_attempt`.

## Category policy

| Category | Optimization |
| --- | --- |
| Medical document, certificate, ID proof | Keep the original. Preview may be a lighter copy. Lossless preference |
| Patient photo | Resize very large images, balanced quality |
| Marketing poster | Stronger image compression allowed. Original retained |
| PDF | Do not rasterize pages. Shrink only with a lossless or structure-preserving open-source pass when one is available |
| DOC, DOCX, XLS, XLSX, PPT, PPTX | Store the original. Offer download and a simple preview when the browser can show it |

Optimization uses the browser canvas for images and open-source code in a Netlify function when the file must be processed off the UI thread. No paid compression API.

## Access

RLS on `documents` matches the entity. A receptionist can upload an ID proof and cannot read a consultation attachment. Downloads use short-lived signed URLs created after the permission check. Viewers: PDF and images in-app, office files as preview or download. The user does not unzip anything.

## Analytics

Super Admin sees file count, original bytes, stored bytes, bytes saved, mix by type and workspace, and the largest objects, compared with the free-tier storage cap.
