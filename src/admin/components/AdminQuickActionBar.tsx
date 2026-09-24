import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, CreditCard, FileText, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

const CreateBookingDialog = lazy(() => import("./CreateBookingDialog").then((module) => ({ default: module.CreateBookingDialog })));
const AdminPaymentDialog = lazy(() => import("./AdminPaymentDialog").then((module) => ({ default: module.AdminPaymentDialog })));

export function AdminQuickActionBar() {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const actions = [
    { label: "Ajouter client", icon: UserPlus, to: "/admin/clients?new=1" },
    { label: "Ajouter demande visa", icon: FileText, to: "/admin/visa?new=1" },
  ];

  return (
    <>
      <div className="sticky top-0 z-10 -mx-3 mb-3 border-b border-border bg-background/95 px-3 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0 lg:mx-0 lg:mb-4 lg:rounded-xl lg:border lg:shadow-sm">
        <div className="hidden items-center gap-2 lg:flex">
          <p className="mr-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Actions rapides</p>
          <Button size="sm" className="h-9" onClick={() => setBookingOpen(true)}>
            <CalendarCheck className="h-4 w-4" /> Ajouter réservation
          </Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => setPaymentOpen(true)}>
            <CreditCard className="h-4 w-4" /> Ajouter paiement
          </Button>
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Button key={action.label} asChild size="sm" variant="outline" className="h-9">
                <Link to={action.to}><Icon className="h-4 w-4" /> {action.label}</Link>
              </Button>
            );
          })}
        </div>
        <div className="grid grid-cols-4 gap-1 lg:hidden" aria-label="Actions rapides">
          <Button size="sm" className="h-12 min-w-0 flex-col gap-0.5 rounded-xl px-1 text-xs" onClick={() => setBookingOpen(true)}>
            <CalendarCheck className="h-3.5 w-3.5" /> Réservation
          </Button>
          <Button size="sm" variant="outline" className="h-12 min-w-0 flex-col gap-0.5 rounded-xl px-1 text-xs" onClick={() => setPaymentOpen(true)}>
            <CreditCard className="h-3.5 w-3.5" /> Paiement
          </Button>
          <Button asChild size="sm" variant="outline" className="h-12 min-w-0 flex-col gap-0.5 rounded-xl px-1 text-xs">
            <Link to="/admin/clients?new=1"><UserPlus className="h-3.5 w-3.5" /> Client</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-12 min-w-0 flex-col gap-0.5 rounded-xl px-1 text-xs">
            <Link to="/admin/visa?new=1"><FileText className="h-3.5 w-3.5" /> Visa</Link>
          </Button>
        </div>
      </div>
      <Suspense fallback={null}>
        {bookingOpen && <CreateBookingDialog open={bookingOpen} onOpenChange={setBookingOpen} />}
        {paymentOpen && <AdminPaymentDialog open={paymentOpen} onOpenChange={setPaymentOpen} />}
      </Suspense>
    </>
  );
}
