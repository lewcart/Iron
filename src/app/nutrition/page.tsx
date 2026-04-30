import { redirect } from 'next/navigation';

/**
 * `/nutrition` redirects to the new daily-logging surface. The Week template
 * editor lives at `/nutrition/week` (still served by the legacy 937-line
 * component for now; carries hydration + day-notes editing as a back door).
 *
 * Killing the legacy component fully is queued in TODOS.md once the new
 * Today page absorbs hydration logging.
 */
export default function NutritionRedirect() {
  redirect('/nutrition/today');
}
