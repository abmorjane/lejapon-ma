# Sales Copy V1 — audit CMS de production

> Lecture seule du projet Supabase `nkovgpzspprmmhorwaxl`, 29 septembre 2026. Ce document décrit un patch proposé ; aucune donnée de production n'a été modifiée.

Les valeurs proposées FR/EN/AR sont reprises dans la migration éditoriale `20260929150858_sales_copy_brand_content_v1.sql`, sauf la ligne `testimonials` : ces citations non sourcées restent conservées dans le CMS, mais ne sont plus affichées par React, même après application du patch.

## site:home

| Clé | FR actuelle | FR proposée | EN proposée | AR proposée |
|---|---|---|---|---|
| `hero_badge` | Novembre 2026 · 4 places restantes | Voyages au Japon depuis le Maroc | Japan journeys from Morocco | رحلات إلى اليابان من المغرب |
| `hero_title_l1` | Voyager au japon, c'est simple! | Le Japon, | Japan, | اليابان، |
| `hero_title_l2` | avec Lejapon.ma | à vivre pleinement. | yours to discover. | اكتشفها بطريقتك. |
| `hero_subtitle` | Voyages premium pensé au moindre détail, avec une équipe maroco-japonaise, et à des prix imbattables. | Des circuits pensés avec soin, des découvertes à partager et la liberté de savourer le Japon à votre rythme. | Thoughtfully planned routes, discoveries to share and room to enjoy Japan at your own pace. | مسارات مدروسة وتجارب تتشاركها مع الآخرين ووقت للاستمتاع باليابان على إيقاعك. |
| `hero_cta_primary` | S'inscrire | Imaginer mon voyage | Plan my journey | خطط لرحلتي |
| `hero_cta_secondary` | Nos programmes | Découvrir les départs | Explore departures | اكتشف الرحلات |
| `hero_trust_count` | +500 |  |  |  |
| `hero_rating_value` | 4.9/5 |  |  |  |
| `stat1_v` | +10 |  |  |  |
| `stat2_v` | +500 |  |  |  |
| `stat3_v` | +15 |  |  |  |
| `stat4_v` | 4.9/5 |  |  |  |
| `trips_title_main` | Quatre saisons magnifiques, | Le Japon vous appelle, | Japan is calling, | اليابان تناديك، |
| `trips_title_accent` | plusieurs départs au Japon inoubliables. | choisissez votre départ. | choose your departure. | اختر موعد رحلتك. |
| `why_title_main` | Le premier site web au Maroc | Votre Japon, | Your Japan, | رحلتك إلى اليابان، |
| `why_title_accent` | dédié au voyage organisé au Japon. | avec le plaisir de se laisser guider. | with thoughtful support. | برفقة فريق يهتم بالتفاصيل. |
| `why_intro` | Une expertise unique, une équipe passionnée, et la garantie d'un voyage inoubliable. | Une équipe attentive vous aide à choisir le bon départ et à profiter de chaque étape, sans renoncer à vos envies personnelles. | Our team helps you choose the right departure and enjoy every stage while making room for your own interests. | نساعدك في اختيار الرحلة المناسبة والاستمتاع بكل محطة مع مساحة لرغباتك الخاصة. |
| `why1_t` | Un programme complet | Un itinéraire qui a du sens | A meaningful route | مسار واضح |
| `why1_d` | Tout est pensé dans les moindres détails : hôtels, transports, guides, accompagnateur… aucune surprise. | Les villes, les visites et le rythme de chaque circuit sont présentés avant votre choix. | Explore the cities, visits and pace of each trip before choosing. | تعرف على المدن والزيارات ووتيرة كل رحلة قبل الاختيار. |
| `why2_t` | Équipe maroco-japonaise | Le Japon vu de près | Japan up close | معرفة باليابان |
| `why2_d` | Une vraie connaissance du terrain et la chaleur de l'accueil marocain. | Notre connaissance de la destination nourrit les étapes et les conseils que nous partageons. | Our destination knowledge shapes the routes and advice we share. | توجه خبرتنا بالوجهة البرامج والنصائح التي نقدمها. |
| `why3_t` | Immersion totale | Du temps pour vous | Time for yourself | وقت لنفسك |
| `why3_d` | Des programmes de 13 à 18 jours selon la saison, pour vivre le Japon pleinement. | Les moments libres prévus au programme laissent place à vos propres découvertes. | Free moments in the programme make room for your discoveries. | تترك الفترات الحرة في البرنامج مساحة لاكتشافاتك. |
| `why4_t` | Réservation simple | Un choix en toute clarté | A clear choice | اختيار بكل وضوح |
| `why4_d` | Composez votre voyage en 2 minutes avec prix instantané. | Comparez les départs, puis personnalisez votre demande selon vos envies. | Compare departures and tailor your request to your preferences. | قارن الرحلات وخصص طلبك حسب رغباتك. |
| `step1_t` | Composez votre voyage | Choisissez votre départ | Choose your departure | اختر رحلتك |
| `step1_d` | Choisissez vos dates, formule et options. Prix en temps réel, sans engagement. | Choisissez votre départ et les options qui vous plaisent ; le montant estimé apparaît avant l'envoi. | Choose a departure and optional experiences; see the estimate before sending your request. | اختر موعد الرحلة والخيارات التي تناسبك واطلع على السعر التقديري قبل الإرسال. |
| `step2_t` | Confirmez avec acompte | Parlons des détails | Let's discuss the details | لنتحدث عن التفاصيل |
| `step2_d` | Un virement de 50 % garantit votre place et lance votre demande de visa. | Notre équipe confirme avec vous les disponibilités et les conditions de réservation. | Our team confirms availability and booking conditions with you. | يؤكد فريقنا معك التوفر وشروط الحجز. |
| `step3_t` | Préparez vos valises | Préparez le départ | Get ready to go | استعد للسفر |
| `step3_d` | Visa reçu, solde réglé, et nous nous retrouvons à l'aéroport de Casablanca. | Préparez votre départ avec nos conseils, notamment pour votre dossier de visa. | Prepare to leave with our advice, including support for your visa file. | استعد للسفر مع نصائحنا، بما في ذلك المساعدة في ملف التأشيرة. |
| `gua1_t` | Transparence totale | Un programme lisible | A clear programme | برنامج واضح |
| `gua1_d` | Petits-déjeuners et prestations du programme inclus, sans mauvaise surprise | Prestations et moments libres sont précisés pour le départ choisi. | Services and free time are detailed for each departure. | تفاصيل الخدمات والوقت الحر لكل رحلة. |
| `gua2_t` | Visa assisté | Visa accompagné | Visa support | مساعدة في التأشيرة |
| `gua2_d` | Nous gérons toute la procédure | Une aide à la préparation du dossier, sans garantie de délivrance. | Help preparing the file, with no guarantee of approval. | مساعدة في إعداد الملف دون ضمان القبول. |
| `gua3_t` | Guide bilingue | Une présence adaptée | Support that fits | مرافقة حسب البرنامج |
| `gua3_d` | Marocain + japonais sur place | L'accompagnement est précisé pour chaque programme. | Accompaniment is specified for each programme. | توضح تفاصيل المرافقة في كل رحلة. |
| `gua4_t` | Paiement flexible | Vos envies comptent | Your preferences matter | رغباتك مهمة |
| `gua4_d` | 50 % à la réservation, 50 % avant départ | Formule et expériences optionnelles selon le voyage. | Formula and optional experiences vary by trip. | الصيغة والتجارب الاختيارية تختلف حسب الرحلة. |
| `cta_badge` | Offre limitée | À vous le Japon | Japan awaits | اليابان بانتظارك |
| `cta_subtitle` | Composez votre voyage en 2 minutes et découvrez votre prix instantanément. | Choisissez le départ qui vous inspire ; nous vous aiderons à préparer la suite. | Choose the departure that inspires you; we will help with the next steps. | اختر الرحلة التي تلهمك وسنساعدك في الخطوات التالية. |
| `cta_primary` | Composer mon voyage | Préparer mon voyage | Plan my journey | خطط لرحلتي |
| `testimonials` | 4 citations non reliées à une source vérifiée | Inchangé dans le CMS, masqué dans React en attendant une source | Non affiché | غير معروض |

## site:promo-bar

| Clé | FR actuelle | FR proposée | EN proposée | AR proposée |
|---|---|---|---|---|
| `enabled` | true | false | — | — |
| `text` | Novembre 2026 · 4 places restantes | Votre prochain voyage au Japon commence ici | Your next journey to Japan starts here | رحلتك القادمة إلى اليابان تبدأ هنا |
| `cta_label` | Réserver maintenant | Découvrir nos voyages | Discover our trips | اكتشف رحلاتنا |
| `cta_url` | /reserver | "/voyages" | — | — |

## site:about

| Clé | FR actuelle | FR proposée | EN proposée | AR proposée |
|---|---|---|---|---|
| `hero_intro` | LeJapon.ma est une branche de l'agence de voyage Moroccan Express Travel and Events, spécialisée dans les voyages au Japon, offrant des expériences immersives uniques. | LeJapon.ma est la marque spécialisée Japon de Moroccan Express Travel & Events. Une équipe passionnée vous aide à découvrir le pays avec un voyage pensé pour vous. | LeJapon.ma is the Japan-focused brand of Moroccan Express Travel & Events. A passionate team helps you discover the country through a thoughtfully planned journey. | LeJapon.ma هي العلامة المتخصصة في اليابان التابعة لـ Moroccan Express Travel & Events. يساعدك فريق شغوف على اكتشاف البلد من خلال رحلة مدروسة. |
| `hero_card_label` | Depuis Casablanca | Depuis le Maroc | From Morocco | من المغرب |
| `stat1_value` | +30 |  |  |  |
| `stat2_value` | +500 |  |  |  |
| `stat3_value` | +10 ans |  |  |  |

## site:contact

| Clé | FR actuelle | FR proposée | EN proposée | AR proposée |
|---|---|---|---|---|
| `title_main` | Parlons de votre | Parlons de votre | Let's talk about your | لنتحدث عن |
| `title_accent` | voyage. | Japon. | Japan journey. | رحلتك إلى اليابان. |
| `intro` | Une question, un projet de voyage de groupe, une demande sur mesure ? Notre équipe vous répond sous 24 heures. | Une question sur un départ, un itinéraire ou un séjour à imaginer ensemble ? Racontez-nous votre projet. Notre équipe prendra le temps de vous répondre. | A question about a departure, an itinerary or a journey we could plan together? Tell us what you have in mind. Our team will get back to you. | هل لديك سؤال حول موعد رحلة أو مسار أو سفر نخطط له معاً؟ أخبرنا عن مشروعك وسيرد عليك فريقنا. |
| `success_text` | We will reply within 24 hours to the provided email address. | Merci pour votre message. Nous vous répondrons à l'adresse indiquée dès que possible. | Thank you for your message. Our team will reply to the address you provided as soon as possible. | شكراً على رسالتك. سيرد فريقنا على العنوان الذي قدمته في أقرب وقت ممكن. |
| `addresses` | Temara: Rue Annour, Hay El Wifaq 3, Temara; Casablanca: 4 Rue de Vimy, Casablanca | Temara: Rue Annour, Hay El Wifaq 3, Temara | Temara: Rue Annour, Hay El Wifaq 3, Temara | تمارة: شارع النور، حي الوفاق 3، تمارة |

## Programmes publiés

| Slug | CTA actuel | Destination | CTA proposé |
|---|---|---|---|
| `programme-1` | Demander un devis | `/contact` | Parler de ce voyage |
| `programme-2` | Demander un devis | `/contact` | Parler de ce voyage |

Les trois programmes non publiés ne sont pas ciblés. Les réponses FAQ et descriptions d'hôtels ne sont pas modifiées dans ce patch.
