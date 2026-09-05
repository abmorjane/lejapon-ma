/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";

export type OperationalRoomingOccupant = {
  assignment: any;
  participant: any;
  booking: any | null;
};

export type OperationalRoomingRoom = {
  room: any;
  roomOrder: number;
  roomLabel: string;
  occupants: OperationalRoomingOccupant[];
  capacity: number;
  occupiedCount: number;
  freePlaces: number;
};

export type OperationalRoomingHotelStay = {
  hotel: any;
  rooms: OperationalRoomingRoom[];
  participants: any[];
  occupants: OperationalRoomingOccupant[];
  diagnostics: {
    totalTripParticipants: number;
    assignedParticipants: number;
    roomCount: number;
    completeRoomCount: number;
    freePlaces: number;
    emptyRoomCount: number;
  };
};

export type OperationalRoomingData = {
  hotels: any[];
  bookings: any[];
  participants: any[];
  rooms: any[];
  assignments: any[];
  stays: OperationalRoomingHotelStay[];
};

export const roomLabel = (room: any) => String(room?.room_number ?? room?.room_name ?? "").trim();

const roomNumberValue = (room: any) => {
  const match = roomLabel(room).match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : Number.POSITIVE_INFINITY;
};

export const compareRoomsNaturally = (a: any, b: any) => {
  const numericDiff = roomNumberValue(a) - roomNumberValue(b);
  if (numericDiff !== 0 && Number.isFinite(numericDiff)) return numericDiff;
  return roomLabel(a).localeCompare(roomLabel(b), "fr", { numeric: true, sensitivity: "base" })
    || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
    || String(a.id ?? "").localeCompare(String(b.id ?? ""));
};

export const sortRoomsNaturally = (roomList: any[]) => [...roomList].sort(compareRoomsNaturally);

export async function loadOperationalRoomingForTrip(tripId: string): Promise<OperationalRoomingData> {
  const [{ data: hotels, error: hotelsError }, { data: bookings, error: bookingsError }] = await Promise.all([
    supabase
      .from("trip_hotels")
      .select("*")
      .eq("trip_id", tripId)
      .order("sort_order")
      .order("check_in"),
    supabase
      .from("bookings")
      .select("id,reference,contact_name,status,trip_id")
      .eq("trip_id", tripId),
  ]);

  if (hotelsError) throw hotelsError;
  if (bookingsError) throw bookingsError;

  const hotelRows = hotels ?? [];
  const bookingRows = bookings ?? [];
  const hotelIds = hotelRows.map((hotel: any) => hotel.id).filter(Boolean);
  const bookingIds = bookingRows.map((booking: any) => booking.id).filter(Boolean);

  const [{ data: rooms, error: roomsError }, { data: participants, error: participantsError }] = await Promise.all([
    hotelIds.length
      ? supabase.from("trip_rooms").select("*").in("trip_hotel_id", hotelIds)
      : Promise.resolve({ data: [], error: null } as any),
    bookingIds.length
      ? supabase.from("booking_participants").select("*").in("booking_id", bookingIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (roomsError) throw roomsError;
  if (participantsError) throw participantsError;

  const roomRows = rooms ?? [];
  const roomIds = roomRows.map((room: any) => room.id).filter(Boolean);
  const { data: assignments, error: assignmentsError } = roomIds.length
    ? await supabase.from("room_assignments").select("*").in("room_id", roomIds)
    : ({ data: [], error: null } as any);

  if (assignmentsError) throw assignmentsError;

  const assignmentRows = assignments ?? [];
  const bookingById = new Map(bookingRows.map((booking: any) => [booking.id, booking]));
  const participantById = new Map((participants ?? []).map((participant: any) => [participant.id, participant]));
  const assignmentsByRoomId = new Map<string, any[]>();
  for (const assignment of assignmentRows) {
    const list = assignmentsByRoomId.get(assignment.room_id) ?? [];
    list.push(assignment);
    assignmentsByRoomId.set(assignment.room_id, list);
  }

  const stays = hotelRows.map((hotel: any) => {
    const hotelRooms = sortRoomsNaturally(roomRows.filter((room: any) => room.trip_hotel_id === hotel.id));
    const roomModels = hotelRooms.map((room: any, index: number) => {
      const occupants = (assignmentsByRoomId.get(room.id) ?? [])
        .map((assignment: any) => {
          const participant = participantById.get(assignment.participant_id);
          if (!participant) return null;
          return {
            assignment,
            participant,
            booking: bookingById.get(participant.booking_id) ?? null,
          };
        })
        .filter(Boolean) as OperationalRoomingOccupant[];
      const capacity = Math.max(0, Number(room.capacity ?? 0) || 0);
      const occupiedCount = occupants.length;
      return {
        room,
        roomOrder: index + 1,
        roomLabel: roomLabel(room) || String(index + 1),
        occupants,
        capacity,
        occupiedCount,
        freePlaces: Math.max(0, capacity - occupiedCount),
      };
    });
    const occupants = roomModels.flatMap((room) => room.occupants);
    const participantsForHotel = Array.from(new Map(occupants.map((occupant) => [occupant.participant.id, occupant.participant])).values());
    const completeRoomCount = roomModels.filter((room) => room.capacity > 0 && room.occupiedCount >= room.capacity).length;
    const freePlaces = roomModels.reduce((sum, room) => sum + room.freePlaces, 0);
    return {
      hotel,
      rooms: roomModels,
      occupants,
      participants: participantsForHotel,
      diagnostics: {
        totalTripParticipants: participants?.length ?? 0,
        assignedParticipants: participantsForHotel.length,
        roomCount: roomModels.length,
        completeRoomCount,
        freePlaces,
        emptyRoomCount: roomModels.filter((room) => room.occupiedCount === 0).length,
      },
    };
  });

  return {
    hotels: hotelRows,
    bookings: bookingRows,
    participants: participants ?? [],
    rooms: roomRows,
    assignments: assignmentRows,
    stays,
  };
}

