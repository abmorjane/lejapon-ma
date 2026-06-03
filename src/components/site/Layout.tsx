import { Outlet } from "react-router-dom";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { ConversionLeadPopup } from "./ConversionLeadPopup";

export const SiteLayout = () => (
  <div className="min-h-screen flex flex-col bg-background">
    <Header />
    <main className="flex-1">
      <Outlet />
    </main>
    <ConversionLeadPopup />
    <Footer />
  </div>
);
