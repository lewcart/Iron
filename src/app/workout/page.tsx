'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Plus, Check, Dumbbell } from 'lucide-react';
import type { Workout, WorkoutExercise, WorkoutSet, Exercise } from '@/types';

interface WorkoutWithExercises extends Workout {
  exercises: (WorkoutExercise & {
    exercise: Exercise;
    sets: WorkoutSet[];
  })[];
}

export default function WorkoutPage() {
  const [workout, setWorkout] = useState<WorkoutWithExercises | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExercises, setShowExercises] = useState(false);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchCurrentWorkout();
  }, []);

  useEffect(() => {
    if (showExercises) {
      fetchExercises();
    }
  }, [showExercises, search]);

  const fetchCurrentWorkout = async () => {
    setLoading(true);
    const res = await fetch('/api/workouts?current=true');
    const data = await res.json();

    if (data) {
      const detailRes = await fetch(`/api/workouts/${data.uuid}`);
      const detailData = await detailRes.json();

      // Fetch exercise details and sets for each workout exercise
      const exercisesWithDetails = await Promise.all(
        detailData.exercises.map(async (we: WorkoutExercise) => {
          const [exerciseRes, setsRes] = await Promise.all([
            fetch(`/api/exercises?search=${we.exercise_uuid}`),
            fetch(`/api/workout-exercises/${we.uuid}/sets`)
          ]);
          const [exerciseData, setsData] = await Promise.all([
            exerciseRes.json(),
            setsRes.json()
          ]);
          return {
            ...we,
            exercise: exerciseData.find((e: Exercise) => e.uuid === we.exercise_uuid),
            sets: setsData
          };
        })
      );

      setWorkout({ ...detailData, exercises: exercisesWithDetails });
    }
    setLoading(false);
  };

  const fetchExercises = async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);

    const res = await fetch(`/api/exercises?${params}`);
    const data = await res.json();
    setExercises(data);
  };

  const startWorkout = async () => {
    const res = await fetch('/api/workouts', { method: 'POST' });
    const data = await res.json();
    await fetchCurrentWorkout();
  };

  const finishWorkout = async () => {
    if (!workout) return;

    await fetch(`/api/workouts/${workout.uuid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'finish' })
    });

    setWorkout(null);
  };

  const addExercise = async (exerciseUuid: string) => {
    if (!workout) return;

    await fetch(`/api/workouts/${workout.uuid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-exercise', exerciseUuid })
    });

    setShowExercises(false);
    await fetchCurrentWorkout();
  };

  const updateSet = async (workoutExerciseUuid: string, setUuid: string, weight: number, reps: number) => {
    await fetch(`/api/workout-exercises/${workoutExerciseUuid}/sets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setUuid,
        weight,
        repetitions: reps,
        isCompleted: true
      })
    });

    await fetchCurrentWorkout();
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-8">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </main>
    );
  }

  if (!workout) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-8">
        <div className="max-w-4xl mx-auto">
          <Link href="/">
            <Button variant="ghost" className="mb-8">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Button>
          </Link>

          <Card className="text-center">
            <CardHeader>
              <CardTitle className="text-3xl">No Active Workout</CardTitle>
              <CardDescription>Start a new workout to begin tracking</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={startWorkout} size="lg">
                <Dumbbell className="h-5 w-5 mr-2" />
                Start Workout
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (showExercises) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-8">
        <div className="max-w-4xl mx-auto">
          <Button variant="ghost" onClick={() => setShowExercises(false)} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Workout
          </Button>

          <h2 className="text-2xl font-bold mb-4">Add Exercise</h2>

          <Input
            placeholder="Search exercises..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-6"
          />

          <div className="grid gap-4">
            {exercises.map((exercise) => (
              <Card key={exercise.uuid} className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => addExercise(exercise.uuid)}>
                <CardHeader>
                  <CardTitle className="text-lg">{exercise.title}</CardTitle>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {exercise.primary_muscles.map((muscle) => (
                      <Badge key={muscle} variant="default" className="text-xs">
                        {muscle}
                      </Badge>
                    ))}
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-8">
      <div className="max-w-4xl mx-auto">
        <Link href="/">
          <Button variant="ghost" className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Button>
        </Link>

        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-4xl font-bold mb-2">Current Workout</h1>
            <p className="text-muted-foreground">
              Started {new Date(workout.start_time).toLocaleTimeString()}
            </p>
          </div>
          <Button onClick={finishWorkout} variant="destructive">
            Finish Workout
          </Button>
        </div>

        <div className="space-y-6">
          {workout.exercises.map((we) => (
            <Card key={we.uuid}>
              <CardHeader>
                <CardTitle>{we.exercise?.title || 'Unknown Exercise'}</CardTitle>
                <CardDescription>
                  {we.exercise?.primary_muscles.join(', ')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {we.sets.map((set, idx) => (
                    <SetRow
                      key={set.uuid}
                      setNumber={idx + 1}
                      set={set}
                      workoutExerciseUuid={we.uuid}
                      onUpdate={updateSet}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}

          <Button onClick={() => setShowExercises(true)} className="w-full" variant="outline" size="lg">
            <Plus className="h-5 w-5 mr-2" />
            Add Exercise
          </Button>
        </div>
      </div>
    </main>
  );
}

function SetRow({
  setNumber,
  set,
  workoutExerciseUuid,
  onUpdate
}: {
  setNumber: number;
  set: WorkoutSet;
  workoutExerciseUuid: string;
  onUpdate: (weUuid: string, setUuid: string, weight: number, reps: number) => Promise<void>;
}) {
  const [weight, setWeight] = useState(set.weight?.toString() || '');
  const [reps, setReps] = useState(set.repetitions?.toString() || '');

  const handleComplete = async () => {
    await onUpdate(
      workoutExerciseUuid,
      set.uuid,
      parseFloat(weight) || 0,
      parseInt(reps) || 0
    );
  };

  return (
    <div className="flex items-center gap-3">
      <div className="w-8 text-center font-bold text-muted-foreground">
        {setNumber}
      </div>
      <Input
        type="number"
        placeholder="Weight"
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        className="w-24"
      />
      <span className="text-muted-foreground">×</span>
      <Input
        type="number"
        placeholder="Reps"
        value={reps}
        onChange={(e) => setReps(e.target.value)}
        className="w-24"
      />
      <Button
        onClick={handleComplete}
        variant={set.is_completed ? "secondary" : "default"}
        size="sm"
      >
        <Check className="h-4 w-4" />
      </Button>
    </div>
  );
}
