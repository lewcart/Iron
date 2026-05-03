'use client';

import { useEffect, useState } from 'react';
import { isLocalStub } from '@/lib/photo-upload-queue';
import { offsetTransform } from '@/lib/photo-offset';

interface AlignedPhotoProps {
  /** Vercel Blob URL or `local:*` stub. */
  blobUrl: string;
  /** When local:*, render from this Blob via createObjectURL. */
  blob?: Blob | null;
  /** CSS object-position y%, 0-100. NULL renders centered (50%). */
  cropOffsetY: number | null;
  /** CSS object-position x%, 0-100. NULL renders centered (50%). */
  cropOffsetX?: number | null;
  /** Aspect ratio for the cropped frame. Default 3/4 (portrait). */
  aspectRatio?: string;
  alt: string;
  className?: string;
  /** Object-fit value. Default 'cover'. */
  objectFit?: 'cover' | 'contain';
  /** Optional sizes hint for the underlying img element. */
  sizes?: string;
}

/** Renders a photo at a fixed aspect ratio with the persisted crop offsets
 *  applied via CSS transform. Handles `local:*` stubs by sourcing the JPEG
 *  from the Blob and revoking the object URL on unmount. */
export function AlignedPhoto({
  blobUrl,
  blob,
  cropOffsetY,
  cropOffsetX,
  aspectRatio = '3 / 4',
  alt,
  className = '',
  objectFit = 'cover',
  sizes,
}: AlignedPhotoProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (isLocalStub(blobUrl) && blob) {
      const url = URL.createObjectURL(blob);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setObjectUrl(null);
  }, [blobUrl, blob]);

  const src = isLocalStub(blobUrl) ? objectUrl : blobUrl;

  if (!src) {
    return <div className={`bg-muted/40 ${className}`} style={{ aspectRatio }} />;
  }

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ aspectRatio }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        sizes={sizes}
        className="absolute inset-0 w-full h-full select-none"
        style={{
          objectFit,
          transform: offsetTransform(cropOffsetX, cropOffsetY),
          transformOrigin: 'center',
        }}
        draggable={false}
      />
    </div>
  );
}
