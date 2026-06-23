type ClientLike = {
  id?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  passport_number?: string | null;
};

type ParticipantLike = {
  id?: string | null;
  client_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  passport_no?: string | null;
};

export const normalizeParticipantText = (value?: string | null) =>
  String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");

export const normalizeParticipantPhone = (value?: string | null) =>
  String(value ?? "").replace(/[^\d+]/g, "");

export const normalizeParticipantPassport = (value?: string | null) =>
  String(value ?? "").replace(/[\s-]+/g, "").toUpperCase();

export const findMatchingParticipantForClient = (
  participants: ParticipantLike[],
  selected: ClientLike,
) => {
  const selectedName = normalizeParticipantText(selected.full_name);
  const selectedEmail = String(selected.email ?? "").trim().toLowerCase();
  const selectedPhone = normalizeParticipantPhone(selected.phone);
  const selectedPassport = normalizeParticipantPassport(selected.passport_number);

  return participants.find((participant) => {
    const participantName = normalizeParticipantText(`${participant.first_name ?? ""} ${participant.last_name ?? ""}`);
    const participantEmail = String(participant.email ?? "").trim().toLowerCase();
    const participantPhone = normalizeParticipantPhone(participant.phone);
    const participantPassport = normalizeParticipantPassport(participant.passport_no);
    const samePassport = Boolean(selectedPassport && participantPassport === selectedPassport);
    const sameEmail = Boolean(selectedEmail && participantEmail === selectedEmail);
    const samePhone = Boolean(selectedPhone && participantPhone === selectedPhone);
    const sameNameAndContact = Boolean(selectedName && participantName === selectedName && (sameEmail || samePhone));
    return samePassport || sameNameAndContact;
  });
};

export const getTravelerCounters = (expectedTravelers: number, visibleCount: number, storedCount: number) => {
  const safeExpected = Math.max(0, Number(expectedTravelers || 0));
  const safeVisible = Math.max(0, Number(visibleCount || 0));
  const safeStored = Math.max(0, Number(storedCount || 0));
  return {
    expected: safeExpected,
    visible: safeVisible,
    stored: safeStored,
    remaining: Math.max(0, safeExpected - safeStored),
    overflow: safeStored > safeExpected,
  };
};
