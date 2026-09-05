import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";
import OpsParticipants from "./ops/OpsParticipants";
import OpsRooms from "./ops/OpsRooms";
import OpsActivities from "./ops/OpsActivities";
import OpsPayments from "./ops/OpsPayments";
import OpsJapanPayments from "./ops/OpsJapanPayments";
import OpsSummary from "./ops/OpsSummary";
import { ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";

type TripOperationsTrip = {
  id: string;
  label?: string | null;
  season?: string | null;
  title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  slots_left?: number | null;
  total_slots?: number | null;
};

export default function TripOperations({ trip }: { trip: TripOperationsTrip }) {
  return (
    <div>
      <div className="bg-background rounded-2xl border border-border p-5 mb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {trip.label && <span className="text-xs font-bold tracking-wider text-accent">{trip.label}</span>}
              {trip.season && <span className="text-xs text-muted-foreground">• {trip.season}</span>}
            </div>
            <h2 className="font-display text-2xl">{trip.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {fmtDate(trip.start_date)} → {fmtDate(trip.end_date)} · {trip.slots_left}/{trip.total_slots} places restantes
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="min-h-10 sm:self-start">
            <Link to={`/admin/visa-group-submissions?trip=${trip.id}`}>
              <ClipboardList className="h-4 w-4" /> Voir les dépôts visa
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="participants">
        <TabsList className="mb-4 flex-wrap h-auto">
          <TabsTrigger value="participants">A. Inscrits</TabsTrigger>
          <TabsTrigger value="rooms">B. Chambres</TabsTrigger>
          <TabsTrigger value="activities">C. Activités</TabsTrigger>
          <TabsTrigger value="payments">D. Paiements clients</TabsTrigger>
          <TabsTrigger value="japan">E. Paiements Japon</TabsTrigger>
          <TabsTrigger value="summary">F. Résumé financier</TabsTrigger>
        </TabsList>
        <TabsContent value="participants"><OpsParticipants trip={trip} /></TabsContent>
        <TabsContent value="rooms"><OpsRooms trip={trip} /></TabsContent>
        <TabsContent value="activities"><OpsActivities trip={trip} /></TabsContent>
        <TabsContent value="payments"><OpsPayments trip={trip} /></TabsContent>
        <TabsContent value="japan"><OpsJapanPayments trip={trip} /></TabsContent>
        <TabsContent value="summary"><OpsSummary trip={trip} /></TabsContent>
      </Tabs>
    </div>
  );
}
