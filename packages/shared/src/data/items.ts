// Item & resource registry. Resources are shared counts in storage (world.res);
// physical items live in hands or on the floor and become resources when stored.

export type ItemCat = "food" | "water" | "mat" | "tool" | "weapon" | "med" | "misc" | "seed" | "dish" | "lore" | "fun" | "junk";

export interface ItemDef {
  name: string;
  icon: string; // emoji/glyph for UI
  cat: ItemCat;
  large?: boolean; // occupies both hands
  nut?: number; // nutrition units (1 = daily ration)
  sanity?: number; // on eating
  value: number; // barter value
  weight: number; // kg for expedition load
  store?: boolean; // becomes a resource when stored (default true)
  spoil?: number; // days to spoil (for food), 0 = never
  crop?: string; // seed for crop id
}

const I = (name: string, icon: string, cat: ItemCat, value: number, weight: number, extra: Partial<ItemDef> = {}): ItemDef => ({
  name,
  icon,
  cat,
  value,
  weight,
  ...extra,
});

export const ITEMS: Record<string, ItemDef> = {
  // --- food
  food_can: I("Консервы «Вечность»", "🥫", "food", 4, 0.5, { nut: 1, sanity: -2 }),
  potato: I("Картофель", "🥔", "food", 2, 0.3, { nut: 0.5, spoil: 14 }),
  tomato: I("Томат", "🍅", "food", 2, 0.2, { nut: 0.35, spoil: 5 }),
  lettuce: I("Салат", "🥬", "food", 1, 0.1, { nut: 0.35, spoil: 3 }),
  soy: I("Соя", "🫘", "food", 2, 0.2, { nut: 0.55, spoil: 20 }),
  carrot: I("Морковь", "🥕", "food", 2, 0.2, { nut: 0.45, spoil: 10 }),
  peas: I("Горох", "🟢", "food", 2, 0.2, { nut: 0.4, spoil: 20 }),
  herbs: I("Травы для чая", "🌿", "food", 2, 0.05, { nut: 0.05, spoil: 20 }),
  tobacco: I("Табак", "🍂", "misc", 3, 0.05, {}),
  hops: I("Хмель", "🌾", "food", 2, 0.05, { nut: 0.05 }),
  strawberry: I("Клубника", "🍓", "food", 6, 0.1, { nut: 0.3, sanity: 8, spoil: 3 }),
  sunflower: I("Семечки подсолнуха", "🌻", "food", 2, 0.1, { nut: 0.3, spoil: 30 }),
  mushroom: I("Грибы", "🍄", "food", 2, 0.1, { nut: 0.3, spoil: 4 }),
  meat: I("Крольчатина", "🍖", "food", 5, 0.5, { nut: 1, spoil: 3 }),
  rat: I("Крысятина", "🐀", "food", 1, 0.3, { nut: 0.4, sanity: -3, spoil: 2 }),
  // --- water
  water: I("Чистая вода", "💧", "water", 3, 1),
  water_dirty: I("Грязная вода", "🟤", "water", 1, 1),
  // --- materials
  parts: I("Запчасти", "⚙️", "mat", 3, 0.5),
  scrap: I("Металлолом", "🔩", "mat", 1, 1),
  cloth: I("Ткань", "🧵", "mat", 2, 0.3),
  chem: I("Химикаты", "🧪", "mat", 3, 0.5),
  meds: I("Медикаменты", "💊", "med", 6, 0.2),
  ammo: I("Патроны", "🔸", "mat", 2, 0.05),
  fuel: I("Топливо", "⛽", "mat", 4, 1),
  wood: I("Дерево", "🪵", "mat", 1, 1),
  compost: I("Компост", "🟫", "mat", 1, 1),
  batteries: I("Батарейки", "🔋", "mat", 3, 0.1),
  // --- hauled
  dirt: I("Грунт", "⛰️", "junk", 0, 5, { large: true, store: false }),
  trash: I("Мешок мусора", "🗑️", "junk", 0, 2, { large: true, store: false }),
  laundry: I("Грязное бельё", "👕", "junk", 0, 1, { large: true, store: false }),
  crate: I("Ящик с припасами", "📦", "misc", 8, 8, { large: true, store: false }),
  // --- tools (shared, counted in storage)
  pickaxe: I("Кирка", "⛏️", "tool", 8, 3),
  drill: I("Бур", "🛠️", "tool", 20, 6),
  shovel: I("Лопата", "🪏", "tool", 4, 2),
  flashlight: I("Фонарик", "🔦", "tool", 5, 0.3),
  lockpick: I("Отмычки", "🗝️", "tool", 4, 0.1),
  crowbar: I("Лом", "🦯", "tool", 5, 2),
  extinguisher: I("Огнетушитель", "🧯", "tool", 6, 3),
  medkit: I("Аптечка", "🩹", "med", 8, 0.5),
  geiger: I("Счётчик Гейгера", "📟", "tool", 10, 0.5),
  relay: I("Ретранслятор", "📡", "tool", 12, 2),
  nvg: I("ПНВ", "🥽", "tool", 25, 0.8),
  gasmask: I("Противогаз", "😷", "tool", 8, 0.8),
  radpills: I("Антирад", "💉", "med", 7, 0.1),
  // --- weapons
  pipe: I("Труба", "🔧", "weapon", 3, 2),
  knife: I("Нож", "🔪", "weapon", 4, 0.4),
  pistol: I("Пистолет", "🔫", "weapon", 15, 1),
  shotgun: I("Обрез", "💥", "weapon", 20, 2.5),
  rifle: I("Винтовка", "🎯", "weapon", 25, 4),
  molotov: I("Коктейль Молотова", "🍾", "weapon", 4, 0.7),
  armor: I("Бронежилет", "🦺", "weapon", 20, 5),
  // --- drinks & comfort
  moonshine: I("Самогон", "🍶", "fun", 5, 0.5, { sanity: 12 }),
  beer: I("Пиво", "🍺", "fun", 4, 0.5, { sanity: 8 }),
  tea: I("Травяной чай", "🍵", "fun", 2, 0.2, { sanity: 6 }),
  cigarettes: I("Самокрутки", "🚬", "fun", 3, 0.05, { sanity: 5 }),
  // --- seeds
  seed_lettuce: I("Семена салата", "🌱", "seed", 2, 0.01, { crop: "lettuce" }),
  seed_potato: I("Семенной картофель", "🌱", "seed", 2, 0.1, { crop: "potato" }),
  seed_tomato: I("Семена томатов", "🌱", "seed", 3, 0.01, { crop: "tomato" }),
  seed_soy: I("Семена сои", "🌱", "seed", 3, 0.01, { crop: "soy" }),
  seed_carrot: I("Семена моркови", "🌱", "seed", 2, 0.01, { crop: "carrot" }),
  seed_peas: I("Семена гороха", "🌱", "seed", 2, 0.01, { crop: "peas" }),
  seed_herbs: I("Семена трав", "🌱", "seed", 3, 0.01, { crop: "herbs" }),
  seed_tobacco: I("Семена табака", "🌱", "seed", 3, 0.01, { crop: "tobacco" }),
  seed_hops: I("Семена хмеля", "🌱", "seed", 3, 0.01, { crop: "hops" }),
  seed_strawberry: I("Семена клубники", "🌱", "seed", 12, 0.01, { crop: "strawberry" }),
  seed_sunflower: I("Семена подсолнуха", "🌱", "seed", 2, 0.01, { crop: "sunflower" }),
  spores: I("Грибница", "🦠", "seed", 2, 0.05, { crop: "mushroom" }),
  // --- lore & fun (personal / collection)
  newspaper: I("Старая газета", "📰", "lore", 1, 0.1, { store: false }),
  tape: I("Кассета", "📼", "lore", 3, 0.1, { store: false }),
  book: I("Книга", "📕", "lore", 2, 0.5, { store: false }),
  film: I("Киноплёнка", "🎞️", "lore", 4, 0.5, { store: false }),
  note: I("Записка", "📝", "lore", 0, 0, { store: false }),
  boardgame: I("Настольная игра", "🎲", "fun", 6, 1.5, { store: false }),
  cards52: I("Колода на 52 карты", "🃏", "fun", 4, 0.1, { store: false }),
  radio_part: I("Деталь дальней рации", "📻", "misc", 30, 2, { store: false }),
  // --- prologue junk & keepsakes
  iron: I("Утюг", "🧺", "junk", 1, 2, { store: false }),
  album: I("Семейный альбом", "📔", "misc", 1, 0.5, { store: false }),
  guitar: I("Гитара", "🎸", "fun", 6, 2.5, { large: true, store: false }),
  harmonica: I("Губная гармошка", "🎵", "fun", 3, 0.1),
  radio_portable: I("Транзисторный приёмник", "📻", "misc", 5, 1),
  suitcase: I("Чемодан", "🧳", "misc", 5, 6, { large: true, store: false }),
  water_jug: I("Бутыль воды (5 л)", "🫙", "water", 8, 5, { large: true, store: false }),
  food_box: I("Коробка консервов", "📦", "food", 10, 6, { large: true, store: false }),
  toolbox: I("Ящик инструментов", "🧰", "tool", 10, 5, { large: true, store: false }),
  first_aid: I("Домашняя аптечка", "🩹", "med", 6, 1),
  ball: I("Мячик", "⚽", "fun", 1, 0.3, { store: false }),
  gnome: I("Садовый гном", "🧙", "junk", 0, 2, { store: false }),
  plant_pot: I("Фикус в горшке", "🪴", "misc", 2, 2, { large: true, store: false }),
  teddy: I("Плюшевый медведь", "🧸", "misc", 1, 0.3, { store: false }),
};

/** What an item turns into when put into storage. Crate-like containers unpack into several resources. */
export const UNPACK: Record<string, Record<string, number>> = {
  water_jug: { water: 5 },
  food_box: { food_can: 5 },
  toolbox: { parts: 4, pickaxe: 1, shovel: 1 },
  first_aid: { meds: 2 },
  crate: { food_can: 2, parts: 2, cloth: 2 },
  suitcase: { cloth: 4 },
};

export function itemName(id: string) {
  return ITEMS[id]?.name ?? DISH_NAMES[id] ?? id;
}

// Dishes are registered from recipes (see recipes.ts); names cached here for itemName.
export const DISH_NAMES: Record<string, string> = {};

export const RES_KEYS_FOOD = Object.keys(ITEMS).filter((k) => ITEMS[k].cat === "food");
