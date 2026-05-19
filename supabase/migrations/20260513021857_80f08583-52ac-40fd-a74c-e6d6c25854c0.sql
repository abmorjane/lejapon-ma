
-- Enum for FAQ categories
DO $$ BEGIN
  CREATE TYPE public.faq_category AS ENUM ('voyage','prix_reservation','visa','organisation','conseils_pratiques');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category public.faq_category NOT NULL DEFAULT 'voyage',
  question_fr text NOT NULL,
  answer_fr text NOT NULL,
  question_en text,
  answer_en text,
  question_ar text,
  answer_ar text,
  meta_title_fr text,
  meta_description_fr text,
  meta_title_en text,
  meta_description_en text,
  meta_title_ar text,
  meta_description_ar text,
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read published faqs" ON public.faqs;
CREATE POLICY "public read published faqs" ON public.faqs
  FOR SELECT USING (is_published = true OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage faqs" ON public.faqs;
CREATE POLICY "staff manage faqs" ON public.faqs
  FOR ALL USING (
    public.has_any_role(auth.uid(), ARRAY['super_admin','admin','content_manager']::app_role[])
  ) WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['super_admin','admin','content_manager']::app_role[])
  );

DROP TRIGGER IF EXISTS faqs_set_updated_at ON public.faqs;
CREATE TRIGGER faqs_set_updated_at BEFORE UPDATE ON public.faqs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS faqs_sort_idx ON public.faqs (sort_order, created_at);
CREATE INDEX IF NOT EXISTS faqs_category_idx ON public.faqs (category);

-- Seed initial FR FAQs (only if table is empty)
INSERT INTO public.faqs (category, question_fr, answer_fr, sort_order)
SELECT * FROM (VALUES
  ('voyage'::public.faq_category, 'Le voyage est pour combien de jours ?',
   '15 jours, 8 jours à Tokyo et 7 jours dans la région Kansai entre Kyoto, Hiroshima et Osaka.', 10),
  ('voyage', 'Quelles sont les dates du voyage ?',
   E'Pour la saison printanière, le départ est entre le 15 et le 20 mars, et le retour entre le 1er et le 5 avril.\n\nPour la saison estivale, le départ est entre le 6 et le 22 juillet, et le retour entre le 20 juillet et le 9 août.\n\nPour la saison d''automne, le départ est entre le 20 octobre et le 9 novembre, et le retour entre le 9 et le 24 novembre.', 20),
  ('voyage', 'On va partir avec quelle compagnie aérienne ?',
   E'Il n''y a pas de vol direct du Maroc vers le Japon. Nous avons sélectionné le meilleur service aérien avec le minimum de temps d''escale possible : départ de Casablanca à destination de Tokyo avec Emirates ou Etihad.', 30),
  ('voyage', 'Quels sont les endroits que l''on va visiter ?',
   E'8 jours pour visiter Tokyo et ses environs (Asakusa, Shinjuku, Shibuya, Odaiba, Akihabara, Kamakura, Mont Fuji…) et 7 jours pour découvrir la région du Kansai (Kyoto, Osaka, Nara et Hiroshima).', 40),
  ('organisation', 'Quel type d''hôtels ?',
   E'À Tokyo, hôtel 4★ devant la gare de Shinagawa. À Kyoto, hôtel 4★ sur la fameuse avenue Gion « Shijo dori ». À Osaka, hôtel 4★ devant la gare principale d''Umeda. Tous les hôtels sont choisis pour la qualité de leurs prestations et pour leur emplacement stratégique, accessible facilement en transport en commun.', 50),
  ('prix_reservation', 'Qu''est-ce qui est compris dans le prix du voyage ?',
   E'Le prix comprend vos transferts, votre logement, votre transport, vos visites et vos repas (petit-déjeuners et déjeuners mentionnés dans le programme).\n\nLes frais du voyage sont des frais de groupe : si vous souhaitez profiter d''une journée ou deux en dehors du programme, nous ne pourrons pas prendre en charge vos dépenses.', 60),
  ('organisation', 'Quel moyen de transport entre les villes ?',
   E'Les transports entre les villes se font par Shinkansen (TGV).\n\nPour un maximum de confort, vous avez la possibilité d''envoyer votre bagage d''un hôtel à l''autre par voie express, à un prix variant entre 150 MAD et 300 MAD par valise et par envoi (Tokyo → Kyoto : 150 MAD, Kyoto → Osaka : 150 MAD, Osaka → aéroport de Tokyo : 300 MAD).\n\nCes frais ne sont pas inclus dans le prix total du voyage. Vous pouvez les régler à l''avance lors de votre inscription, ou directement sur place à la réception de l''hôtel.', 70),
  ('prix_reservation', 'Comment puis-je faire ma réservation ?',
   E'Si vous êtes intéressé par ce voyage, remplissez le formulaire d''inscription et effectuez un premier paiement de 50 % du prix total (le prix vous correspondant s''affiche à la fin du formulaire). Le reliquat est à payer après réception du visa.', 80),
  ('prix_reservation', 'Le prix de ma réservation peut-il changer ?',
   E'Oui. Si vous ne réglez pas une avance de 50 % du total du prix du voyage, vous pouvez recevoir une notification par e-mail vous informant d''une augmentation du prix de votre réservation.', 90),
  ('prix_reservation', 'Puis-je bénéficier d''une réduction ?',
   E'Oui. Vous bénéficiez d''une réduction de 2 % sur le prix total de votre réservation (hors activités) si vous validez votre réservation par le règlement de la somme totale du voyage 6 mois avant le départ.', 100),
  ('prix_reservation', 'Si j''annule mon voyage, puis-je récupérer mon argent ?',
   E'Jusqu''à 3 mois avant la date du voyage, vous pouvez récupérer la totalité de vos paiements. Deux mois avant la date, vous pouvez récupérer 50 % de vos paiements. Au-delà, le voyage est confirmé et il ne sera plus possible de vous rembourser.', 110),
  ('visa', 'Ai-je besoin d''un visa pour aller au Japon ?',
   E'Si vous êtes de nationalité marocaine, oui. Notre équipe se charge de déposer votre dossier à l''ambassade du Japon à Rabat. Le délai est de deux semaines à partir du jour du dépôt. Le coût est de 215 MAD à payer sur place.', 120),
  ('visa', 'Quels sont les documents nécessaires pour la demande de visa ?',
   E'Documents à fournir :\n1. Votre passeport\n2. Une photocopie de votre CIN (pas besoin qu''elle soit légalisée)\n3. Un formulaire à remplir\n4. Une photo avec un fond blanc\n5. Les 3 derniers relevés bancaires\n\nDes documents supplémentaires peuvent être demandés selon l''âge ou le métier du participant. Nous vous contacterons par e-mail ou par téléphone si nécessaire.', 130),
  ('visa', 'Quand puis-je vous envoyer mon dossier visa ?',
   'Vous pouvez nous envoyer votre dossier après confirmation du virement d''inscription au voyage.', 140),
  ('prix_reservation', 'Puis-je faire une réservation de dernière minute ?',
   E'Oui, dans la limite des places disponibles. Il faut prévoir une augmentation du prix du voyage de 10 % à 20 % à partir de deux mois avant la date du voyage.', 150),
  ('organisation', 'Combien y a-t-il de participants par voyage ?',
   E'Le nombre de participants varie entre 16 et 30 personnes par voyage. Si vous parrainez ce voyage avec un proche, vous pouvez demander une réduction de 2 % (dans la limite du possible) sur le total du prix du voyage, hors activités. (Offres non cumulables.)', 160),
  ('conseils_pratiques', 'Aurai-je besoin d''argent de poche, et combien ?',
   E'Le Japon est une destination lointaine et exotique : vous trouverez beaucoup de choses intéressantes. Pour un petit budget, 500 € suffisent pour de petits plaisirs. Pour un budget moyen à grand, prévoyez 1 000 € et plus par personne.', 170),
  ('organisation', 'Je ne vis pas au Maroc, puis-je participer ?',
   E'Oui. Faites-nous une demande par e-mail pour solliciter le prix du voyage hors vol. Un responsable vous accompagnera pour trouver un vol adéquat au départ du pays où vous vous trouvez, qui correspond aux dates du programme.', 180)
) AS v(category, question_fr, answer_fr, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.faqs);
