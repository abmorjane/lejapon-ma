import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OperationChecklistPanel } from "@/admin/components/OperationChecklistPanel";

type TripOption = {
  id: string;
  title: string;
  season?: string | null;
  start_date?: string | null;
};

export function TripOperationsChecklistView() {
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [selectedTripId, setSelectedTripId] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("id,title,season,start_date")
        .order("start_date", { ascending: false })
        .limit(80);
      const rows = (data ?? []) as TripOption[];
      setTrips(rows);
      setSelectedTripId((current) => current || rows[0]?.id || "");
    })();
  }, []);

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId);

  return (
    <div className="space-y-5">
      <Card className="rounded-xl shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Checklists par voyage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xl">
            <Select value={selectedTripId || "none"} onValueChange={(value) => setSelectedTripId(value === "none" ? "" : value)}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un voyage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucun voyage</SelectItem>
                {trips.map((trip) => (
                  <SelectItem key={trip.id} value={trip.id}>
                    {[trip.title, trip.season, trip.start_date].filter(Boolean).join(" · ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedTripId ? (
        <OperationChecklistPanel
          title={`Checklist voyage · ${selectedTrip?.title ?? "Voyage"}`}
          description="Toutes les tâches opérationnelles rattachées aux réservations de ce voyage."
          tripId={selectedTripId}
        />
      ) : (
        <Card className="rounded-xl shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Sélectionnez un voyage pour afficher ses checklists.</CardContent>
        </Card>
      )}
    </div>
  );
}
