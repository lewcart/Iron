import {
  Activity,
  Bike,
  Dog,
  Dumbbell,
  Flower2,
  Footprints,
  Mountain,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface WorkoutStyle {
  Icon: LucideIcon;
  iconClass: string;
  bgClass: string;
}

const STRENGTH_PURPLE: WorkoutStyle = {
  Icon: Dumbbell,
  iconClass: 'text-purple-300',
  bgClass: 'bg-purple-500/15',
};

const STRENGTH_VIOLET: WorkoutStyle = {
  Icon: Dumbbell,
  iconClass: 'text-violet-300',
  bgClass: 'bg-violet-500/15',
};

const HIIT_FUCHSIA: WorkoutStyle = {
  Icon: Zap,
  iconClass: 'text-fuchsia-300',
  bgClass: 'bg-fuchsia-500/15',
};

const CARDIO_SKY_WALK: WorkoutStyle = {
  Icon: Footprints,
  iconClass: 'text-sky-300',
  bgClass: 'bg-sky-500/15',
};

const CARDIO_SKY_HIKE: WorkoutStyle = {
  Icon: Mountain,
  iconClass: 'text-sky-300',
  bgClass: 'bg-sky-500/15',
};

const CARDIO_BLUE_RUN: WorkoutStyle = {
  Icon: Activity,
  iconClass: 'text-blue-300',
  bgClass: 'bg-blue-500/15',
};

const CARDIO_BLUE_DEFAULT: WorkoutStyle = {
  Icon: Activity,
  iconClass: 'text-blue-300',
  bgClass: 'bg-blue-500/15',
};

const CARDIO_CYAN_BIKE: WorkoutStyle = {
  Icon: Bike,
  iconClass: 'text-cyan-300',
  bgClass: 'bg-cyan-500/15',
};

const CARDIO_CYAN_ROW: WorkoutStyle = {
  Icon: Waves,
  iconClass: 'text-cyan-300',
  bgClass: 'bg-cyan-500/15',
};

const CARDIO_TEAL_SWIM: WorkoutStyle = {
  Icon: Waves,
  iconClass: 'text-teal-300',
  bgClass: 'bg-teal-500/15',
};

const RECOVERY_ROSE_DOG: WorkoutStyle = {
  Icon: Dog,
  iconClass: 'text-rose-300',
  bgClass: 'bg-rose-500/15',
};

const RECOVERY_PINK_YOGA: WorkoutStyle = {
  Icon: Flower2,
  iconClass: 'text-pink-300',
  bgClass: 'bg-pink-500/15',
};

const STYLE_MAP: Record<string, WorkoutStyle> = {
  'Strength Training': STRENGTH_PURPLE,
  'Functional Strength': STRENGTH_VIOLET,
  'Core Training': STRENGTH_VIOLET,
  'HIIT': HIIT_FUCHSIA,
  'Walking': CARDIO_SKY_WALK,
  'Hiking': CARDIO_SKY_HIKE,
  'Running': CARDIO_BLUE_RUN,
  'Elliptical': CARDIO_BLUE_DEFAULT,
  'Mixed Cardio': CARDIO_BLUE_DEFAULT,
  'Cross Training': CARDIO_BLUE_DEFAULT,
  'Workout': CARDIO_BLUE_DEFAULT,
  'Cycling': CARDIO_CYAN_BIKE,
  'Rowing': CARDIO_CYAN_ROW,
  'Swimming': CARDIO_TEAL_SWIM,
  'Dog Walk': RECOVERY_ROSE_DOG,
  'Yoga': RECOVERY_PINK_YOGA,
};

export function workoutStyle(activityType: string): WorkoutStyle {
  return STYLE_MAP[activityType] ?? CARDIO_BLUE_DEFAULT;
}
