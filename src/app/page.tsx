import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dumbbell, History, ListChecks } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-12 text-center">
          <h1 className="text-5xl font-bold mb-4 flex items-center justify-center gap-3">
            <Dumbbell className="h-12 w-12" />
            Iron
          </h1>
          <p className="text-xl text-muted-foreground">CLI-first workout tracker</p>
        </div>

        <div className="grid gap-6 md:grid-cols-3 mb-12">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Dumbbell className="h-5 w-5" />
                Workout
              </CardTitle>
              <CardDescription>Start or continue your workout</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/workout">
                <Button className="w-full">Go to Workout</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-5 w-5" />
                Exercises
              </CardTitle>
              <CardDescription>Browse exercise library</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/exercises">
                <Button variant="outline" className="w-full">View Exercises</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                History
              </CardTitle>
              <CardDescription>View past workouts</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/history">
                <Button variant="outline" className="w-full">View History</Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-slate-900 text-slate-50 border-slate-800">
          <CardHeader>
            <CardTitle>CLI Commands</CardTitle>
            <CardDescription className="text-slate-400">
              Access all features from the terminal
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 font-mono text-sm">
            <div className="bg-slate-800 p-3 rounded">
              <code>npm run cli -- list-exercises</code>
            </div>
            <div className="bg-slate-800 p-3 rounded">
              <code>npm run cli -- start-workout</code>
            </div>
            <div className="bg-slate-800 p-3 rounded">
              <code>npm run cli -- list-workouts</code>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
