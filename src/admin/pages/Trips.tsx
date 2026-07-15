import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TripsCatalog from "./trips/TripsCatalog";
import TripsManagement from "./trips/TripsManagement";
import AccommodationTemplates from "./trips/AccommodationTemplates";
import { TripOperationsChecklistView } from "./trips/TripOperationsChecklistView";

export default function Trips() {
  return (
    <Tabs defaultValue="catalog" className="w-full">
      <TabsList className="mb-5 grid h-12 w-full grid-cols-4 rounded-2xl md:w-auto">
        <TabsTrigger value="catalog" className="min-h-10 rounded-xl text-xs sm:text-sm">Affiche</TabsTrigger>
        <TabsTrigger value="management" className="min-h-10 rounded-xl text-xs sm:text-sm">Opérations</TabsTrigger>
        <TabsTrigger value="checklists" className="min-h-10 rounded-xl text-xs sm:text-sm">Checklists</TabsTrigger>
        <TabsTrigger value="accommodation" className="min-h-10 rounded-xl text-xs sm:text-sm">Modèles d'hébergement</TabsTrigger>
      </TabsList>
      <TabsContent value="catalog" className="mt-0">
        <TripsCatalog />
      </TabsContent>
      <TabsContent value="management" className="mt-0">
        <TripsManagement />
      </TabsContent>
      <TabsContent value="checklists" className="mt-0">
        <TripOperationsChecklistView />
      </TabsContent>
      <TabsContent value="accommodation" className="mt-0">
        <AccommodationTemplates />
      </TabsContent>
    </Tabs>
  );
}
