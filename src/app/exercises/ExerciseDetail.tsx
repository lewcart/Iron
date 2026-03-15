'use client';

import { ChevronLeft } from 'lucide-react';
import type { Exercise } from '@/types';

export default function ExerciseDetail({
  exercise,
  onBack,
}: {
  exercise: Exercise;
  onBack: () => void;
}) {
  return (
    <main className="tab-content bg-background">
      {/* Nav bar */}
      <div className="flex items-center gap-2 px-4 pt-14 pb-3 border-b border-border">
        <button onClick={onBack} className="flex items-center gap-1 text-primary font-medium text-base">
          <ChevronLeft className="h-5 w-5" />
          Back
        </button>
      </div>

      <div className="px-4 py-4 space-y-4">
        <h1 className="text-xl font-bold">{exercise.title}</h1>

        {/* Description */}
        {exercise.description && (
          <div className="ios-section p-4">
            <p className="text-sm text-foreground leading-relaxed">{exercise.description}</p>
          </div>
        )}

        {/* Muscles */}
        {(exercise.primary_muscles.length > 0 || exercise.secondary_muscles.length > 0) && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Muscles</p>
            <div className="ios-section">
              {exercise.primary_muscles.map(m => (
                <div key={m} className="ios-row">
                  <span className="flex-1 text-sm capitalize">{m}</span>
                  <span className="text-xs text-muted-foreground">Primary</span>
                </div>
              ))}
              {exercise.secondary_muscles.map(m => (
                <div key={m} className="ios-row">
                  <span className="flex-1 text-sm capitalize">{m}</span>
                  <span className="text-xs text-muted-foreground">Secondary</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Equipment */}
        {exercise.equipment.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Equipment</p>
            <div className="ios-section">
              {exercise.equipment.map(eq => (
                <div key={eq} className="ios-row">
                  <span className="text-sm capitalize">{eq}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Steps */}
        {exercise.steps.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Steps</p>
            <div className="ios-section">
              {exercise.steps.map((step, i) => (
                <div key={i} className="ios-row gap-3">
                  <span className="text-xs font-bold text-primary w-5 text-center flex-shrink-0">{i + 1}</span>
                  <p className="text-sm flex-1 leading-snug">{step}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tips */}
        {exercise.tips.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Tips</p>
            <div className="ios-section">
              {exercise.tips.map((tip, i) => (
                <div key={i} className="ios-row">
                  <p className="text-sm flex-1 leading-snug">{tip}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Also known as */}
        {exercise.alias.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Also Known As</p>
            <div className="ios-section">
              {exercise.alias.map((a, i) => (
                <div key={i} className="ios-row">
                  <span className="text-sm">{a}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
