import { sql } from "drizzle-orm";
import { materializeSessions } from "../schedule/materialize";
import type { Database } from "./index";
import {
  banners,
  branchHours,
  branchStock,
  branches,
  classTypes,
  coaches,
  media,
  productClassTypes,
  productPrices,
  products,
  scheduleTemplates,
  settings,
  stockMovements,
} from "./schema";

/**
 * SAMPLE DATA for local development and client review. Studios, coaches, timetables and prices
 * are placeholders until the real Qatar data is entered in admin. Never runs in production
 * unless SEED_SAMPLE_DATA=1 is set explicitly.
 */

const MEDIA = [
  { key: "hero-lift", w: 1679, h: 937, fx: 0.62, fy: 0.42, en: "A flyer mid-lift on the cord, lit in orange against a dark studio", ar: "متدربة في منتصف الارتفاع على الحبل، بإضاءة برتقالية في استوديو داكن" },
  { key: "studio-class", w: 1098, h: 732, fx: 0.5, fy: 0.45, en: "A group class on the rigs in a bright studio", ar: "حصة جماعية على الأجهزة في استوديو مضيء" },
  { key: "class-inversion", w: 612, h: 408, fx: 0.5, fy: 0.4, en: "A flyer holding an inverted position, supported by the cord", ar: "متدربة في وضعية مقلوبة يدعمها الحبل" },
  { key: "class-motion", w: 612, h: 408, fx: 0.5, fy: 0.4, en: "Flyers moving together through a sequence", ar: "متدربون يتحركون معًا في تسلسل واحد" },
  { key: "cord-grip", w: 612, h: 408, fx: 0.5, fy: 0.5, en: "Close-up of hands gripping the bungee cord", ar: "لقطة قريبة ليدين تمسكان بحبل البانجي" },
  { key: "kit-mat", w: 900, h: 1123, fx: 0.5, fy: 0.5, en: "Bungee Fly mat and kit laid out before class", ar: "سجادة وأدوات بانجي فلاي قبل الحصة" },
  { key: "kit-bottle", w: 708, h: 885, fx: 0.5, fy: 0.5, en: "Bungee Fly steel water bottle", ar: "قارورة ماء بانجي فلاي" },
  { key: "kit-cap", w: 732, h: 732, fx: 0.5, fy: 0.5, en: "Bungee Fly cap", ar: "قبعة بانجي فلاي" },
] as const;

const CLASS_TYPES = [
  {
    slug: "bungee-flow", cover: "studio-class", audience: "adults", format: "group", level: "beginner",
    minAge: 14, maxAge: null, duration: 45, cap: 12, intensity: 2,
    nameEn: "Bungee Flow", nameAr: "بانجي فلو",
    taglineEn: "Your first flight. Fitted, coached, unhurried.", taglineAr: "رحلتك الأولى. تجهيز كامل وتدريب هادئ بلا استعجال.",
    descEn: "The foundation class. We fit your harness, teach you the cord, then build a flowing sequence of lifts, dips and landings that is easy on the joints.",
    descAr: "الحصة التأسيسية. نجهّز الحزام ونعلّمك التعامل مع الحبل، ثم نبني تسلسلًا انسيابيًا من الارتفاع والهبوط، لطيفًا على المفاصل.",
  },
  {
    slug: "bungee-burn", cover: "class-inversion", audience: "adults", format: "group", level: "intermediate",
    minAge: 16, maxAge: null, duration: 45, cap: 10, intensity: 4,
    nameEn: "Bungee Burn", nameAr: "بانجي بيرن",
    taglineEn: "Intervals with a spring in them.", taglineAr: "تمارين متقطعة بنبض مرن.",
    descEn: "Cord-resisted sprints, jumps and holds. Built for flyers with three or more sessions behind them.",
    descAr: "عدْو وقفزات وثبات بمقاومة الحبل. مصممة لمن خاض ثلاث حصص أو أكثر.",
  },
  {
    slug: "bungee-sculpt", cover: "class-motion", audience: "adults", format: "group", level: "all",
    minAge: 14, maxAge: null, duration: 45, cap: 10, intensity: 3,
    nameEn: "Bungee Sculpt", nameAr: "بانجي سكلبت",
    taglineEn: "Slow tempo. Deep strength.", taglineAr: "إيقاع بطيء. قوة عميقة.",
    descEn: "The cord carries part of your bodyweight, so you can hold longer, align better and work the core properly.",
    descAr: "يحمل الحبل جزءًا من وزنك، لتثبت لفترة أطول وتضبط وضعيتك وتعمل على عضلات الجذع كما يجب.",
  },
  {
    slug: "kids-fly", cover: "class-motion", audience: "kids", format: "group", level: "all",
    minAge: 6, maxAge: 12, duration: 45, cap: 8, intensity: 2,
    nameEn: "Kids Fly", nameAr: "كيدز فلاي",
    taglineEn: "Play, with proper technique.", taglineAr: "لعب، بتقنية صحيحة.",
    descEn: "Ages 6 to 12. Games, balance and confidence on the cord, led by coaches trained to work with children.",
    descAr: "من 6 إلى 12 سنة. ألعاب وتوازن وثقة على الحبل، بقيادة مدربين مؤهلين للعمل مع الأطفال.",
  },
  {
    slug: "mini-fly", cover: "cord-grip", audience: "kids", format: "group", level: "all",
    minAge: 3, maxAge: 5, duration: 30, cap: 6, intensity: 1,
    nameEn: "Mini Fly", nameAr: "ميني فلاي",
    taglineEn: "First bounces, parent close by.", taglineAr: "أولى القفزات، والأهل بالقرب.",
    descEn: "Ages 3 to 5. Short, gentle sessions that build coordination. A parent stays in the studio throughout.",
    descAr: "من 3 إلى 5 سنوات. حصص قصيرة ولطيفة تبني التناسق الحركي، مع بقاء أحد الوالدين في الاستوديو طوال الوقت.",
  },
  {
    slug: "private", cover: "class-inversion", audience: "all", format: "private", level: "all",
    minAge: 6, maxAge: null, duration: 45, cap: 1, intensity: null,
    nameEn: "Private 1:1", nameAr: "جلسة خاصة",
    taglineEn: "One coach. One flyer. Your goals.", taglineAr: "مدرب واحد. متدرب واحد. أهدافك أنت.",
    descEn: "Tailored to you: first-timers who want space, athletes chasing a skill, or anyone returning from injury.",
    descAr: "مصممة لك: لمن يجرّب للمرة الأولى ويريد مساحته، أو لرياضي يطارد مهارة، أو للعائد من إصابة.",
  },
] as const;

const BRANCHES = [
  {
    slug: "lusail-marina", cover: "studio-class", stations: 8, lat: 25.3858, lng: 51.525,
    nameEn: "Lusail Marina", nameAr: "مارينا لوسيل",
    shortEn: "Our flagship. Eight rigs and floor-to-ceiling views of the marina.", shortAr: "فرعنا الرئيسي. ثمانية أجهزة وإطلالة كاملة على المارينا.",
    addressEn: "Marina District, Lusail", addressAr: "حي المارينا، لوسيل",
  },
  {
    slug: "west-bay", cover: "class-inversion", stations: 6, lat: 25.3226, lng: 51.531,
    nameEn: "West Bay", nameAr: "الخليج الغربي",
    shortEn: "Lunch-hour classes, a short walk from the towers.", shortAr: "حصص وقت الغداء، على بعد خطوات من الأبراج.",
    addressEn: "Diplomatic Area, West Bay, Doha", addressAr: "المنطقة الدبلوماسية، الخليج الغربي، الدوحة",
  },
  {
    slug: "al-waab", cover: "class-motion", stations: 8, lat: 25.26, lng: 51.47,
    nameEn: "Al Waab", nameAr: "الوعب",
    shortEn: "The family studio, with a dedicated kids' room.", shortAr: "استوديو العائلة، مع غرفة مخصصة للأطفال.",
    addressEn: "Al Waab Street, Doha", addressAr: "شارع الوعب، الدوحة",
  },
] as const;

const COACHES = [
  { slug: "maya-haddad", nameEn: "Maya Haddad", nameAr: "مايا حداد", titleEn: "Head Coach", titleAr: "المدربة الرئيسية", branch: "lusail-marina" },
  { slug: "noor-alkuwari", nameEn: "Noor Al-Kuwari", nameAr: "نور الكواري", titleEn: "Coach", titleAr: "مدربة", branch: "lusail-marina" },
  { slug: "omar-saleh", nameEn: "Omar Saleh", nameAr: "عمر صالح", titleEn: "Coach", titleAr: "مدرب", branch: "west-bay" },
  { slug: "daniel-reyes", nameEn: "Daniel Reyes", nameAr: "دانيال رييس", titleEn: "Coach", titleAr: "مدرب", branch: "west-bay" },
  { slug: "lina-farouk", nameEn: "Lina Farouk", nameAr: "لينا فاروق", titleEn: "Kids Lead", titleAr: "مسؤولة برامج الأطفال", branch: "al-waab" },
] as const;

const STAFF: Record<string, { kids: string; a: string; b: string }> = {
  "lusail-marina": { kids: "noor-alkuwari", a: "maya-haddad", b: "noor-alkuwari" },
  "west-bay": { kids: "daniel-reyes", a: "omar-saleh", b: "daniel-reyes" },
  "al-waab": { kids: "lina-farouk", a: "lina-farouk", b: "maya-haddad" },
};

/** Weekly slots per studio. Gulf weekend = Friday (5) + Saturday (6). */
function slotsFor(branch: string, weekday: number): [string, string][] {
  if (weekday === 5) return [["15:00", "kids-fly"], ["16:30", "bungee-flow"], ["18:00", "bungee-burn"], ["19:30", "bungee-sculpt"]];
  if (weekday === 6)
    return [["09:00", "mini-fly"], ["10:00", "kids-fly"], ["11:15", "bungee-flow"], ["17:00", "bungee-burn"], ["18:30", "bungee-flow"]];
  const s: [string, string][] = [
    ["06:30", "bungee-flow"],
    ["07:30", weekday % 2 === 0 ? "bungee-burn" : "bungee-sculpt"],
    ["10:00", "private"],
    ["14:00", "private"],
    ["18:00", "bungee-burn"],
    ["19:15", "bungee-flow"],
    ["20:30", "bungee-sculpt"],
  ];
  if (branch === "west-bay") s.push(["12:15", "bungee-flow"]);
  if (branch !== "west-bay") s.push(["16:00", "kids-fly"]);
  if (branch === "al-waab" || weekday === 1 || weekday === 3) s.push(["17:00", "mini-fly"]);
  return s.sort((a, b) => a[0].localeCompare(b[0]));
}

const qar = (riyals: number) => riyals * 100;
const ADULT = ["bungee-flow", "bungee-burn", "bungee-sculpt"];
const KIDS = ["kids-fly", "mini-fly"];

const PRODUCTS = [
  { slug: "first-flight", type: "class_pack", audience: "adults", credits: 2, days: 14, price: 180, compareAt: 260, intro: true, max: 1, featured: false, types: ADULT,
    nameEn: "First Flight", nameAr: "الرحلة الأولى", descEn: "Two classes for first-timers, harness fitting included.", descAr: "حصتان لمن يجرّب لأول مرة، مع تجهيز الحزام." },
  { slug: "adult-drop-in", type: "class_pack", audience: "adults", credits: 1, days: 30, price: 130, types: ADULT,
    nameEn: "Drop-in", nameAr: "حصة واحدة", descEn: "One class, any adult format.", descAr: "حصة واحدة من أي برنامج للبالغين." },
  { slug: "adult-5", type: "class_pack", audience: "adults", credits: 5, days: 60, price: 575, types: ADULT, branch: { "west-bay": 600 },
    nameEn: "5 Classes", nameAr: "5 حصص", descEn: "A steady start, valid for two months.", descAr: "بداية ثابتة، صالحة لمدة شهرين." },
  { slug: "adult-10", type: "class_pack", audience: "adults", credits: 10, days: 90, price: 1050, featured: true, types: ADULT, branch: { "west-bay": 1100 },
    nameEn: "10 Classes", nameAr: "10 حصص", descEn: "Our most chosen pack. Two to three classes a week.", descAr: "الباقة الأكثر اختيارًا. حصتان إلى ثلاث أسبوعيًا." },
  { slug: "adult-20", type: "class_pack", audience: "adults", credits: 20, days: 150, price: 1900, types: ADULT, branch: { "west-bay": 1990 },
    nameEn: "20 Classes", nameAr: "20 حصة", descEn: "For regulars. The lowest price per class.", descAr: "للمواظبين. أقل سعر للحصة." },
  { slug: "kids-drop-in", type: "class_pack", audience: "kids", credits: 1, days: 30, price: 110, types: KIDS,
    nameEn: "Kids drop-in", nameAr: "حصة أطفال واحدة", descEn: "One Kids Fly or Mini Fly class.", descAr: "حصة واحدة من كيدز فلاي أو ميني فلاي." },
  { slug: "kids-8", type: "class_pack", audience: "kids", credits: 8, days: 60, price: 800, featured: true, types: KIDS,
    nameEn: "8-class term", nameAr: "فصل من 8 حصص", descEn: "Once a week for two months.", descAr: "مرة أسبوعيًا لمدة شهرين." },
  { slug: "kids-16", type: "class_pack", audience: "kids", credits: 16, days: 120, price: 1440, types: KIDS,
    nameEn: "16-class term", nameAr: "فصل من 16 حصة", descEn: "Twice a week, or a longer term.", descAr: "مرتان أسبوعيًا، أو فصل أطول." },
  { slug: "private-1", type: "class_pack", audience: "all", credits: 1, days: 60, price: 350, types: ["private"],
    nameEn: "Private session", nameAr: "جلسة خاصة", descEn: "One-to-one, 45 minutes.", descAr: "جلسة فردية مدتها 45 دقيقة." },
  { slug: "private-5", type: "class_pack", audience: "all", credits: 5, days: 120, price: 1600, featured: true, types: ["private"],
    nameEn: "5 private sessions", nameAr: "5 جلسات خاصة", descEn: "A short programme towards one goal.", descAr: "برنامج قصير نحو هدف واحد." },
  { slug: "extension-30", type: "extension", audience: "all", credits: null, days: 30, price: 100, types: [],
    nameEn: "30-day extension", nameAr: "تمديد 30 يومًا", descEn: "Add 30 days to an active pack.", descAr: "أضف 30 يومًا إلى باقة فعّالة." },
  { slug: "inbody", type: "service", audience: "all", credits: null, days: null, price: 75, types: [],
    nameEn: "InBody assessment", nameAr: "تقييم InBody", descEn: "Body composition scan with a coach.", descAr: "تحليل تكوين الجسم مع مدرب." },
  { slug: "steel-bottle", type: "retail", audience: "all", credits: null, days: null, price: 85, types: [],
    nameEn: "Steel bottle", nameAr: "قارورة ستانلس", descEn: "750 ml, keeps water cold all class.", descAr: "سعة 750 مل، تحفظ الماء باردًا طوال الحصة." },
  { slug: "grip-socks", type: "retail", audience: "all", credits: null, days: null, price: 45, types: [],
    nameEn: "Grip socks", nameAr: "جوارب مانعة للانزلاق", descEn: "Non-slip soles for the mat. One size.", descAr: "نعل مانع للانزلاق على البساط. مقاس واحد." },
  { slug: "team-cap", type: "retail", audience: "all", credits: null, days: null, price: 65, types: [],
    nameEn: "Team cap", nameAr: "قبعة الفريق", descEn: "Navy cotton cap with the Bungee Fly mark.", descAr: "قبعة قطنية كحلية بشعار بانجي فلاي." },
] as const;

/** Opening shop stock per branch (R9). Al Waab runs low on socks to show the low-stock state. */
const STOCK: Record<string, Record<string, number>> = {
  "steel-bottle": { "lusail-marina": 24, "west-bay": 18, "al-waab": 12 },
  "grip-socks": { "lusail-marina": 40, "west-bay": 30, "al-waab": 2 },
  "team-cap": { "lusail-marina": 15, "west-bay": 0, "al-waab": 10 },
};
const RETAIL_MEDIA: Record<string, string> = { "steel-bottle": "kit-bottle", "team-cap": "kit-cap" };

type ProductSeed = (typeof PRODUCTS)[number] & {
  compareAt?: number;
  intro?: boolean;
  max?: number;
  featured?: boolean;
  branch?: Record<string, number>;
};

export async function seedIfEmpty(db: Database) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(branches);
  if (n > 0) return;
  // Real production Postgres is never auto-seeded; the in-memory preview DB (BF_DEMO_DB) always is.
  const demo = process.env.BF_DEMO_DB === "1" || Boolean(process.env.NETLIFY);
  if (process.env.NODE_ENV === "production" && !demo && process.env.SEED_SAMPLE_DATA !== "1") return;
  console.log("[seed] Empty database — inserting sample data");

  await db.transaction(async (tx) => {
    const t = tx as unknown as Database;

    const mediaRows = await t
      .insert(media)
      .values(
        MEDIA.map((m) => ({
          kind: "image" as const,
          storageKey: `placeholder/${m.key}.webp`,
          url: `/media/placeholder/${m.key}.webp`,
          mimeType: "image/webp",
          width: m.w,
          height: m.h,
          altEn: m.en,
          altAr: m.ar,
          focalX: m.fx,
          focalY: m.fy,
        })),
      )
      .returning({ id: media.id, key: media.storageKey });
    const mediaId = (key: string) => mediaRows.find((r) => r.key === `placeholder/${key}.webp`)?.id ?? null;

    const branchRows = await t
      .insert(branches)
      .values(
        BRANCHES.map((b, i) => ({
          slug: b.slug,
          nameEn: b.nameEn,
          nameAr: b.nameAr,
          shortEn: b.shortEn,
          shortAr: b.shortAr,
          addressEn: b.addressEn,
          addressAr: b.addressAr,
          latitude: b.lat,
          longitude: b.lng,
          phone: "+974 4000 0000",
          whatsapp: "+974 5000 0000",
          email: "hello@bungeefly.qa",
          stations: b.stations,
          coverMediaId: mediaId(b.cover),
          sortOrder: i,
        })),
      )
      .returning({ id: branches.id, slug: branches.slug });
    const branchId = (slug: string) => branchRows.find((r) => r.slug === slug)!.id;

    await t.insert(branchHours).values(
      branchRows.flatMap((b) =>
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          branchId: b.id,
          weekday,
          opensAt: weekday === 5 ? "14:00" : weekday === 6 ? "08:00" : "06:00",
          closesAt: weekday <= 4 ? "22:00" : "21:00",
        })),
      ),
    );

    const typeRows = await t
      .insert(classTypes)
      .values(
        CLASS_TYPES.map((c, i) => ({
          slug: c.slug,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          taglineEn: c.taglineEn,
          taglineAr: c.taglineAr,
          descriptionEn: c.descEn,
          descriptionAr: c.descAr,
          audience: c.audience,
          format: c.format,
          level: c.level,
          minAge: c.minAge,
          maxAge: c.maxAge,
          durationMinutes: c.duration,
          defaultCapacity: c.cap,
          intensity: c.intensity,
          coverMediaId: mediaId(c.cover),
          sortOrder: i,
        })),
      )
      .returning({ id: classTypes.id, slug: classTypes.slug });
    const typeId = (slug: string) => typeRows.find((r) => r.slug === slug)!.id;
    const typeSeed = (slug: string) => CLASS_TYPES.find((c) => c.slug === slug)!;

    const coachRows = await t
      .insert(coaches)
      .values(
        COACHES.map((c, i) => ({
          slug: c.slug,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          titleEn: c.titleEn,
          titleAr: c.titleAr,
          primaryBranchId: branchId(c.branch),
          sortOrder: i,
        })),
      )
      .returning({ id: coaches.id, slug: coaches.slug });
    const coachId = (slug: string) => coachRows.find((r) => r.slug === slug)!.id;

    const validFrom = "2026-01-01";
    const templates: (typeof scheduleTemplates.$inferInsert)[] = [];
    for (const b of BRANCHES) {
      const staff = STAFF[b.slug];
      for (let weekday = 0; weekday < 7; weekday++) {
        slotsFor(b.slug, weekday).forEach(([time, slug], i) => {
          const c = typeSeed(slug);
          const coach = c.audience === "kids" ? staff.kids : i % 2 === 0 ? staff.a : staff.b;
          templates.push({
            branchId: branchId(b.slug),
            classTypeId: typeId(slug),
            coachId: coachId(coach),
            weekday,
            startTime: time,
            durationMinutes: c.duration,
            capacity: c.cap,
            validFrom,
          });
        });
      }
    }
    await t.insert(scheduleTemplates).values(templates);

    for (const [i, raw] of PRODUCTS.entries()) {
      const p = raw as ProductSeed;
      const [row] = await t
        .insert(products)
        .values({
          slug: p.slug,
          type: p.type,
          audience: p.audience,
          nameEn: p.nameEn,
          nameAr: p.nameAr,
          descriptionEn: p.descEn,
          descriptionAr: p.descAr,
          credits: p.credits,
          validityDays: p.days,
          isIntroOffer: p.intro ?? false,
          maxPerCustomer: p.max ?? null,
          isFeatured: p.featured ?? false,
          imageMediaId: RETAIL_MEDIA[p.slug] ? mediaId(RETAIL_MEDIA[p.slug]) : null,
          sku: p.type === "retail" ? `BF-${p.slug.toUpperCase()}` : null,
          trackStock: p.type === "retail",
          sortOrder: i,
        })
        .returning({ id: products.id });
      const stock = STOCK[p.slug];
      if (stock) {
        await t.insert(branchStock).values(
          Object.entries(stock).map(([slug, quantity]) => ({ productId: row.id, branchId: branchId(slug), quantity })),
        );
        await t.insert(stockMovements).values(
          Object.entries(stock).map(([slug, quantity]) => ({
            productId: row.id,
            branchId: branchId(slug),
            delta: quantity,
            quantityAfter: quantity,
            reason: "restock" as const,
            note: "Opening stock",
          })),
        );
      }
      await t.insert(productPrices).values([
        { productId: row.id, branchId: null, amount: qar(p.price), compareAt: p.compareAt ? qar(p.compareAt) : null },
        ...Object.entries(p.branch ?? {}).map(([slug, price]) => ({
          productId: row.id,
          branchId: branchId(slug),
          amount: qar(price),
          compareAt: null,
        })),
      ]);
      if (p.types.length) {
        await t.insert(productClassTypes).values(p.types.map((slug) => ({ productId: row.id, classTypeId: typeId(slug) })));
      }
    }

    await t.insert(banners).values({
      placement: "home_promo",
      eyebrowEn: "First flight",
      eyebrowAr: "الرحلة الأولى",
      titleEn: "Never been on a cord? Good.",
      titleAr: "لم تجرّب الحبل من قبل؟ ممتاز.",
      ctaHref: "/timetable",
      mediaId: mediaId("kit-mat"),
    });

    await t.insert(banners).values({
      placement: "home_hero",
      eyebrowEn: "Bungee Fly · Doha",
      eyebrowAr: "بانجي فلاي · الدوحة",
      titleEn: "Defy gravity.",
      titleAr: "تحدَّ الجاذبية.",
      bodyEn: "Forty-five minutes on the cord. Low-impact, full-body, and the closest thing to flying you will do this week.",
      bodyAr: "خمس وأربعون دقيقة على الحبل. تمرين كامل للجسم، لطيف على المفاصل، وأقرب ما ستعيشه هذا الأسبوع إلى الطيران.",
      ctaLabelEn: "Book a class",
      ctaLabelAr: "احجز حصة",
      ctaHref: "/timetable",
      mediaId: mediaId("hero-lift"),
    });

    await t.insert(settings).values([
      { key: "booking.cancellationWindowHours", value: 12 },
      { key: "booking.horizonDays", value: 14 },
      { key: "booking.waitlistAutoPromote", value: true },
      { key: "booking.lateCancelForfeitsCredit", value: true },
      { key: "booking.maxActiveBookings", value: 10 },
      { key: "commerce.currency", value: "QAR" },
    ]);
  });

  const result = await materializeSessions(db, { days: 21 });
  // DEMO ONLY: plausible occupancy so the timetable reads like a real week. Real counts come from bookings.
  await db.execute(sql`update class_sessions set booked_count = least(capacity, abs(hashtext(id::text)) % (capacity + 3))`);
  console.log(`[seed] Done — ${BRANCHES.length} branches, ${result.templates} templates, ${result.inserted} sessions`);
}
