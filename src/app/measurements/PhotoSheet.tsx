'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { recordProgressPhotoFromBlob } from '@/lib/mutations-measurements';
import { ALL_POSES, POSE_LABELS } from '@/lib/poses';
import type { ProgressPhotoPose } from '@/types';

const POSE_GUIDANCE: Record<ProgressPhotoPose, string> = {
  front:      'Face the camera, arms slightly away from your body, feet hip-width apart.',
  side:       'Stand sideways, arms relaxed, feet together, looking straight ahead.',
  back:       'Back to the camera, arms slightly away from your body, feet hip-width apart.',
  face_front: 'Camera at eye level, neutral expression, hair clear of the face.',
  face_side:  'Profile shot, ear and jawline visible, eyes forward.',
  other:      'Anything else worth tracking — outfit, lighting, angle.',
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PhotoSheet({ open, onClose }: Props) {
  const [selectedPose, setSelectedPose] = useState<ProgressPhotoPose>('front');
  const [photoNote, setPhotoNote] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset transient state when the sheet opens.
  useEffect(() => {
    if (open) {
      setSelectedPose('front');
      setPhotoNote('');
    }
  }, [open]);

  const handlePhotoUpload = async (file: File) => {
    setSaving(true);
    try {
      // Offline-friendly capture (parity with inspo): write the Dexie row
      // with the JPEG Blob + a `local:<uuid>` stub blob_url immediately.
      // The upload to /api/progress-photos/upload is queued via the photo
      // upload helper; on success the row is rewritten with the real Vercel
      // URL and _synced flips to false so sync engine pushes the metadata.
      // If the upload fails (offline), the row stays in the queue and the
      // sweeper retries on app focus / online events.
      await recordProgressPhotoFromBlob({
        blob: file,
        pose: selectedPose,
        notes: photoNote || null,
      });
      setPhotoNote('');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add Photo" height="auto">
      <div className="p-4 space-y-3">
        <div className="ios-section">
          {/* Pose selector — single line, scrollable on phones. Six chips
              don't fit at full width on a 375pt iPhone, so wrap is avoided
              by horizontal scroll. */}
          <div className="ios-row py-2 px-2">
            <div className="flex-1 flex gap-2 overflow-x-auto scrollbar-none flex-nowrap">
              {ALL_POSES.map(pose => (
                <button
                  key={pose}
                  onClick={() => setSelectedPose(pose)}
                  className={`shrink-0 px-3 py-2 text-xs font-medium rounded-lg border whitespace-nowrap transition-colors ${
                    selectedPose === pose
                      ? 'bg-primary text-white border-primary'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {POSE_LABELS[pose]}
                </button>
              ))}
            </div>
          </div>

          {/* Pose guidance */}
          <div className="ios-row py-1">
            <p className="text-xs text-muted-foreground">{POSE_GUIDANCE[selectedPose]}</p>
          </div>

          {/* Note */}
          <div className="ios-row">
            <input
              type="text"
              placeholder="Note (optional)"
              value={photoNote}
              onChange={e => setPhotoNote(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none min-h-[44px] text-muted-foreground"
            />
          </div>

          <div className="ios-row justify-end">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handlePhotoUpload(file);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              <Camera className="h-4 w-4" />
              {saving ? 'Saving…' : 'Choose Photo'}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
