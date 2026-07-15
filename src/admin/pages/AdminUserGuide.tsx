import { useMemo, useState, type ReactNode } from "react";
import { BookOpen, CheckCircle2, Search, Workflow } from "lucide-react";
import { PageHeader } from "@/admin/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type GuideSection = {
  category: string;
  summary: string;
  workflow: string[];
  buttons: string[];
  mistakes: string[];
  bestPractices: string[];
};

const GUIDE_SECTIONS: GuideSection[] = [
  {
    category: "Getting Started",
    summary: "Point d’entrée pour comprendre le tableau de bord, la navigation, les rôles et les actions rapides.",
    workflow: ["Vérifier le dashboard", "Ouvrir le module concerné", "Utiliser les filtres", "Contrôler les statuts avant toute action sensible"],
    buttons: ["Actualiser recharge les données visibles", "Activer les notifications prépare les alertes navigateur", "Design system ouvre les préférences d’interface"],
    mistakes: ["Changer de module sans sauvegarder un formulaire long", "Confondre un statut métier avec un statut de paiement"],
    bestPractices: ["Utiliser la recherche globale du module avant de créer une nouvelle fiche", "Garder les notifications activées pour les demandes urgentes"],
  },
  {
    category: "Reservations",
    summary: "Gestion des réservations, participants, paiements, extras, documents et accès client.",
    workflow: ["Créer ou ouvrir une réservation", "Vérifier client et voyageurs", "Contrôler le prix total et l’acompte", "Ajouter paiements/documents", "Envoyer les accès client si nécessaire"],
    buttons: ["Nouvelle réservation crée un dossier", "Modifier ouvre le détail commercial", "Envoyer accès client prépare l’espace voyage", "Télécharger PDF génère les documents commerciaux"],
    mistakes: ["Modifier le total sans vérifier les extras", "Créer un doublon client au lieu de lier un client existant"],
    bestPractices: ["Toujours vérifier le reste à payer après ajout d’un paiement", "Renseigner les participants avant les documents finaux"],
  },
  {
    category: "FIT",
    summary: "Devis sur mesure, demandes agences et suivi commercial des voyages personnalisés.",
    workflow: ["Qualifier la demande", "Créer le devis FIT", "Vérifier les lignes et marges", "Envoyer le lien", "Convertir uniquement après acceptation"],
    buttons: ["Créer devis prépare un devis interne", "Partager génère un lien client/agence", "Convertir relie le devis à une réservation"],
    mistakes: ["Partager un devis brouillon", "Confondre coût fournisseur et prix client"],
    bestPractices: ["Documenter chaque hypothèse dans les notes internes", "Conserver une version finale avant conversion"],
  },
  {
    category: "Visa",
    summary: "Suivi des demandes visa Japon, documents requis, emails et cohérence avec les dates de voyage.",
    workflow: ["Ouvrir la demande", "Vérifier identité/passeport", "Contrôler les dates Japon", "Vérifier documents", "Envoyer relances si nécessaire"],
    buttons: ["Appliquer les dates du voyage recalcule arrivée/départ Japon", "Envoyer email utilise les templates visa", "Documents requis ouvre la configuration par profil"],
    mistakes: ["Utiliser la durée totale du voyage au lieu des jours au Japon", "Corriger manuellement sans noter la raison"],
    bestPractices: ["Comparer les données passeport avec la fiche CRM", "Ne jamais exposer les données passeport dans des logs"],
  },
  {
    category: "Trips",
    summary: "Création, duplication, publication et structuration des départs LeJapon.ma.",
    workflow: ["Créer le voyage", "Renseigner dates et jours Japon", "Ajouter programme/hôtels/extras", "Vérifier tarifs", "Publier uniquement après contrôle"],
    buttons: ["Dupliquer copie un départ", "Modèles d’hébergement applique une séquence hôtel relative", "Publier rend visible côté public"],
    mistakes: ["Oublier les jours au Japon pour le visa", "Copier un voyage sans vérifier les dates hôtels"],
    bestPractices: ["Utiliser les modèles d’hébergement pour les circuits récurrents", "Vérifier chaque ville et nuit après duplication"],
  },
  {
    category: "Operations",
    summary: "Préparation opérationnelle : participants, chambres, hôtels, activités, guides, transports et fournisseurs.",
    workflow: ["Ouvrir le voyage opérationnel", "Compléter rooming", "Valider hôtels/transports", "Partager les infos utiles au fournisseur", "Suivre les éléments bloquants"],
    buttons: ["Exporter Excel prépare le dossier opérationnel", "Tout confirmer valide une section", "Tout remettre à faire réouvre le contrôle"],
    mistakes: ["Confirmer une section incomplète", "Partager des passeports hors contexte opérationnel"],
    bestPractices: ["Travailler par section", "Garder les commentaires fournisseurs dans le module dédié"],
  },
  {
    category: "Hotels",
    summary: "Catalogue hôtels, séjours rattachés aux voyages et modèles d’hébergement.",
    workflow: ["Vérifier le catalogue", "Créer les séjours voyage", "Contrôler nuits et dates", "Mettre à jour les notes opérationnelles"],
    buttons: ["Ajouter hôtel crée une entrée catalogue", "Appliquer modèle génère les séjours d’un voyage"],
    mistakes: ["Modifier une fiche catalogue pour une exception spécifique au voyage", "Écraser des séjours existants sans confirmation"],
    bestPractices: ["Utiliser les notes voyage pour les exceptions", "Conserver les dates relatives dans les modèles"],
  },
  {
    category: "Participants",
    summary: "Voyageurs liés aux réservations et aux opérations : identité, chambre, extras et remarques.",
    workflow: ["Vérifier la liste voyageurs", "Compléter les champs manquants", "Attribuer chambres", "Contrôler extras", "Exporter si nécessaire"],
    buttons: ["Ajouter voyageur complète une réservation", "Lier client évite les doublons CRM"],
    mistakes: ["Afficher des informations passeport sur un document public", "Créer un participant sans réservation liée"],
    bestPractices: ["Utiliser l’email de réservation comme référence", "Conserver les corrections dans la fiche client"],
  },
  {
    category: "Payments",
    summary: "Paiements, reçus, factures, soldes et documents financiers.",
    workflow: ["Enregistrer paiement", "Vérifier statut", "Générer reçu", "Créer facture selon paiement", "Contrôler reste à payer"],
    buttons: ["Créer facture choisit automatiquement proforma/acompte/finale", "Télécharger reçu produit le PDF"],
    mistakes: ["Marquer payé si le total final a changé", "Envoyer un document financier à un participant non propriétaire"],
    bestPractices: ["Comparer total, payé, solde sur chaque document", "Archiver plutôt que supprimer les clients avec historique"],
  },
  {
    category: "Partner Agencies",
    summary: "Organisations partenaires, onboarding, membres, accès et demandes agences.",
    workflow: ["Créer ou valider l’agence", "Configurer commissions", "Ajouter membres", "Valider onboarding", "Suivre les réservations et demandes FIT"],
    buttons: ["Ajouter agence partenaire crée l’organisation", "Envoyer invitation donne accès au portail", "Suspendre bloque l’accès opérationnel"],
    mistakes: ["Donner accès avant validation onboarding", "Créer une agence doublon avec le même ICE/email"],
    bestPractices: ["Vérifier ICE et email avant création", "Documenter toute exception commerciale"],
  },
  {
    category: "Supplier Portal",
    summary: "Espace fournisseurs/Bureau Japon pour devis, validation et préparation opérationnelle.",
    workflow: ["Assigner le voyage", "Contrôler les devis", "Valider checklist", "Exporter le dossier fournisseur"],
    buttons: ["Ouvrir le voyage affiche les onglets opérationnels", "Télécharger dossier complet exporte les feuilles clés"],
    mistakes: ["Donner accès admin générique à un fournisseur", "Afficher des données clients non liées au voyage assigné"],
    bestPractices: ["Toujours tester avec un compte fournisseur réel", "Limiter les données aux voyages assignés"],
  },
  {
    category: "Commission Engine",
    summary: "Règles de commission agence, commission personnelle agent et snapshots historiques.",
    workflow: ["Définir règle agence", "Définir règle agent", "Vérifier aperçu", "Geler snapshot à confirmation", "Suivre paiement commission"],
    buttons: ["Prévisualiser calcule gross/net/agent", "Override applique une exception documentée"],
    mistakes: ["Recalculer d’anciens dossiers après changement de règle", "Montrer la marge interne LeJapon.ma aux agences"],
    bestPractices: ["Toujours stocker une capture au moment de la vente", "Séparer commission agence et commission agent"],
  },
  {
    category: "Blog",
    summary: "Articles, SEO, traduction et images de partage social.",
    workflow: ["Créer article", "Coller/mettre en forme", "Vérifier SEO", "Ajouter image principale", "Publier"],
    buttons: ["Enregistrer brouillon conserve localement", "Publier rend l’article visible", "Generate EN + AR crée les traductions"],
    mistakes: ["Publier sans meta description", "Coller du HTML dans un titre traduit"],
    bestPractices: ["Utiliser H2/H3 pour la structure SEO", "Tester les aperçus WhatsApp sur un nouvel article"],
  },
  {
    category: "Email Templates",
    summary: "Templates transactionnels utilisés par réservations, visa, accords, client portal et admin.",
    workflow: ["Choisir template", "Modifier sujet/corps", "Vérifier variables", "Tester sur un cas réel contrôlé"],
    buttons: ["Enregistrer met à jour le template", "Logs email aide au diagnostic"],
    mistakes: ["Confondre templates applicatifs et emails Supabase Auth", "Supprimer une variable obligatoire"],
    bestPractices: ["Garder un fallback clair", "Tester les accents et montants avant production"],
  },
  {
    category: "Analytics",
    summary: "Suivi de performance, conversions, événements et signaux UX.",
    workflow: ["Lire les tendances", "Identifier route/module", "Corriger les causes globales", "Mesurer après déploiement"],
    buttons: ["Filtres période isolent les sessions", "Export prépare un audit externe"],
    mistakes: ["Optimiser une page sans vérifier le composant partagé", "Confondre LCP public et INP admin"],
    bestPractices: ["Traiter les problèmes partagés avant les micro-optimisations", "Documenter chaque hypothèse"],
  },
  {
    category: "Backups",
    summary: "Sauvegardes et points de contrôle avant changements majeurs.",
    workflow: ["Vérifier état git", "Build", "Commit", "Tag si stable", "Documenter le checkpoint"],
    buttons: ["Créer backup lance la procédure configurée", "Télécharger archive récupère un export"],
    mistakes: ["Committer des secrets", "Supprimer des migrations de production"],
    bestPractices: ["Créer un checkpoint avant les refontes larges", "Ne jamais inclure .env ou clés privées"],
  },
  {
    category: "Permissions",
    summary: "Rôles, accès modules, séparation admin/agence/fournisseur/client.",
    workflow: ["Identifier rôle", "Vérifier module", "Tester route directe", "Tester données visibles"],
    buttons: ["Attribuer rôle modifie l’autorisation", "Désactiver accès bloque l’utilisateur"],
    mistakes: ["Masquer une carte sans bloquer la route", "Réutiliser un rôle interdit ou obsolète"],
    bestPractices: ["Tester avec un vrai compte par rôle", "Protéger les requêtes, pas seulement l’interface"],
  },
  {
    category: "Settings",
    summary: "Paramètres système, email, thème, textes, traductions et intégrations.",
    workflow: ["Modifier un réglage", "Sauvegarder", "Tester le module concerné", "Documenter l’impact"],
    buttons: ["Thème applique le design admin", "Paramètres email contrôlent les envois applicatifs"],
    mistakes: ["Penser que les emails Auth Supabase sont gérés par les templates internes", "Changer une URL de production sans tester les redirects"],
    bestPractices: ["Préférer les changements réversibles", "Garder les valeurs production documentées"],
  },
];

export default function AdminUserGuide() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSections = useMemo(() => {
    if (!normalizedQuery) return GUIDE_SECTIONS;
    return GUIDE_SECTIONS.filter((section) =>
      [
        section.category,
        section.summary,
        ...section.workflow,
        ...section.buttons,
        ...section.mistakes,
        ...section.bestPractices,
      ].some((value) => value.toLowerCase().includes(normalizedQuery))
    );
  }, [normalizedQuery]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="FAQ & User Guide"
        description="Documentation interne searchable pour utiliser l’administration LeJapon.ma avec des workflows clairs et cohérents."
      />

      <Card>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher un module, bouton, workflow ou bonne pratique..."
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{GUIDE_SECTIONS.length} catégories</Badge>
            <Badge variant="outline">{filteredSections.length} résultat(s)</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {filteredSections.map((section) => (
          <Card key={section.category} className="overflow-hidden">
            <CardContent className="space-y-5 p-5">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-accent" />
                  <h2 className="text-lg font-semibold tracking-normal">{section.category}</h2>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">{section.summary}</p>
              </div>

              <GuideList icon={<Workflow className="h-4 w-4" />} title="Workflow type" items={section.workflow} />
              <GuideList title="Boutons et actions" items={section.buttons} />
              <GuideList title="Erreurs fréquentes" items={section.mistakes} tone="warning" />
              <GuideList icon={<CheckCircle2 className="h-4 w-4" />} title="Bonnes pratiques" items={section.bestPractices} tone="success" />
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredSections.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Aucun résultat. Essayez un autre mot-clé comme réservation, visa, commission ou email.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GuideList({
  title,
  items,
  icon,
  tone = "neutral",
}: {
  title: string;
  items: string[];
  icon?: ReactNode;
  tone?: "neutral" | "warning" | "success";
}) {
  const markerClass = tone === "warning"
    ? "bg-amber-500"
    : tone === "success"
      ? "bg-emerald-500"
      : "bg-slate-400";

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {icon}
        {title}
      </h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-6">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${markerClass}`} aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
