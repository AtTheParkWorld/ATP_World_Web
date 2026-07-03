/**
 * Media upload — picks a photo/video via expo-image-picker and pushes it
 * to Cloudflare R2 in two steps:
 *
 *   1. POST /api/cms/upload-url { kind:'post', filename, content_type }
 *      → backend returns { url (presigned PUT), public_url, key, ... }
 *
 *   2. PUT the file binary to that signed URL directly (browser/native
 *      fetch — never goes through our backend, so a 10MB photo doesn't
 *      hit Render's request body limits).
 *
 * The caller gets back the resulting public_url which they can include
 * in the post's `media` array.
 */
import { api } from './client';

export interface UploadUrlResponse {
  url: string;          // presigned PUT URL valid for 5 min
  public_url: string;   // permanent R2 URL of the file once uploaded
  key: string;          // R2 object key (kind/filename/timestamp)
  content_type: string;
  max_size_bytes: number;
}

/**
 * Strip the path part of a local file URI (`file:///.../IMG_1234.jpg`)
 * down to just the filename — the backend uses this to build the
 * R2 storage key.
 */
function basename(uri: string): string {
  const parts = uri.split('/');
  return parts[parts.length - 1] || 'upload.jpg';
}

/**
 * Pick an image (or video) from the user's library, upload it to R2,
 * and return the public URL. Calls Alert.alert on failure so the
 * composer doesn't need to handle errors itself.
 *
 * Returns null if the user cancels the picker.
 */
export async function pickAndUploadMedia(opts: { kind?: 'post' | 'avatar' } = {}): Promise<{
  public_url: string;
  content_type: string;
  width:  number | null;
  height: number | null;
} | null> {
  const { launchImageLibraryAsync, MediaTypeOptions, requestMediaLibraryPermissionsAsync } =
    await import('expo-image-picker');

  const perm = await requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Photo library access is required to attach media.');
  }

  const picked = await launchImageLibraryAsync({
    mediaTypes: MediaTypeOptions.All,
    allowsEditing: false,
    quality: 0.8,
    exif: false,
  });
  if (picked.canceled || !picked.assets?.length) return null;

  const asset = picked.assets[0];
  const uri = asset.uri;
  const contentType =
    asset.mimeType
    || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');

  const signed = await api.post<UploadUrlResponse>('/cms/upload-url', {
    kind:         opts.kind || 'post',
    filename:     basename(uri),
    content_type: contentType,
  });

  // Size check via the filesystem — cheaper than reading the whole file
  // into memory, works for file:// (iOS) and content:// (Android) URIs.
  const FileSystem = await import('expo-file-system');
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  const size = (info.exists && 'size' in info ? (info as any).size : 0) || 0;
  if (size > signed.max_size_bytes) {
    throw new Error(`File is too large (${Math.round(size / 1024 / 1024)}MB). Max ${Math.round(signed.max_size_bytes / 1024 / 1024)}MB.`);
  }

  // PUT directly to R2 via the native uploader. The old approach —
  // fetch(file://) → blob → fetch(PUT, {body: blob}) — intermittently
  // fails with "Network request failed" on iOS for larger photos
  // because RN buffers the entire blob through the JS bridge.
  // FileSystem.uploadAsync streams from disk in native code.
  const putResp = await FileSystem.uploadAsync(signed.url, uri, {
    httpMethod: 'PUT',
    headers:    { 'Content-Type': contentType },
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  });
  if (putResp.status < 200 || putResp.status >= 300) {
    throw new Error(`Upload failed (HTTP ${putResp.status}). Try a smaller file or a different network.`);
  }

  return {
    public_url:   signed.public_url,
    content_type: contentType,
    width:        asset.width || null,
    height:       asset.height || null,
  };
}
