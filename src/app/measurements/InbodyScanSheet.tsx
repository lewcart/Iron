'use client';

import { Sheet } from '@/components/ui/sheet';
import { InbodyScanForm } from './InbodyScanForm';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Sheet wrapper around the InBody scan entry form. Reuses the same form
 * component as the standalone /measurements/inbody/new page, so a single
 * source of truth governs the inputs + submit logic.
 */
export function InbodyScanSheet({ open, onClose }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title="New InBody Scan" height="90vh">
      <InbodyScanForm variant="sheet" onSaved={onClose} />
    </Sheet>
  );
}
