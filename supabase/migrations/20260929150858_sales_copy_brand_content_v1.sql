-- Sales Copy & Brand Value V1: editorial data only.
-- Prepared for review only. Do not apply during this integration phase.
-- No schema, booking, client, auth, or operational data changes.

begin;

do $sales_copy$
declare
  v_patches jsonb := $content$
  {
    "site:home": {
      "hero_badge": {"fr":"Voyages au Japon depuis le Maroc","en":"Japan journeys from Morocco","ar":"رحلات إلى اليابان من المغرب"},
      "hero_title_l1": {"fr":"Le Japon,","en":"Japan,","ar":"اليابان،"},
      "hero_title_l2": {"fr":"à vivre pleinement.","en":"yours to discover.","ar":"اكتشفها بطريقتك."},
      "hero_subtitle": {"fr":"Des circuits pensés avec soin, des découvertes à partager et la liberté de savourer le Japon à votre rythme.","en":"Thoughtfully planned routes, discoveries to share and room to enjoy Japan at your own pace.","ar":"مسارات مدروسة وتجارب تتشاركها مع الآخرين ووقت للاستمتاع باليابان على إيقاعك."},
      "hero_cta_primary": {"fr":"Imaginer mon voyage","en":"Plan my journey","ar":"خطط لرحلتي"},
      "hero_cta_secondary": {"fr":"Découvrir les départs","en":"Explore departures","ar":"اكتشف الرحلات"},
      "hero_trust_count": {"fr":"","en":"","ar":""},
      "hero_rating_value": {"fr":"","en":"","ar":""},
      "stat1_v": {"fr":"","en":"","ar":""},
      "stat2_v": {"fr":"","en":"","ar":""},
      "stat3_v": {"fr":"","en":"","ar":""},
      "stat4_v": {"fr":"","en":"","ar":""},
      "trips_title_main": {"fr":"Le Japon vous appelle,","en":"Japan is calling,","ar":"اليابان تناديك،"},
      "trips_title_accent": {"fr":"choisissez votre départ.","en":"choose your departure.","ar":"اختر موعد رحلتك."},
      "why_title_main": {"fr":"Votre Japon,","en":"Your Japan,","ar":"رحلتك إلى اليابان،"},
      "why_title_accent": {"fr":"avec le plaisir de se laisser guider.","en":"with thoughtful support.","ar":"برفقة فريق يهتم بالتفاصيل."},
      "why_intro": {"fr":"Une équipe attentive vous aide à choisir le bon départ et à profiter de chaque étape, sans renoncer à vos envies personnelles.","en":"Our team helps you choose the right departure and enjoy every stage while making room for your own interests.","ar":"نساعدك في اختيار الرحلة المناسبة والاستمتاع بكل محطة مع مساحة لرغباتك الخاصة."},
      "why1_t": {"fr":"Un itinéraire qui a du sens","en":"A meaningful route","ar":"مسار واضح"},
      "why1_d": {"fr":"Les villes, les visites et le rythme de chaque circuit sont présentés avant votre choix.","en":"Explore the cities, visits and pace of each trip before choosing.","ar":"تعرف على المدن والزيارات ووتيرة كل رحلة قبل الاختيار."},
      "why2_t": {"fr":"Le Japon vu de près","en":"Japan up close","ar":"معرفة باليابان"},
      "why2_d": {"fr":"Notre connaissance de la destination nourrit les étapes et les conseils que nous partageons.","en":"Our destination knowledge shapes the routes and advice we share.","ar":"توجه خبرتنا بالوجهة البرامج والنصائح التي نقدمها."},
      "why3_t": {"fr":"Du temps pour vous","en":"Time for yourself","ar":"وقت لنفسك"},
      "why3_d": {"fr":"Les moments libres prévus au programme laissent place à vos propres découvertes.","en":"Free moments in the programme make room for your discoveries.","ar":"تترك الفترات الحرة في البرنامج مساحة لاكتشافاتك."},
      "why4_t": {"fr":"Un choix en toute clarté","en":"A clear choice","ar":"اختيار بكل وضوح"},
      "why4_d": {"fr":"Comparez les départs, puis personnalisez votre demande selon vos envies.","en":"Compare departures and tailor your request to your preferences.","ar":"قارن الرحلات وخصص طلبك حسب رغباتك."},
      "step1_t": {"fr":"Choisissez votre départ","en":"Choose your departure","ar":"اختر رحلتك"},
      "step1_d": {"fr":"Choisissez votre départ et les options qui vous plaisent ; le montant estimé apparaît avant l'envoi.","en":"Choose a departure and optional experiences; see the estimate before sending your request.","ar":"اختر موعد الرحلة والخيارات التي تناسبك واطلع على السعر التقديري قبل الإرسال."},
      "step2_t": {"fr":"Parlons des détails","en":"Let's discuss the details","ar":"لنتحدث عن التفاصيل"},
      "step2_d": {"fr":"Notre équipe confirme avec vous les disponibilités et les conditions de réservation.","en":"Our team confirms availability and booking conditions with you.","ar":"يؤكد فريقنا معك التوفر وشروط الحجز."},
      "step3_t": {"fr":"Préparez le départ","en":"Get ready to go","ar":"استعد للسفر"},
      "step3_d": {"fr":"Préparez votre départ avec nos conseils, notamment pour votre dossier de visa.","en":"Prepare to leave with our advice, including support for your visa file.","ar":"استعد للسفر مع نصائحنا، بما في ذلك المساعدة في ملف التأشيرة."},
      "gua1_t": {"fr":"Un programme lisible","en":"A clear programme","ar":"برنامج واضح"},
      "gua1_d": {"fr":"Prestations et moments libres sont précisés pour le départ choisi.","en":"Services and free time are detailed for each departure.","ar":"تفاصيل الخدمات والوقت الحر لكل رحلة."},
      "gua2_t": {"fr":"Visa accompagné","en":"Visa support","ar":"مساعدة في التأشيرة"},
      "gua2_d": {"fr":"Une aide à la préparation du dossier, sans garantie de délivrance.","en":"Help preparing the file, with no guarantee of approval.","ar":"مساعدة في إعداد الملف دون ضمان القبول."},
      "gua3_t": {"fr":"Une présence adaptée","en":"Support that fits","ar":"مرافقة حسب البرنامج"},
      "gua3_d": {"fr":"L'accompagnement est précisé pour chaque programme.","en":"Accompaniment is specified for each programme.","ar":"توضح تفاصيل المرافقة في كل رحلة."},
      "gua4_t": {"fr":"Vos envies comptent","en":"Your preferences matter","ar":"رغباتك مهمة"},
      "gua4_d": {"fr":"Formule et expériences optionnelles selon le voyage.","en":"Formula and optional experiences vary by trip.","ar":"الصيغة والتجارب الاختيارية تختلف حسب الرحلة."},
      "cta_badge": {"fr":"À vous le Japon","en":"Japan awaits","ar":"اليابان بانتظارك"},
      "cta_subtitle": {"fr":"Choisissez le départ qui vous inspire ; nous vous aiderons à préparer la suite.","en":"Choose the departure that inspires you; we will help with the next steps.","ar":"اختر الرحلة التي تلهمك وسنساعدك في الخطوات التالية."},
      "cta_primary": {"fr":"Préparer mon voyage","en":"Plan my journey","ar":"خطط لرحلتي"}
    },
    "site:promo-bar": {
      "enabled": false,
      "text": {"fr":"Votre prochain voyage au Japon commence ici","en":"Your next journey to Japan starts here","ar":"رحلتك القادمة إلى اليابان تبدأ هنا"},
      "cta_label": {"fr":"Découvrir nos voyages","en":"Discover our trips","ar":"اكتشف رحلاتنا"},
      "cta_url": "/voyages"
    },
    "site:about": {
      "hero_intro": {"fr":"LeJapon.ma est la marque spécialisée Japon de Moroccan Express Travel & Events. Une équipe passionnée vous aide à découvrir le pays avec un voyage pensé pour vous.","en":"LeJapon.ma is the Japan-focused brand of Moroccan Express Travel & Events. A passionate team helps you discover the country through a thoughtfully planned journey.","ar":"LeJapon.ma هي العلامة المتخصصة في اليابان التابعة لـ Moroccan Express Travel & Events. يساعدك فريق شغوف على اكتشاف البلد من خلال رحلة مدروسة."},
      "hero_card_label": {"fr":"Depuis le Maroc","en":"From Morocco","ar":"من المغرب"},
      "stat1_value": {"fr":"","en":"","ar":""},
      "stat2_value": {"fr":"","en":"","ar":""},
      "stat3_value": {"fr":"","en":"","ar":""}
    },
    "site:contact": {
      "title_main": {"fr":"Parlons de votre","en":"Let's talk about your","ar":"لنتحدث عن"},
      "title_accent": {"fr":"Japon.","en":"Japan journey.","ar":"رحلتك إلى اليابان."},
      "intro": {"fr":"Une question sur un départ, un itinéraire ou un séjour à imaginer ensemble ? Racontez-nous votre projet. Notre équipe prendra le temps de vous répondre.","en":"A question about a departure, an itinerary or a journey we could plan together? Tell us what you have in mind. Our team will get back to you.","ar":"هل لديك سؤال حول موعد رحلة أو مسار أو سفر نخطط له معاً؟ أخبرنا عن مشروعك وسيرد عليك فريقنا."},
      "success_text": {"fr":"Merci pour votre message. Nous vous répondrons à l'adresse indiquée dès que possible.","en":"Thank you for your message. Our team will reply to the address you provided as soon as possible.","ar":"شكراً على رسالتك. سيرد فريقنا على العنوان الذي قدمته في أقرب وقت ممكن."}
    }
  }
  $content$::jsonb;
  v_slug text;
  v_key text;
  v_content jsonb;
  v_temara_count integer;
  v_programme_count integer;
begin
  for v_slug in select item_key from jsonb_object_keys(v_patches) as keys(item_key)
  loop
    select p.content into strict v_content
      from public.pages as p
      where p.slug = v_slug and p.status = 'published'
      for update;

    for v_key in select item_key from jsonb_object_keys(v_patches -> v_slug) as keys(item_key)
    loop
      v_content := jsonb_set(v_content, array[v_key], v_patches -> v_slug -> v_key, true);
    end loop;

    if v_slug = 'site:contact' then
      if jsonb_typeof(v_content -> 'addresses') <> 'array' then
        raise exception 'site:contact addresses must be a JSON array';
      end if;
      select count(*) into v_temara_count
        from jsonb_array_elements(v_content -> 'addresses') as a(address)
        where a.address -> 'city' ->> 'fr' in ('Temara', 'Témara');
      if v_temara_count <> 1 then
        raise exception 'Expected exactly one confirmed Temara address; found %', v_temara_count;
      end if;
      v_content := jsonb_set(
        v_content,
        '{addresses}',
        (select jsonb_agg(a.address)
           from jsonb_array_elements(v_content -> 'addresses') as a(address)
           where a.address -> 'city' ->> 'fr' in ('Temara', 'Témara')),
        true
      );
    end if;

    update public.pages
      set content = v_content, updated_at = now()
      where slug = v_slug;
  end loop;

  update public.programmes
    set cta_label = 'Parler de ce voyage', updated_at = now()
    where slug in ('programme-1', 'programme-2')
      and is_published = true
      and cta_url = '/contact'
      and cta_label = 'Demander un devis';
  get diagnostics v_programme_count = row_count;
  if v_programme_count <> 2 then
    raise exception 'Expected to update exactly two published contact programmes; updated %', v_programme_count;
  end if;
end
$sales_copy$;

commit;
