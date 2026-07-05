create table if not exists public.travel_agreements (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  trip_id uuid references public.trips(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','sent','opened','accepted','declined','needs_review')),
  secure_token text not null unique default (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  ),
  client_name text,
  client_email text,
  booking_reference text,
  trip_title text,
  trip_start_date date,
  trip_end_date date,
  content jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  opened_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.travel_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.travel_agreements(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  client_email text,
  typed_name text not null,
  ip_address inet,
  user_agent text,
  status text not null default 'accepted' check (status in ('accepted','declined','needs_review')),
  message text,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create or replace function public.v2_is_staff(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_staff(_user_id);
$$;

create table if not exists public.travel_agreement_templates (
  id uuid primary key default gen_random_uuid(),
  language text not null default 'fr',
  version text not null default 'TRAVEL-AGREEMENT-FR-V2.0',
  title text not null default 'Texte standard accord de voyage',
  content jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists travel_agreement_acceptances_one_accepted
  on public.travel_agreement_acceptances (agreement_id)
  where status = 'accepted';

create unique index if not exists travel_agreement_templates_one_active_per_language
  on public.travel_agreement_templates (language)
  where is_active = true;

create index if not exists idx_travel_agreements_booking on public.travel_agreements(booking_id);
create index if not exists idx_travel_agreements_trip on public.travel_agreements(trip_id);
create index if not exists idx_travel_agreements_status_created on public.travel_agreements(status, created_at desc);
create index if not exists idx_travel_agreement_acceptances_agreement on public.travel_agreement_acceptances(agreement_id);
create index if not exists idx_travel_agreement_templates_active on public.travel_agreement_templates(language, is_active);

drop trigger if exists travel_agreements_updated_at on public.travel_agreements;
create trigger travel_agreements_updated_at
before update on public.travel_agreements
for each row execute function public.set_updated_at();

drop trigger if exists travel_agreement_templates_updated_at on public.travel_agreement_templates;
create trigger travel_agreement_templates_updated_at
before update on public.travel_agreement_templates
for each row execute function public.set_updated_at();

alter table public.travel_agreements enable row level security;
alter table public.travel_agreement_acceptances enable row level security;
alter table public.travel_agreement_templates enable row level security;

drop policy if exists "staff manage travel agreements" on public.travel_agreements;
create policy "staff manage travel agreements"
on public.travel_agreements
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "staff manage travel agreement acceptances" on public.travel_agreement_acceptances;
create policy "staff manage travel agreement acceptances"
on public.travel_agreement_acceptances
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "staff manage travel agreement templates" on public.travel_agreement_templates;
create policy "staff manage travel agreement templates"
on public.travel_agreement_templates
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

-- Public clients do not read tables directly. The Edge Function uses this token
-- to expose one agreement and to store acceptance metadata with IP/user-agent.

insert into public.travel_agreement_templates (language, version, title, content, is_active)
values (
  'fr',
  'TRAVEL-AGREEMENT-FR-V2.0',
  'Texte standard accord de voyage',
  $json$
  {
    "sections": [
      {"key":"object","title":"Objet de l’accord","body":"Le Participant confirme sa participation au voyage organisé par l'Agence et reconnaît avoir pris connaissance des informations relatives au séjour, aux prestations prévues et aux règles nécessaires au bon déroulement du voyage.\n\nLe présent accord complète les informations, programmes et documents de voyage communiqués au Participant."},
      {"key":"organization_rules","title":"Organisation et règles du voyage","body":"Le Participant s'engage à contribuer au bon déroulement du voyage et à adopter un comportement respectueux envers les autres participants, les accompagnateurs, les guides et les prestataires.\n\nIl s'engage à respecter les horaires et lieux de rendez-vous communiqués, les temps prévus pour les visites et activités, les consignes opérationnelles et de sécurité, ainsi que les lois et règlements du pays visité.\n\nTout transport ou service manqué en raison d'un retard personnel peut entraîner des frais supplémentaires qui restent à la charge du Participant."},
      {"key":"luggage","title":"Bagages et transferts de bagages","body":"Lorsque le programme prévoit l'envoi des bagages séparément lors d'un déplacement entre deux villes, le Participant s'engage à préparer ses bagages dans les délais communiqués par l'accompagnateur.\n\nLe délai de livraison dépend du transporteur utilisé et peut nécessiter une livraison le jour suivant."},
      {"key":"extras","title":"Activités et prestations supplémentaires","body":"Les activités supplémentaires ou options réservées en dehors des prestations incluses peuvent être soumises aux conditions d'annulation des prestataires concernés.\n\nLes frais de transport, repas, billets ou dépenses liés à une activité personnelle ou réalisée indépendamment du programme restent à la charge du Participant, sauf indication écrite contraire de l'Agence."},
      {"key":"food","title":"Alimentation","body":"Le Participant demeure responsable de ses choix alimentaires.\n\nL'Agence et ses accompagnateurs peuvent orienter le Participant vers des restaurants ou options alimentaires correspondant, dans la mesure du possible, à ses préférences ou contraintes. Toute allergie alimentaire connue ou contrainte importante doit être signalée à l'Agence avant le départ."},
      {"key":"health_insurance","title":"Santé et assurance","body":"Le Participant s'engage à informer l'Agence, avant le départ, de toute situation particulière susceptible d'avoir un impact significatif sur l'organisation ou sa participation aux activités prévues.\n\nLe Participant est responsable de prévoir les médicaments et traitements personnels nécessaires pendant le séjour. L'Agence recommande fortement la souscription d'une assurance voyage adaptée couvrant notamment les frais médicaux, l'assistance, le rapatriement, les bagages et, lorsque disponible, l'annulation."},
      {"key":"payment_cancellation","title":"Paiement et annulation","body":"Le montant du voyage et les paiements enregistrés sont indiqués dans le présent accord.\n\nLe Participant s'engage à respecter l'échéancier et les modalités de paiement communiqués par l'Agence. En cas d'annulation à son initiative, les sommes pouvant être retenues correspondent notamment aux frais et engagements déjà supportés par l'Agence auprès des compagnies aériennes, hôtels, transporteurs et autres prestataires."},
      {"key":"agency_commitments","title":"Engagements de l'Agence","body":"L'Agence s'engage à organiser et coordonner les prestations prévues conformément au programme et aux réservations confirmées.\n\nElle assure la coordination des prestations réservées, la transmission des informations nécessaires au voyage et une assistance avant et pendant le voyage dans le cadre des prestations organisées."},
      {"key":"independent_circumstances","title":"Circonstances indépendantes de l'Agence","body":"Certaines circonstances indépendantes de la volonté de l'Agence peuvent affecter le voyage, notamment les conditions météorologiques, décisions des autorités, perturbations aériennes ou ferroviaires, grèves, contraintes administratives, événements de sécurité ou autres circonstances exceptionnelles.\n\nLorsque ces événements surviennent, l'Agence met en œuvre les démarches raisonnablement possibles pour assister les Participants et adapter l'organisation."},
      {"key":"programme_changes","title":"Modification du programme","body":"L'Agence peut adapter l'ordre des visites, horaires, transports ou certaines prestations lorsque des contraintes opérationnelles, de sécurité ou des circonstances indépendantes de sa volonté le nécessitent.\n\nDans la mesure du possible, l'Agence privilégiera une solution ou prestation équivalente. Toute modification substantielle sera communiquée aux Participants dès que raisonnablement possible."},
      {"key":"acceptance","title":"Acceptation électronique","body":"En acceptant électroniquement le présent accord, le Participant confirme avoir lu l'intégralité du document, vérifié les informations relatives à son voyage, compris les prestations incluses et les éventuelles prestations supplémentaires, accepté les règles d'organisation du voyage et s'engage à respecter les présentes dispositions."}
    ]
  }
  $json$::jsonb,
  true
)
on conflict do nothing;

insert into public.email_templates (
  key, name, category, language, subject, html_body, body_html, preheader, body_text,
  allowed_variables, required_variables, is_active, is_system, metadata
)
values
(
  'travel_agreement_sent_client',
  'Accord de voyage envoyé client',
  'Accords de voyage',
  'fr',
  'Votre accord de voyage — {{trip_name}}',
  '<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ef;padding:24px;color:#171412"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eadfd7;border-radius:18px;padding:28px"><h1 style="margin:0 0 14px;color:#E21B2D">Votre accord de voyage</h1><p>Bonjour {{client_name}},</p><p>Votre accord de voyage pour <strong>{{trip_name}}</strong> est prêt.</p><p>Référence : <strong>{{booking_reference}}</strong></p><p><a href="{{agreement_link}}" style="display:inline-block;background:#E21B2D;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">LIRE ET ACCEPTER MON ACCORD DE VOYAGE</a></p><p style="font-size:13px;color:#746960">Merci de le lire attentivement avant le départ. Le lien est personnel et sécurisé.</p><p>L’équipe LeJapon.ma</p></div></div>',
  '<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ef;padding:24px;color:#171412"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eadfd7;border-radius:18px;padding:28px"><h1 style="margin:0 0 14px;color:#E21B2D">Votre accord de voyage</h1><p>Bonjour {{client_name}},</p><p>Votre accord de voyage pour <strong>{{trip_name}}</strong> est prêt.</p><p>Référence : <strong>{{booking_reference}}</strong></p><p><a href="{{agreement_link}}" style="display:inline-block;background:#E21B2D;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">LIRE ET ACCEPTER MON ACCORD DE VOYAGE</a></p><p style="font-size:13px;color:#746960">Merci de le lire attentivement avant le départ. Le lien est personnel et sécurisé.</p><p>L’équipe LeJapon.ma</p></div></div>',
  'Votre accord de voyage est prêt.',
  'Bonjour {{client_name}},

Votre accord de voyage pour {{trip_name}} est prêt.
Référence : {{booking_reference}}

Lire et accepter mon accord de voyage : {{agreement_link}}

L’équipe LeJapon.ma',
  '["client_name","participant_first_name","trip_title","trip_name","booking_reference","agreement_link"]'::jsonb,
  '["client_name","trip_name","agreement_link"]'::jsonb,
  true,
  true,
  '{"seeded_by":"20260704120000_travel_agreements_v1"}'::jsonb
),
(
  'travel_agreement_accepted_admin',
  'Accord de voyage accepté admin',
  'Accords de voyage',
  'fr',
  'Accord de voyage accepté — {{client_name}}',
  '<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ef;padding:24px;color:#171412"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eadfd7;border-radius:18px;padding:28px"><h1 style="margin:0 0 14px;color:#E21B2D">Accord de voyage accepté</h1><p><strong>{{client_name}}</strong> a accepté son accord de voyage.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 0;color:#746960">Référence</td><td><strong>{{booking_reference}}</strong></td></tr><tr><td style="padding:8px 0;color:#746960">Voyage</td><td><strong>{{trip_title}}</strong></td></tr><tr><td style="padding:8px 0;color:#746960">Nom saisi</td><td><strong>{{typed_name}}</strong></td></tr><tr><td style="padding:8px 0;color:#746960">Date</td><td><strong>{{accepted_at}}</strong></td></tr></table><p><a href="{{admin_link}}" style="display:inline-block;background:#E21B2D;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">Ouvrir dans l’admin</a></p></div></div>',
  '<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ef;padding:24px;color:#171412"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eadfd7;border-radius:18px;padding:28px"><h1 style="margin:0 0 14px;color:#E21B2D">Accord de voyage accepté</h1><p><strong>{{client_name}}</strong> a accepté son accord de voyage.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 0;color:#746960">Référence</td><td><strong>{{booking_reference}}</strong></td></tr><tr><td style="padding:8px 0;color:#746960">Voyage</td><td><strong>{{trip_title}}</strong></td></tr><tr><td style="padding:8px 0;color:#746960">Nom saisi</td><td><strong>{{typed_name}}</strong></td></tr><tr><td style="padding:8px 0;color:#746960">Date</td><td><strong>{{accepted_at}}</strong></td></tr></table><p><a href="{{admin_link}}" style="display:inline-block;background:#E21B2D;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">Ouvrir dans l’admin</a></p></div></div>',
  'Un accord de voyage a été accepté.',
  'Accord de voyage accepté

Client : {{client_name}}
Référence : {{booking_reference}}
Voyage : {{trip_title}}
Nom saisi : {{typed_name}}
Date : {{accepted_at}}
Admin : {{admin_link}}',
  '["client_name","booking_reference","trip_title","typed_name","accepted_at","admin_link"]'::jsonb,
  '["client_name","typed_name","accepted_at"]'::jsonb,
  true,
  true,
  '{"seeded_by":"20260704120000_travel_agreements_v1"}'::jsonb
),
(
  'travel_agreement_accepted_client',
  'Accord de voyage accepté client',
  'Accords de voyage',
  'fr',
  'Votre accord de voyage accepté — {{trip_name}}',
  '<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ef;padding:24px;color:#171412"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eadfd7;border-radius:18px;padding:28px"><h1 style="margin:0 0 14px;color:#E21B2D">Accord de voyage accepté</h1><p>Bonjour {{client_name}},</p><p>Votre accord de voyage pour <strong>{{trip_name}}</strong> a bien été accepté le <strong>{{accepted_at}}</strong>.</p><p>Nom saisi : <strong>{{typed_name}}</strong></p><p>Passeport : <strong>{{passport_number}}</strong></p><p>Le PDF final accepté est joint à cet email.</p><p><a href="{{agreement_link}}" style="display:inline-block;background:#E21B2D;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">Relire / télécharger mon accord</a></p><p>L’équipe LeJapon.ma</p></div></div>',
  '<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ef;padding:24px;color:#171412"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eadfd7;border-radius:18px;padding:28px"><h1 style="margin:0 0 14px;color:#E21B2D">Accord de voyage accepté</h1><p>Bonjour {{client_name}},</p><p>Votre accord de voyage pour <strong>{{trip_name}}</strong> a bien été accepté le <strong>{{accepted_at}}</strong>.</p><p>Nom saisi : <strong>{{typed_name}}</strong></p><p>Passeport : <strong>{{passport_number}}</strong></p><p>Le PDF final accepté est joint à cet email.</p><p><a href="{{agreement_link}}" style="display:inline-block;background:#E21B2D;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">Relire / télécharger mon accord</a></p><p>L’équipe LeJapon.ma</p></div></div>',
  'Votre accord de voyage a bien été accepté.',
  'Bonjour {{client_name}},

Votre accord de voyage pour {{trip_name}} a bien été accepté le {{accepted_at}}.
Nom saisi : {{typed_name}}
Passeport : {{passport_number}}
Le PDF final accepté est joint à cet email.

Relire / télécharger mon accord : {{agreement_link}}

L’équipe LeJapon.ma',
  '["client_name","participant_first_name","booking_reference","trip_title","trip_name","typed_name","passport_number","accepted_at","agreement_link"]'::jsonb,
  '["client_name","trip_name","typed_name","accepted_at","agreement_link"]'::jsonb,
  true,
  true,
  '{"seeded_by":"20260704120000_travel_agreements_v1"}'::jsonb
)
on conflict (key, language) do update set
  name = excluded.name,
  category = excluded.category,
  subject = excluded.subject,
  html_body = excluded.html_body,
  body_html = excluded.body_html,
  preheader = excluded.preheader,
  body_text = excluded.body_text,
  allowed_variables = excluded.allowed_variables,
  required_variables = excluded.required_variables,
  is_active = excluded.is_active,
  is_system = excluded.is_system,
  metadata = coalesce(public.email_templates.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

notify pgrst, 'reload schema';
