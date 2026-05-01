'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { InbodyScanForm } from '../../InbodyScanForm';

export default function NewInbodyScanPage() {
  const router = useRouter();

  return (
    <main className="tab-content bg-background">
      <div className="max-w-md md:max-w-2xl mx-auto">
        <div className="px-4 pt-safe pb-4 flex items-center gap-3">
          <Link href="/measurements" className="text-primary p-1 -ml-1">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold">New InBody Scan</h1>
        </div>

        <InbodyScanForm
          variant="page"
          onSaved={() => router.push('/measurements?tab=inbody')}
        />
      </div>
    </main>
  );
}
