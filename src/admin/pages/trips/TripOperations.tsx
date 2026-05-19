import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDate } from "@/lib/format";
import OpsParticipants from "./ops/OpsParticipants";
import OpsRooms from "./ops/OpsRooms";
import OpsActivities from "./ops/OpsActivities";
import OpsPayments from "./ops/OpsPayments";
import OpsJapanPayments from "./ops/OpsJapanPayments";
import OpsSummary from "./ops/OpsSummary";

export default function TripOperations({ trip }: { trip: any }) {
  return (
    <div>
      <div className="bg-background rounded-2xl border border-border p-5 mb-6">
        <div className="flex items-center gap-2 mb-1">
          {trip.label && <span className="text-xs font-bold tracking-wider text-accent">{trip.label}</span>}
          {trip.season && <span className="text-xs text-muted-foreground">• {trip.season}</span>}
        </div>
        <h2 className="font-display text-2xl">{trip.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {fmtDate(trip.start_date)} → {fmtDate(trip.end_date)} · {trip.slots_left}/{trip.total_slots} places restantes
        </p>
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
