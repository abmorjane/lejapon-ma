import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TripsCatalog from "./trips/TripsCatalog";
import TripsManagement from "./trips/TripsManagement";

export default function Trips() {
  return (
    <Tabs defaultValue="catalog" className="w-full">
      <TabsList className="mb-6">
        <TabsTrigger value="catalog">Voyages à l'affiche</TabsTrigger>
        <TabsTrigger value="management">Gestion des voyages</TabsTrigger>
      </TabsList>
      <TabsContent value="catalog" className="mt-0">
        <TripsCatalog />
      </TabsContent>
      <TabsContent value="management" className="mt-0">
        <TripsManagement />
      </TabsContent>
    </Tabs>
  );
}
