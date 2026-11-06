import { eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./index";
import { branches, branchStock, media, productCategories, productPrices, products, stockMovements } from "./schema";

/**
 * Sample shop (R9): five aisles and ~25 items so the shop's search, filters, paging and cart can be tried.
 * Runs once (no categories yet) and only where sample data is allowed. Real items replace these before launch.
 */
const CATEGORIES = [
  { slug: "apparel", en: "Apparel", ar: "الملابس", dEn: "Training wear cut for the harness.", dAr: "ملابس تدريب مصممة لتناسب الحزام." },
  { slug: "grip", en: "Grip & socks", ar: "الجوارب والقبضة", dEn: "Stay planted on the mat.", dAr: "ثبات أكثر على البساط." },
  { slug: "hydration", en: "Hydration", ar: "الترطيب", dEn: "Bottles and electrolytes for every class.", dAr: "قوارير وأملاح معدنية لكل حصة." },
  { slug: "gear", en: "Training gear", ar: "معدات التدريب", dEn: "Keep training between classes.", dAr: "واصل التمرين بين الحصص." },
  { slug: "accessories", en: "Accessories", ar: "الإكسسوارات", dEn: "Towels, bags and the small things.", dAr: "مناشف وحقائب وأشياء صغيرة مفيدة." },
] as const;

type Item = {
  slug: string;
  cat: (typeof CATEGORIES)[number]["slug"];
  price: number;
  was?: number;
  kids?: boolean;
  featured?: boolean;
  image?: string;
  stock?: [number, number, number];
  en: string;
  ar: string;
  dEn: string;
  dAr: string;
};

const ITEMS: Item[] = [
  { slug: "flight-tee", cat: "apparel", price: 120, en: "Flight tee", ar: "تيشيرت فلايت", dEn: "Breathable training tee with flat seams that won't rub under the harness.", dAr: "تيشيرت تدريب يسمح بالتهوية بدرزات مسطحة لا تحتك تحت الحزام." },
  { slug: "harness-leggings", cat: "apparel", price: 220, featured: true, en: "Harness leggings", ar: "ليقنز الحزام", dEn: "High waist, squat-proof fabric and a smooth waistband for the harness.", dAr: "خصر عالٍ وقماش غير شفاف وحزام خصر ناعم يناسب حزام البانجي." },
  { slug: "cord-sports-bra", cat: "apparel", price: 160, en: "Cord sports bra", ar: "حمالة رياضية", dEn: "Medium support, racer back, removable pads.", dAr: "دعم متوسط بظهر رياضي وبطانة قابلة للإزالة." },
  { slug: "studio-hoodie", cat: "apparel", price: 260, was: 300, featured: true, en: "Studio hoodie", ar: "هودي الاستوديو", dEn: "Heavy cotton fleece for the drive home.", dAr: "هودي قطني ثقيل لطريق العودة إلى البيت." },
  { slug: "training-shorts", cat: "apparel", price: 140, en: "Training shorts", ar: "شورت تدريب", dEn: "Lightweight with a built-in liner and a zip pocket.", dAr: "خفيف ببطانة داخلية وجيب بسحاب." },
  { slug: "kids-flyer-tee", cat: "apparel", price: 85, kids: true, en: "Kids flyer tee", ar: "تيشيرت الطيّار الصغير", dEn: "Soft cotton tee for Kids Fly and Mini Fly. Ages 4 to 12.", dAr: "تيشيرت قطني ناعم لحصص كيدز فلاي وميني فلاي. من 4 إلى 12 سنة." },
  { slug: "kids-grip-socks", cat: "grip", price: 35, kids: true, stock: [20, 2, 9], en: "Kids grip socks", ar: "جوارب أطفال مانعة للانزلاق", dEn: "Non-slip soles in small sizes.", dAr: "نعل مانع للانزلاق بمقاسات صغيرة." },
  { slug: "toe-grip-socks", cat: "grip", price: 55, en: "Toe grip socks", ar: "جوارب بأصابع مانعة للانزلاق", dEn: "Five-toe design for balance work on the mat.", dAr: "تصميم بخمسة أصابع لتمارين التوازن على البساط." },
  { slug: "grip-gloves", cat: "grip", price: 75, was: 90, en: "Grip gloves", ar: "قفازات قبضة", dEn: "Half-finger gloves for a firm hold on the cord.", dAr: "قفازات نصف أصابع لقبضة ثابتة على الحبل." },
  { slug: "shaker-bottle", cat: "hydration", price: 45, en: "Shaker bottle", ar: "زجاجة خلط", dEn: "600 ml with a steel whisk ball.", dAr: "سعة 600 مل مع كرة خلط معدنية." },
  { slug: "electrolyte-tabs", cat: "hydration", price: 40, stock: [0, 14, 6], en: "Electrolyte tablets (20)", ar: "أقراص أملاح معدنية (20)", dEn: "Sugar-free, citrus. One tablet per bottle.", dAr: "خالية من السكر بنكهة الحمضيات. قرص واحد لكل قارورة." },
  { slug: "insulated-tumbler", cat: "hydration", price: 95, en: "Insulated tumbler", ar: "كوب معزول", dEn: "Keeps iced coffee cold through a double class.", dAr: "يحافظ على برودة القهوة المثلجة طوال حصتين." },
  { slug: "training-mat", cat: "gear", price: 180, featured: true, image: "kit-mat", en: "Training mat", ar: "بساط التدريب", dEn: "6 mm, non-slip, with a carry strap.", dAr: "سماكة 6 مم، مانع للانزلاق، مع حزام للحمل." },
  { slug: "resistance-band-set", cat: "gear", price: 110, en: "Resistance band set", ar: "مجموعة أحزمة مقاومة", dEn: "Three strengths with handles and a door anchor.", dAr: "ثلاث درجات مقاومة مع مقابض ومثبّت للباب." },
  { slug: "mini-loop-bands", cat: "gear", price: 50, en: "Mini loop bands", ar: "أحزمة دائرية صغيرة", dEn: "Five fabric loops for glutes and hips.", dAr: "خمس حلقات قماشية لتمارين الأرداف والورك." },
  { slug: "foam-roller", cat: "gear", price: 130, en: "Foam roller", ar: "أسطوانة تدليك", dEn: "Firm, textured, 33 cm. For tight calves and backs.", dAr: "صلبة ومحززة بطول 33 سم، للسمانة والظهر المشدود." },
  { slug: "ankle-weights", cat: "gear", price: 120, stock: [0, 0, 0], en: "Ankle weights (2 × 1 kg)", ar: "أثقال الكاحل (2 × 1 كغ)", dEn: "Adjustable straps for floor work.", dAr: "أحزمة قابلة للتعديل لتمارين الأرض." },
  { slug: "microfibre-towel", cat: "accessories", price: 55, en: "Microfibre towel", ar: "منشفة ألياف دقيقة", dEn: "Quick-dry, folds into its own pouch.", dAr: "سريعة الجفاف وتُطوى داخل حقيبتها." },
  { slug: "gym-duffel", cat: "accessories", price: 240, en: "Gym duffel", ar: "حقيبة رياضية", dEn: "Shoe compartment and a wet pocket.", dAr: "قسم للحذاء وجيب للملابس المبللة." },
  { slug: "wristbands", cat: "accessories", price: 30, en: "Wristbands (pair)", ar: "أساور معصم (زوج)", dEn: "Terry cotton, navy with the orange mark.", dAr: "قطن قطيفة كحلي بالشعار البرتقالي." },
  { slug: "hair-ties", cat: "accessories", price: 20, stock: [40, 30, 2], en: "Hair ties (6)", ar: "ربطات شعر (6)", dEn: "No-snag ties that hold through inversions.", dAr: "ربطات لا تشد الشعر وتثبت أثناء الانقلاب." },
];

/** Existing seed items, moved into aisles. */
const EXISTING: Record<string, (typeof CATEGORIES)[number]["slug"]> = {
  "steel-bottle": "hydration",
  "grip-socks": "grip",
  "team-cap": "accessories",
};

const qar = (riyals: number) => riyals * 100;

export async function seedShopIfEmpty(db: Database) {
  const demo = process.env.BF_DEMO_DB === "1" || Boolean(process.env.NETLIFY);
  if (process.env.NODE_ENV === "production" && !demo && process.env.SEED_SAMPLE_DATA !== "1") return;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(productCategories);
  if (Number(n) > 0) return;
  const studios = await db.select({ id: branches.id, slug: branches.slug }).from(branches);
  if (!studios.length) return;
  const order = ["lusail-marina", "west-bay", "al-waab"];
  const byIndex = (i: number) => studios.find((s) => s.slug === order[i]) ?? studios[i % studios.length];
  console.log("[seed] Sample shop: categories and items");

  await db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    const cats = await t
      .insert(productCategories)
      .values(
        CATEGORIES.map((c, i) => ({
          slug: c.slug,
          nameEn: c.en,
          nameAr: c.ar,
          descriptionEn: c.dEn,
          descriptionAr: c.dAr,
          sortOrder: i,
        })),
      )
      .returning({ id: productCategories.id, slug: productCategories.slug });
    const catId = (slug: string) => cats.find((c) => c.slug === slug)?.id ?? null;

    for (const [slug, cat] of Object.entries(EXISTING)) {
      await t.update(products).set({ categoryId: catId(cat) }).where(eq(products.slug, slug));
    }
    await t.update(products).set({ isFeatured: true }).where(eq(products.slug, "steel-bottle"));

    const keys = [...new Set(ITEMS.map((i) => i.image).filter(Boolean))] as string[];
    const mediaRows = keys.length
      ? await t
          .select({ id: media.id, key: media.storageKey })
          .from(media)
          .where(inArray(media.storageKey, keys.map((k) => `placeholder/${k}.webp`)))
      : [];
    const existing = await t.select({ slug: products.slug }).from(products);

    for (const [i, item] of ITEMS.entries()) {
      if (existing.some((e) => e.slug === item.slug)) continue;
      const [row] = await t
        .insert(products)
        .values({
          slug: item.slug,
          type: "retail",
          audience: item.kids ? "kids" : "all",
          nameEn: item.en,
          nameAr: item.ar,
          descriptionEn: item.dEn,
          descriptionAr: item.dAr,
          sku: `BF-${item.slug.toUpperCase()}`,
          trackStock: true,
          isFeatured: item.featured ?? false,
          imageMediaId: item.image ? (mediaRows.find((m) => m.key === `placeholder/${item.image}.webp`)?.id ?? null) : null,
          categoryId: catId(item.cat),
          sortOrder: 100 + i,
        })
        .returning({ id: products.id });
      await t.insert(productPrices).values({ productId: row.id, branchId: null, amount: qar(item.price), compareAt: item.was ? qar(item.was) : null });
      const stock = item.stock ?? [6 + ((i * 7) % 28), (i * 5) % 22, 1 + ((i * 3) % 13)];
      const lines = stock.map((quantity, s) => ({ productId: row.id, branchId: byIndex(s).id, quantity }));
      await t.insert(branchStock).values(lines).onConflictDoNothing();
      const opening = lines.filter((l) => l.quantity > 0);
      if (opening.length) {
        await t.insert(stockMovements).values(
          opening.map((l) => ({
            productId: l.productId,
            branchId: l.branchId,
            delta: l.quantity,
            quantityAfter: l.quantity,
            reason: "restock" as const,
            note: "Opening stock",
          })),
        );
      }
    }
  });
}
