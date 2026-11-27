import { OFFLINE_LIMITS } from '@hse/shared';

export class PhotoNotSupportedError extends Error {
  constructor() {
    super('This file is not a photo the browser can read.');
    this.name = 'PhotoNotSupportedError';
  }
}

/** The size a photo is scaled to: long edge at most `maxEdge`, never enlarged (T-74). */
export function targetSize(
  width: number,
  height: number,
  maxEdge: number = OFFLINE_LIMITS.photoLongEdge,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export interface CompressedPhoto {
  bytes: ArrayBuffer;
  type: 'image/jpeg';
  name: string;
  width: number;
  height: number;
}

/**
 * PLT-28 / T-74 / O-121: re-encodes a photo to JPEG, long edge at most 2,560 px, quality 0.82.
 * Re-encoding drops every EXIF field, including the GPS position; the original isn't kept.
 * `createImageBitmap` applies the EXIF orientation first, so the photo stays upright.
 */
export async function compressPhoto(file: Blob, name = 'photo.jpg'): Promise<CompressedPhoto> {
  if (!file.type.startsWith('image/')) throw new PhotoNotSupportedError();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoNotSupportedError();
  }
  const size = targetSize(bitmap.width, bitmap.height);
  let blob: Blob | null;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(size.width, size.height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, size.width, size.height);
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: OFFLINE_LIMITS.photoQuality });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, size.width, size.height);
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', OFFLINE_LIMITS.photoQuality);
    });
  }
  bitmap.close();
  if (!blob) throw new PhotoNotSupportedError();
  return {
    bytes: await blob.arrayBuffer(),
    type: 'image/jpeg',
    name: name.replace(/\.[^.]*$/, '') + '.jpg',
    ...size,
  };
}
