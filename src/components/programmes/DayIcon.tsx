import {
  Bus,
  TrainFront,
  Train,
  Plane,
  UserRound,
  Utensils,
  BedDouble,
  Coffee,
  Sparkles,
  Footprints,
  Ship,
} from "lucide-react";

const MAP: Record<string, any> = {
  bus: Bus,
  train: TrainFront,
  shinkansen: Train,
  plane: Plane,
  guide: UserRound,
  meal: Utensils,
  hotel: BedDouble,
  free: Coffee,
  option: Sparkles,
  walk: Footprints,
  boat: Ship,
};

export function DayIcon({ id, className }: { id: string; className?: string }) {
  const Comp = MAP[id] ?? Sparkles;
  return <Comp className={className} />;
}

export { MAP as DAY_ICON_MAP };