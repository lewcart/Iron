import { NutritionSubNav } from './NutritionSubNav';

export default function NutritionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <NutritionSubNav />
      {children}
    </div>
  );
}
