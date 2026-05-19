import { lazy, Suspense } from "react";
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
import { LegacyStaticRedirect, LegacyExtraRedirect, LegacyArticleRedirect } from "@/components/LegacyRedirects";
import { useRouteSlugs, DEFAULT_SLUGS, type RouteKey } from "@/hooks/useRouteSlugs";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";

const queryClient = new QueryClient();

const Index = lazy(() => import("./pages/Index.tsx"));
const Trips = lazy(() => import("./pages/Trips.tsx"));
const Experiences = lazy(() => import("./pages/Experiences.tsx"));
const About = lazy(() => import("./pages/About.tsx"));
const Blog = lazy(() => import("./pages/Blog.tsx"));
const BlogPost = lazy(() => import("./pages/BlogPost.tsx"));
const Contact = lazy(() => import("./pages/Contact.tsx"));
const Booking = lazy(() => import("./pages/Booking.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Unsubscribe = lazy(() => import("@/pages/Unsubscribe"));
const VisaList = lazy(() => import("@/pages/visa/VisaList"));
const VisaForm = lazy(() => import("@/pages/visa/VisaForm"));
const VisaLogin = lazy(() => import("@/pages/visa/VisaLogin"));
const ProgrammePage = lazy(() => import("@/pages/Programme"));
const FaqPage = lazy(() => import("@/pages/Faq"));

const AdminLogin = lazy(() => import("@/admin/pages/Login"));
const AdminDashboard = lazy(() => import("@/admin/pages/Dashboard"));
const AdminTrips = lazy(() => import("@/admin/pages/Trips"));
const AdminBookings = lazy(() => import("@/admin/pages/Bookings"));
const AdminBookingDetail = lazy(() => import("@/admin/pages/BookingDetail"));
const AdminClients = lazy(() => import("@/admin/pages/Clients"));
const AdminExtras = lazy(() => import("@/admin/pages/Extras"));
const AdminSuppliers = lazy(() => import("@/admin/pages/Suppliers"));
const AdminSupplierCosts = lazy(() => import("@/admin/pages/SupplierCosts"));
const AdminArticles = lazy(() => import("@/admin/pages/Articles"));
const AdminPages = lazy(() => import("@/admin/pages/Pages"));
const AdminFrontend = lazy(() => import("@/admin/pages/Frontend"));
const AdminProgrammes = lazy(() => import("@/admin/pages/Programmes"));
const AdminMedia = lazy(() => import("@/admin/pages/Media"));
const AdminUsers = lazy(() => import("@/admin/pages/Users"));
const AdminEmailSettings = lazy(() => import("@/admin/pages/EmailSettings"));
const AdminVisaApplications = lazy(() => import("@/admin/pages/VisaApplications"));
const AdminVisaApplicationDetail = lazy(() => import("@/admin/pages/VisaApplicationDetail"));
const AdminVisaSettings = lazy(() => import("@/admin/pages/VisaSettings"));
const AdminVisaChecklists = lazy(() => import("@/admin/pages/VisaChecklists"));
const AdminFaqs = lazy(() => import("@/admin/pages/Faqs"));
const AdminTranslations = lazy(() => import("@/admin/pages/Translations"));
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

const RouteFallback = () => (
  <div className="min-h-[40vh] flex items-center justify-center text-sm text-muted-foreground">
    Chargement…
  </div>
);

/** Redirect that preserves search params + hash so deep links like /reserver?trip=xxx work after route renames. */
const PreservingRedirect = ({ to }: { to: string }) => {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
};

const AppRoutes = () => {
  const slugs = useRouteSlugs();
  const get = (k: RouteKey) => slugs?.[k]?.slug ?? DEFAULT_SLUGS[k].slug;

  // Auto-redirect default slugs → current renamed slug (preserves SEO).
  const renamedRedirects = (Object.keys(DEFAULT_SLUGS) as RouteKey[])
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
      <Route element={<SiteLayout />}>
        <Route path="/" element={<Index />} />
        <Route path={`/${get("trips")}`} element={<Trips />} />
        <Route path={`/${get("experiences")}`} element={<Experiences />} />
        <Route path={`/${get("about")}`} element={<About />} />
        <Route path={`/${get("blog")}`} element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
        <Route path={`/${get("contact")}`} element={<Contact />} />
        <Route path={`/${get("booking")}`} element={<Booking />} />
        <Route path={`/${get("programme")}`} element={<ProgrammePage />} />

        {/* FAQ — multilingue, l'URL FR conserve l'ancien slug WordPress pour le SEO */}
        <Route path="/mon-voyage-questions-reponses" element={<FaqPage lang="fr" />} />
        <Route path="/en/faq" element={<FaqPage lang="en" />} />
        <Route path="/ar/faq" element={<FaqPage lang="ar" />} />

        {renamedRedirects}

        {/* Visa Japan module */}
        <Route path={`/${get("visa")}`} element={<VisaList />} />
        <Route path={`/${get("visa")}/login`} element={<VisaLogin />} />
        <Route path={`/${get("visa")}/:id`} element={<VisaForm />} />

        {/* Legacy WordPress URLs — preserve SEO equity */}
        <Route path="/programme-2" element={<LegacyStaticRedirect />} />
        <Route path="/prix" element={<LegacyStaticRedirect />} />
        <Route path="/paiement" element={<LegacyStaticRedirect />} />
        <Route path="/inscription" element={<LegacyStaticRedirect />} />
        <Route path="/extra-plans" element={<LegacyStaticRedirect />} />
        <Route path="/extra-plans/:slug" element={<LegacyExtraRedirect />} />
        <Route path="/hotels" element={<LegacyStaticRedirect />} />
        <Route path="/hotels-avril" element={<LegacyStaticRedirect />} />
        <Route path="/accueil-2" element={<LegacyStaticRedirect />} />
        <Route path="/a2" element={<LegacyStaticRedirect />} />
        <Route path="/demande-de-visa-pour-le-japon" element={<LegacyStaticRedirect />} />
        <Route path="/formulaire-visa" element={<LegacyStaticRedirect />} />
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
      <Route path="/unsubscribe/:token" element={<Unsubscribe />} />
      <Route path="/supplier" element={<SupplierLayout />}>
        <Route index element={<SupplierTrips />} />
        <Route path="trips/:tripId" element={<SupplierTripCosts />} />
      </Route>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="trips" element={<RequireRole module="trips"><AdminTrips /></RequireRole>} />
        <Route path="bookings" element={<RequireRole module="bookings"><AdminBookings /></RequireRole>} />
        <Route path="bookings/:id" element={<RequireRole module="bookings"><AdminBookingDetail /></RequireRole>} />
        <Route path="clients" element={<RequireRole module="clients"><AdminClients /></RequireRole>} />
        <Route path="extras" element={<RequireRole module="extras"><AdminExtras /></RequireRole>} />
        <Route path="suppliers" element={<RequireRole module="suppliers"><AdminSuppliers /></RequireRole>} />
        <Route path="supplier-costs" element={<RequireRole module="supplier_costs"><AdminSupplierCosts /></RequireRole>} />
        <Route path="articles" element={<RequireRole module="articles"><AdminArticles /></RequireRole>} />
        <Route path="pages" element={<RequireRole module="pages"><AdminPages /></RequireRole>} />
        <Route path="frontend" element={<RequireRole module="frontend"><AdminFrontend /></RequireRole>} />
        <Route path="programmes" element={<RequireRole module="programmes"><AdminProgrammes /></RequireRole>} />
        <Route path="media" element={<RequireRole module="media"><AdminMedia /></RequireRole>} />
        <Route path="users" element={<RequireRole module="users"><AdminUsers /></RequireRole>} />
        <Route path="email-settings" element={<RequireRole module="email_settings"><AdminEmailSettings /></RequireRole>} />
        <Route path="visa" element={<RequireRole module="visa"><AdminVisaApplications /></RequireRole>} />
        <Route path="visa/:id" element={<RequireRole module="visa"><AdminVisaApplicationDetail /></RequireRole>} />
        <Route path="visa-settings" element={<RequireRole module="visa_settings"><AdminVisaSettings /></RequireRole>} />
        <Route path="visa-checklists" element={<RequireRole module="visa_checklists"><AdminVisaChecklists /></RequireRole>} />
        <Route path="faqs" element={<RequireRole module="faqs"><AdminFaqs /></RequireRole>} />
        <Route path="translations" element={<RequireRole module="translations"><AdminTranslations /></RequireRole>} />
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
    <InstallPrompt />
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
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
