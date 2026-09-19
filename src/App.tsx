import { SupplierLanguageProvider } from "@/i18n/supplier/SupplierLanguageProvider";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./i18n";
import { SiteLayout } from "./components/site/Layout";
import { AuthProvider } from "@/hooks/useAuth";
import { AdminLayout } from "@/admin/components/AdminLayout";
import { RequireRole } from "@/admin/components/RequireRole";
import { SupplierLayout } from "@/admin/components/SupplierLayout";
import { setLang } from "@/i18n";
import { AgencyProvider } from "@/agency/useAgencyContext";
import { RequireActiveAgencyMember, RequireAgencyMember, RequireAgencyOnboarding } from "@/agency/components/AgencyGuards";
import { LegacyStaticRedirect, LegacyExtraRedirect, LegacyArticleRedirect } from "@/components/LegacyRedirects";
import { useRouteSlugs, DEFAULT_SLUGS, type RouteKey } from "@/hooks/useRouteSlugs";
import { PWAInstallPrompt } from "@/components/pwa/InstallPrompt";
import { initAnalytics, trackPageView } from "@/lib/analytics";
import { installWebViewGuards } from "@/lib/webview-guards";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

const Index = lazy(() => import("./pages/Index.tsx"));
const Trips = lazy(() => import("./pages/Trips.tsx"));
const Hotels = lazy(() => import("./pages/Hotels.tsx"));
const Experiences = lazy(() => import("./pages/Experiences.tsx"));
const About = lazy(() => import("./pages/About.tsx"));
const Blog = lazy(() => import("./pages/Blog.tsx"));
const BlogPost = lazy(() => import("./pages/BlogPost.tsx"));
const Contact = lazy(() => import("./pages/Contact.tsx"));
const Booking = lazy(() => import("./pages/Booking.tsx"));
const FitQuotePublic = lazy(() => import("./pages/FitQuotePublic.tsx"));
const TravelAgreementPublic = lazy(() => import("./pages/TravelAgreementPublic.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Unsubscribe = lazy(() => import("@/pages/Unsubscribe"));
const VisaList = lazy(() => import("@/pages/visa/VisaList"));
const VisaForm = lazy(() => import("@/pages/visa/VisaForm"));
const VisaLogin = lazy(() => import("@/pages/visa/VisaLogin"));
const ProgrammePage = lazy(() => import("@/pages/Programme"));
const FaqPage = lazy(() => import("@/pages/Faq"));
const PartnerAcquisition = lazy(() => import("@/pages/PartnerAcquisition"));
const AgencyLogin = lazy(() => import("@/agency/pages/AgencyLogin"));
const AgencyLayout = lazy(() => import("@/agency/components/AgencyLayout"));
const AgencyDashboard = lazy(() => import("@/agency/pages/AgencyDashboard"));
const AgencyBookings = lazy(() => import("@/agency/pages/AgencyBookings"));
const AgencyBookingDetail = lazy(() => import("@/agency/pages/AgencyBookingDetail"));
const AgencyFitQuotes = lazy(() => import("@/agency/pages/AgencyFitQuotes"));
const AgencyFitRequests = lazy(() => import("@/agency/pages/AgencyFitRequests"));
const AgencyTripsLibrary = lazy(() => import("@/agency/pages/AgencyTripsLibrary"));
const AgencyProgrammesLibrary = lazy(() => import("@/agency/pages/AgencyProgrammesLibrary"));
const AgencyHotels = lazy(() => import("@/agency/pages/AgencyHotels"));
const AgencyExtras = lazy(() => import("@/agency/pages/AgencyExtras"));
const AgencyCommission = lazy(() => import("@/agency/pages/AgencyCommission"));
const AgencyProfilePage = lazy(() => import("@/agency/pages/AgencyProfilePage"));
const AgencyOnboarding = lazy(() => import("@/agency/pages/AgencyOnboarding"));
const ClientLogin = lazy(() => import("@/client/pages/ClientLogin"));
const ClientPasswordRecovery = lazy(() => import("@/client/pages/ClientPasswordRecovery"));
const ClientPortalLayout = lazy(() => import("@/client/components/ClientPortalLayout"));
const ClientDashboard = lazy(() => import("@/client/pages/ClientDashboard"));
const ClientReservations = lazy(() => import("@/client/pages/ClientReservations"));
const ClientReservationDetail = lazy(() => import("@/client/pages/ClientReservationDetail"));
const ClientDocuments = lazy(() => import("@/client/pages/ClientDocuments"));
const ClientVisa = lazy(() => import("@/client/pages/ClientVisa"));
const ClientAgreements = lazy(() => import("@/client/pages/ClientAgreements"));
const ClientExperiences = lazy(() => import("@/client/pages/ClientExperiences"));

const AdminLogin = lazy(() => import("@/admin/pages/Login"));
const AdminPasswordRecovery = lazy(() => import("@/admin/pages/PasswordRecovery"));
const AdminDashboard = lazy(() => import("@/admin/pages/Dashboard"));
const AdminTrips = lazy(() => import("@/admin/pages/Trips"));
const AdminTripWorkspace = lazy(() => import("@/admin/pages/trips/TripWorkspace"));
const AdminBookings = lazy(() => import("@/admin/pages/Bookings"));
const AdminBookingDetail = lazy(() => import("@/admin/pages/BookingDetail"));
const AdminAccounting = lazy(() => import("@/admin/pages/Accounting"));
const AdminOperationsCenter = lazy(() => import("@/admin/pages/OperationsCenter"));
const AdminFlightTickets = lazy(() => import("@/admin/pages/FlightTickets"));
const AdminTravelAgreements = lazy(() => import("@/admin/pages/TravelAgreements"));
const AdminClients = lazy(() => import("@/admin/pages/Clients"));
const AdminExtras = lazy(() => import("@/admin/pages/Extras"));
const AdminSuppliers = lazy(() => import("@/admin/pages/Suppliers"));
const AdminSupplierQuote = lazy(() => import("@/admin/pages/AdminSupplierQuote"));
const AdminSupplierCosts = lazy(() => import("@/admin/pages/SupplierCosts"));
const AdminFitQuotes = lazy(() => import("@/admin/pages/FitQuotes"));
const AdminFitControlTower = lazy(() => import("@/admin/pages/FitControlTower"));
const AdminInternationalPayments = lazy(() => import("@/admin/pages/InternationalPayments"));
const AdminArticles = lazy(() => import("@/admin/pages/Articles"));
const AdminPages = lazy(() => import("@/admin/pages/Pages"));
const AdminFrontend = lazy(() => import("@/admin/pages/Frontend"));
const AdminProgrammes = lazy(() => import("@/admin/pages/Programmes"));
const AdminHotels = lazy(() => import("@/admin/pages/Hotels"));
const AdminMedia = lazy(() => import("@/admin/pages/Media"));
const AdminUsers = lazy(() => import("@/admin/pages/Users"));
const AdminOrganizations = lazy(() => import("@/admin/pages/Organizations"));
const AdminPartnerRequests = lazy(() => import("@/admin/pages/PartnerRequests"));
const AdminAgencyFitRequests = lazy(() => import("@/admin/pages/AgencyFitRequests"));
const AdminAgencySettings = lazy(() => import("@/admin/pages/AgencySettings"));
const AdminEmailSettings = lazy(() => import("@/admin/pages/EmailSettings"));
const AdminEmailTemplates = lazy(() => import("@/admin/pages/EmailTemplates"));
const AdminEmailLogs = lazy(() => import("@/admin/pages/EmailLogs"));
const AdminBackups = lazy(() => import("@/admin/pages/Backups"));
const AdminUserGuide = lazy(() => import("@/admin/pages/AdminUserGuide"));
const AdminOperationTaskTemplates = lazy(() => import("@/admin/pages/OperationTaskTemplates"));
const AdminVisaApplications = lazy(() => import("@/admin/pages/VisaApplications"));
const AdminVisaApplicationDetail = lazy(() => import("@/admin/pages/VisaApplicationDetail"));
const AdminVisaGroupSubmissions = lazy(() => import("@/admin/pages/VisaGroupSubmissions"));
const AdminVisaSettings = lazy(() => import("@/admin/pages/VisaSettings"));
const AdminVisaChecklists = lazy(() => import("@/admin/pages/VisaChecklists"));
const AdminFaqs = lazy(() => import("@/admin/pages/Faqs"));
const AdminTranslations = lazy(() => import("@/admin/pages/Translations"));
const AdminTheme = lazy(() => import("@/admin/pages/Theme"));
const MarketingLayout = lazy(() => import("@/admin/pages/marketing/MarketingLayout"));
const MarketingDashboard = lazy(() => import("@/admin/pages/marketing/MarketingDashboard"));
const MarketingCampaigns = lazy(() => import("@/admin/pages/marketing/MarketingCampaigns"));
const MarketingCampaignEdit = lazy(() => import("@/admin/pages/marketing/MarketingCampaignEdit"));
const MarketingContacts = lazy(() => import("@/admin/pages/marketing/MarketingContacts"));
const MarketingSegments = lazy(() => import("@/admin/pages/marketing/MarketingSegments"));
const MarketingTemplates = lazy(() => import("@/admin/pages/marketing/MarketingTemplates"));
const MarketingSettings = lazy(() => import("@/admin/pages/marketing/MarketingSettings"));
const SupplierTrips = lazy(() => import("@/admin/pages/supplier/SupplierTrips"));
const SupplierTripCosts = lazy(() => import("@/admin/pages/supplier/SupplierTripCosts"));
const SupplierFitRequests = lazy(() => import("@/admin/pages/supplier/SupplierFitRequests"));
const AdminFitSupplierControl = lazy(() => import("@/admin/pages/FitSupplierControl"));

const RouteFallback = () => (
  <div className="min-h-[40vh] flex items-center justify-center text-sm text-muted-foreground">
    Chargement…
  </div>
);

const VISA_CANONICAL_PATH = "/visa-japon-maroc";

/** Redirect that preserves search params + hash so deep links like /reserver?trip=xxx work after route renames. */
const PreservingRedirect = ({ to }: { to: string }) => {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
};

const LocalizedRoute = ({ lang, children }: { lang: "en" | "ar"; children: ReactNode }) => {
  useEffect(() => {
    setLang(lang);
  }, [lang]);

  return <>{children}</>;
};

const AnalyticsRouteTracker = () => {
  const location = useLocation();

  useEffect(() => {
    installWebViewGuards();
    initAnalytics();
  }, []);

  useEffect(() => {
    const path = `${location.pathname}${location.search}`;
    window.setTimeout(() => trackPageView(path, document.title), 0);
  }, [location.pathname, location.search]);

  return null;
};

const AppRoutes = () => {
  const slugs = useRouteSlugs();
  const get = (k: RouteKey) => slugs?.[k]?.slug ?? DEFAULT_SLUGS[k].slug;

  // Auto-redirect default slugs → current renamed slug (preserves SEO).
  const renamedRedirects = (Object.keys(DEFAULT_SLUGS) as RouteKey[])
    .filter((k) => k !== "visa")
    .map((k) => {
      const current = get(k);
      const def = DEFAULT_SLUGS[k].slug;
      if (current === def) return null;
      return (
        <Route
          key={`renamed-${k}`}
          path={`/${def}`}
          element={<PreservingRedirect to={`/${current}`} />}
        />
      );
    })
    .filter(Boolean);

  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/agency/login" element={<AgencyLogin />} />
      <Route path="/espace-voyage/login" element={<ClientLogin />} />
      <Route path="/espace-voyage/nouveau-mot-de-passe" element={<ClientPasswordRecovery />} />
      <Route path="/espace-voyage" element={<ClientPortalLayout />}>
        <Route index element={<ClientDashboard />} />
        <Route path="reservations" element={<ClientReservations />} />
        <Route path="reservations/:bookingId" element={<ClientReservationDetail />} />
        <Route path="documents" element={<ClientDocuments />} />
        <Route path="visa" element={<ClientVisa />} />
        <Route path="accords" element={<ClientAgreements />} />
        <Route path="experiences" element={<ClientExperiences />} />
      </Route>
      <Route path="/client/login" element={<ClientLogin />} />
      <Route path="/client/nouveau-mot-de-passe" element={<ClientPasswordRecovery />} />
      <Route path="/client" element={<ClientPortalLayout />}>
        <Route index element={<ClientDashboard />} />
        <Route path="reservations" element={<ClientReservations />} />
        <Route path="reservations/:bookingId" element={<ClientReservationDetail />} />
        <Route path="documents" element={<ClientDocuments />} />
        <Route path="visa" element={<ClientVisa />} />
        <Route path="accords" element={<ClientAgreements />} />
        <Route path="experiences" element={<ClientExperiences />} />
      </Route>
      <Route path="/agency" element={
        <AgencyProvider>
          <RequireAgencyMember>
            <AgencyLayout />
          </RequireAgencyMember>
        </AgencyProvider>
      }>
        <Route index element={<RequireActiveAgencyMember><AgencyDashboard /></RequireActiveAgencyMember>} />
        <Route path="bookings" element={<RequireActiveAgencyMember><AgencyBookings /></RequireActiveAgencyMember>} />
        <Route path="bookings/:id" element={<RequireActiveAgencyMember><AgencyBookingDetail /></RequireActiveAgencyMember>} />
        <Route path="fit-quotes" element={<RequireActiveAgencyMember><AgencyFitRequests /></RequireActiveAgencyMember>} />
        <Route path="fit-requests" element={<RequireActiveAgencyMember><AgencyFitRequests /></RequireActiveAgencyMember>} />
        <Route path="reservations" element={<RequireActiveAgencyMember><AgencyBookings /></RequireActiveAgencyMember>} />
        <Route path="reservations/:id" element={<RequireActiveAgencyMember><AgencyBookingDetail /></RequireActiveAgencyMember>} />
        <Route path="trips" element={<RequireActiveAgencyMember><AgencyTripsLibrary /></RequireActiveAgencyMember>} />
        <Route path="programmes" element={<RequireActiveAgencyMember><AgencyProgrammesLibrary /></RequireActiveAgencyMember>} />
        <Route path="hotels" element={<RequireActiveAgencyMember><AgencyHotels /></RequireActiveAgencyMember>} />
        <Route path="extras" element={<RequireActiveAgencyMember><AgencyExtras /></RequireActiveAgencyMember>} />
        <Route path="commission" element={<RequireActiveAgencyMember><AgencyCommission /></RequireActiveAgencyMember>} />
        <Route path="profile" element={<RequireActiveAgencyMember><AgencyProfilePage /></RequireActiveAgencyMember>} />
        <Route path="onboarding" element={<RequireAgencyOnboarding><AgencyOnboarding /></RequireAgencyOnboarding>} />
      </Route>
      {/* Private-token quote: deliberately outside every authenticated/layout guard. */}
      <Route path="/devis-fit/:token" element={<FitQuotePublic />} />
      <Route element={<SiteLayout />}>
        <Route path="/" element={<Index />} />
        <Route path={`/${get("trips")}`} element={<Trips />} />
        <Route path="/hotels" element={<Hotels />} />
        <Route path="/hotels/:slug" element={<Hotels />} />
        <Route path={`/${get("experiences")}`} element={<Experiences />} />
        <Route path={`/${get("about")}`} element={<About />} />
        <Route path={`/${get("blog")}`} element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
        <Route path="/en/blog" element={<LocalizedRoute lang="en"><Blog /></LocalizedRoute>} />
        <Route path="/en/blog/:slug" element={<LocalizedRoute lang="en"><BlogPost /></LocalizedRoute>} />
        <Route path="/ar/blog" element={<LocalizedRoute lang="ar"><Blog /></LocalizedRoute>} />
        <Route path="/ar/blog/:slug" element={<LocalizedRoute lang="ar"><BlogPost /></LocalizedRoute>} />
        <Route path={`/${get("contact")}`} element={<Contact />} />
        <Route path={`/${get("booking")}`} element={<Booking />} />
        <Route path="/accord-voyage/:token" element={<TravelAgreementPublic />} />
        <Route path={`/${get("programme")}`} element={<ProgrammePage />} />
        <Route path="/devenir-partenaire" element={<PartnerAcquisition />} />
        <Route path="/visa-japon-maroc" element={<VisaLogin />} />
        <Route path="/visa" element={<PreservingRedirect to={VISA_CANONICAL_PATH} />} />
        <Route path="/visa-japon" element={<PreservingRedirect to={VISA_CANONICAL_PATH} />} />

        {/* Legacy WordPress taxonomy/system URLs */}
        <Route path="/tag/visa-japon" element={<PreservingRedirect to={VISA_CANONICAL_PATH} />} />
        <Route path="/tag/voyage-japon" element={<PreservingRedirect to={`/${get("programme")}`} />} />
        <Route path="/tag/prix-japon" element={<PreservingRedirect to="/prix" />} />
        <Route path="/tag/blog" element={<PreservingRedirect to={`/${get("blog")}`} />} />
        <Route path="/tag/japon" element={<PreservingRedirect to={`/${get("blog")}`} />} />
        <Route path="/tag" element={<NotFound />} />
        <Route path="/tag/*" element={<NotFound />} />
        <Route path="/category" element={<NotFound />} />
        <Route path="/category/*" element={<NotFound />} />
        <Route path="/author" element={<NotFound />} />
        <Route path="/author/*" element={<NotFound />} />
        <Route path="/wp-content" element={<NotFound />} />
        <Route path="/wp-content/*" element={<NotFound />} />
        <Route path="/wp-json" element={<NotFound />} />
        <Route path="/wp-json/*" element={<NotFound />} />
        <Route path="/feed" element={<NotFound />} />
        <Route path="/feed/*" element={<NotFound />} />

        {/* FAQ — multilingue, l'URL FR conserve l'ancien slug WordPress pour le SEO */}
        <Route path="/mon-voyage-questions-reponses" element={<FaqPage lang="fr" />} />
        <Route path="/en/faq" element={<FaqPage lang="en" />} />
        <Route path="/ar/faq" element={<FaqPage lang="ar" />} />

        {renamedRedirects}

        {/* Visa Japan module */}
        {get("visa") !== "visa-japon-maroc" && (
          <Route path={`/${get("visa")}`} element={<PreservingRedirect to={VISA_CANONICAL_PATH} />} />
        )}
        <Route path={`/${get("visa")}/login`} element={<VisaLogin />} />
        <Route path={`/${get("visa")}/applications`} element={<VisaList />} />
        <Route path={`/${get("visa")}/formulaire`} element={<PreservingRedirect to={`/${get("visa")}/applications`} />} />
        <Route path={`/${get("visa")}/formulaire/:id`} element={<VisaForm />} />
        <Route path={`/${get("visa")}/:id`} element={<VisaForm />} />

        {/* Legacy WordPress URLs — preserve SEO equity */}
        <Route path="/programme-2" element={<LegacyStaticRedirect />} />
        <Route path="/prix" element={<LegacyStaticRedirect />} />
        <Route path="/paiement" element={<LegacyStaticRedirect />} />
        <Route path="/inscription" element={<LegacyStaticRedirect />} />
        <Route path="/extra-plans" element={<LegacyStaticRedirect />} />
        <Route path="/extra-plans/:slug" element={<LegacyExtraRedirect />} />
        <Route path="/hotels-avril" element={<LegacyStaticRedirect />} />
        <Route path="/accueil-2" element={<LegacyStaticRedirect />} />
        <Route path="/a2" element={<LegacyStaticRedirect />} />
        <Route path="/demande-de-visa-pour-le-japon" element={<LegacyStaticRedirect />} />
        <Route path="/accord-de-voyage" element={<LegacyStaticRedirect />} />
        <Route path="/accord-de-voyage-avril" element={<LegacyStaticRedirect />} />
        <Route path="/accord-de-voyage-2" element={<LegacyStaticRedirect />} />
        <Route path="/questionnaire-de-satisfaction" element={<LegacyStaticRedirect />} />
        <Route path="/politique-de-confidentialite" element={<LegacyStaticRedirect />} />

        {/* Legacy article slugs → Journal */}
        <Route path="/culture-nippone" element={<LegacyArticleRedirect />} />
        <Route path="/top-activities-osaka" element={<LegacyArticleRedirect />} />
        <Route path="/histoire-du-japon" element={<LegacyArticleRedirect />} />
        <Route path="/apprendre-le-japonais" element={<LegacyArticleRedirect />} />
        <Route path="/la-cuisine-japonaise-washoku" element={<LegacyArticleRedirect />} />
        <Route path="/habiter-un-ryokan-a-kyoto" element={<LegacyArticleRedirect />} />
        <Route path="/les-meilleures-restaurant-a-faire-a-kyoto-au-japon" element={<LegacyArticleRedirect />} />
        <Route path="/quels-similitudes-entre-la-culture-japonaise-et-notre-culture-marocaine" element={<LegacyArticleRedirect />} />
        <Route path="/le-festival-des-bebes-sumos-en-pleurs-au-japon" element={<LegacyArticleRedirect />} />
        <Route path="/decouvrez-lenchantement-de-kamakura-un-voyage-a-travers-le-temps-et-la-tranquillite" element={<LegacyArticleRedirect />} />
        <Route path="/le-majestueux-mont-fuji-un-voyage-vers-le-pic-emblematique-du-japon" element={<LegacyArticleRedirect />} />
        <Route path="/plongez-dans-akihabara-le-pays-des-merveilles-electriques-de-tokyo" element={<LegacyArticleRedirect />} />
        <Route path="/le-mystere-du-soleil-levant-une-aventure-de-casablanca-a-tokyo" element={<LegacyArticleRedirect />} />
        <Route path="/les-japonais-se-tiennent-a-gauche-a-tokyo-et-a-droite-a-osaka-pourquoi-cette-difference" element={<LegacyArticleRedirect />} />
        <Route path="/le-japon-abaisse-le-statut-du-covid-19-a-celui-dune-la-grippe-saisonniere" element={<LegacyArticleRedirect />} />
        <Route path="/le-japon-des-restrictions-encore-plus-strictes-aux-frontieres-jusqua-fin-fevrier" element={<LegacyArticleRedirect />} />
        <Route path="/cest-officiel-le-japon-rouvrira-ses-portes-le-10-juin-pour-98-pays-et-regions" element={<LegacyArticleRedirect />} />

        {/* Article detail at root: /<slug> — must stay LAST inside SiteLayout */}
        <Route path="/:slug" element={<BlogPost />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin/mot-de-passe-oublie" element={<AdminPasswordRecovery />} />
      <Route path="/admin/nouveau-mot-de-passe" element={<AdminPasswordRecovery />} />
      <Route path="/unsubscribe/:token" element={<Unsubscribe />} />
      <Route path="/supplier/login" element={<SupplierLanguageProvider><AdminLogin /></SupplierLanguageProvider>} />
      <Route path="/supplier" element={<SupplierLayout />}>
        <Route index element={<SupplierTrips />} />
        <Route path="trips" element={<SupplierTrips />} />
        <Route path="trips/:tripId" element={<SupplierTripCosts />} />
        <Route path="trips/:tripId/quote" element={<SupplierTripCosts />} />
        <Route path="fit-requests" element={<SupplierFitRequests />} />
      </Route>
      <Route path="/sales" element={<AdminLayout />}>
        <Route path="fit-quotes" element={<RequireRole module="partner_fit_quotes"><AgencyFitQuotes mode="sales" /></RequireRole>} />
      </Route>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="trips" element={<RequireRole module="trips"><AdminTrips /></RequireRole>} />
        <Route path="trips/:tripId/workspace" element={<RequireRole module="trips"><AdminTripWorkspace /></RequireRole>} />
        <Route path="trips/:tripId/workspace/:tab" element={<RequireRole module="trips"><AdminTripWorkspace /></RequireRole>} />
        <Route path="bookings" element={<RequireRole module="bookings"><AdminBookings /></RequireRole>} />
        <Route path="bookings/:id" element={<RequireRole module="bookings"><AdminBookingDetail /></RequireRole>} />
        <Route path="accounting" element={<RequireRole module="accounting"><AdminAccounting /></RequireRole>} />
        <Route path="operations-center" element={<RequireRole module="operations_center"><AdminOperationsCenter /></RequireRole>} />
        <Route path="flight-tickets" element={<RequireRole module="flight_tickets"><AdminFlightTickets /></RequireRole>} />
        <Route path="travel-agreements" element={<RequireRole module="travel_agreements"><AdminTravelAgreements /></RequireRole>} />
        <Route path="clients" element={<RequireRole module="clients"><AdminClients /></RequireRole>} />
        <Route path="clients/:id" element={<RequireRole module="clients"><AdminClients /></RequireRole>} />
        <Route path="partner-requests" element={<RequireRole module="partner_requests"><AdminPartnerRequests /></RequireRole>} />
        <Route path="agency-fit-requests" element={<RequireRole module="agency_fit_requests"><AdminAgencyFitRequests /></RequireRole>} />
        <Route path="extras" element={<RequireRole module="extras"><AdminExtras /></RequireRole>} />
        <Route path="suppliers" element={<RequireRole module="suppliers"><AdminSuppliers /></RequireRole>} />
        <Route path="supplier-costs" element={<RequireRole module="supplier_costs"><AdminSupplierCosts /></RequireRole>} />
        <Route path="supplier-costs/:tripId" element={<RequireRole module="supplier_costs"><AdminSupplierQuote /></RequireRole>} />
        <Route path="supplier-costs/:tripId/:quoteId" element={<RequireRole module="supplier_costs"><AdminSupplierQuote /></RequireRole>} />
        <Route path="fit-supplier-control" element={<RequireRole module="supplier_costs"><AdminFitSupplierControl /></RequireRole>} />
        <Route path="fit-quotes" element={<RequireRole module="fit_quotes"><AdminFitQuotes /></RequireRole>} />
        <Route path="fit-control-tower" element={<RequireRole module="fit_control_tower"><AdminFitControlTower /></RequireRole>} />
        <Route path="international-payments" element={<RequireRole module="international_payments"><AdminInternationalPayments /></RequireRole>} />
        <Route path="articles" element={<RequireRole module="articles"><AdminArticles /></RequireRole>} />
        <Route path="pages" element={<RequireRole module="pages"><AdminPages /></RequireRole>} />
        <Route path="frontend" element={<RequireRole module="frontend"><AdminFrontend /></RequireRole>} />
        <Route path="programmes" element={<RequireRole module="programmes"><AdminProgrammes /></RequireRole>} />
        <Route path="hotels" element={<RequireRole module="hotels"><AdminHotels /></RequireRole>} />
        <Route path="media" element={<RequireRole module="media"><AdminMedia /></RequireRole>} />
        <Route path="users" element={<RequireRole module="users"><AdminUsers /></RequireRole>} />
        <Route path="organizations" element={<RequireRole module="organizations"><AdminOrganizations /></RequireRole>} />
        <Route path="agency-settings" element={<RequireRole module="agency_settings"><AdminAgencySettings /></RequireRole>} />
        <Route path="email-settings" element={<RequireRole module="email_settings"><AdminEmailSettings /></RequireRole>} />
        <Route path="email-templates" element={<RequireRole module="email_templates"><AdminEmailTemplates /></RequireRole>} />
        <Route path="email-logs" element={<RequireRole module="email_logs"><AdminEmailLogs /></RequireRole>} />
        <Route path="backups" element={<RequireRole module="backups"><AdminBackups /></RequireRole>} />
        <Route path="user-guide" element={<RequireRole module="faqs"><AdminUserGuide /></RequireRole>} />
        <Route path="operation-task-templates" element={<RequireRole module="operation_task_templates"><AdminOperationTaskTemplates /></RequireRole>} />
        <Route path="visa" element={<RequireRole module="visa"><AdminVisaApplications /></RequireRole>} />
        <Route path="visa-group-submissions" element={<RequireRole module="visa_group_submissions"><AdminVisaGroupSubmissions /></RequireRole>} />
        <Route path="visa/:id" element={<RequireRole module="visa"><AdminVisaApplicationDetail /></RequireRole>} />
        <Route path="visa-settings" element={<RequireRole module="visa_settings"><AdminVisaSettings /></RequireRole>} />
        <Route path="visa-checklists" element={<RequireRole module="visa_checklists"><AdminVisaChecklists /></RequireRole>} />
        <Route path="faqs" element={<RequireRole module="faqs"><AdminFaqs /></RequireRole>} />
        <Route path="translations" element={<RequireRole module="translations"><AdminTranslations /></RequireRole>} />
        <Route path="theme" element={<RequireRole module="theme"><AdminTheme /></RequireRole>} />
        <Route path="marketing" element={<RequireRole module="marketing"><MarketingLayout /></RequireRole>}>
          <Route index element={<MarketingDashboard />} />
          <Route path="campaigns" element={<MarketingCampaigns />} />
          <Route path="campaigns/:id" element={<MarketingCampaignEdit />} />
          <Route path="contacts" element={<MarketingContacts />} />
          <Route path="segments" element={<MarketingSegments />} />
          <Route path="templates" element={<MarketingTemplates />} />
          <Route path="settings" element={<RequireRole module="marketing_settings"><MarketingSettings /></RequireRole>} />
        </Route>
      </Route>
    </Routes>
    <PWAInstallPrompt />
    </Suspense>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AnalyticsRouteTracker />
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
