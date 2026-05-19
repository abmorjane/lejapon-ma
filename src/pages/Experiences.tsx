import { useTranslation } from "react-i18next";
import { Seo } from "@/components/Seo";
import { useExtras, fmtExtraPrice } from "@/hooks/useExtras";
import { Img } from "@/components/ui/Img";
import tea from "@/assets/tea-ceremony.jpg";
import shibuya from "@/assets/tokyo-shibuya.jpg";
import ramen from "@/assets/ramen.jpg";
import kyoto from "@/assets/kyoto-alley.jpg";
import torii from "@/assets/torii.jpg";

const fallbackImgs = [tea, shibuya, ramen, kyoto, torii, tea];

const Experiences = () => {
  const { t } = useTranslation();
  const { extras, loading } = useExtras();
  return (
    <div className="container-app py-20 md:py-28">
      <Seo
        title="Extra plans & expériences au Japon — lejapon.ma"
        description="Tokyo Disneyland, teamLab Planets, Universal Studios, soirée geisha, cérémonie du thé, geisha make-up : ajoutez des expériences uniques à votre voyage au Japon."
        canonical="/experiences"
      />
      <p className="eyebrow mb-4">{t("experiences.eyebrow")}</p>
      <h1 className="font-display text-5xl md:text-7xl mb-6 max-w-3xl">{t("experiences.title")}</h1>
      <p className="max-w-2xl text-foreground/70 text-lg mb-16">{t("experiences.body")}</p>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
        {extras.map((e, i) => (
          <article key={e.id} className="bg-background group">
            <div className="aspect-[4/3] overflow-hidden">
              <Img
                src={e.image_url || fallbackImgs[i % fallbackImgs.length]}
                alt={e.alt_text || e.name}
                preset="card"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-silk"
              />
            </div>
            <div className="p-8">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="font-display text-2xl">{e.name}</h3>
                <span className="text-accent text-sm whitespace-nowrap">{fmtExtraPrice(e.price_mad)}</span>
              </div>
              <p className="text-sm text-foreground/70">{e.description}</p>
            </div>
          </article>
        ))}
        {!loading && extras.length === 0 && (
          <p className="bg-background p-8 text-foreground/60 col-span-full">Aucune expérience disponible pour le moment.</p>
        )}
      </div>
    </div>
  );
};
export default Experiences;
