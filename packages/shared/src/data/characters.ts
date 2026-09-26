import type { SkillId, StatId } from "../types";

export interface ProfDef {
  name: string;
  icon: string;
  skill: SkillId; // starting skill boost
  stat: StatId; // stat bias
  ability: string; // combat ability id
  abilityName: string;
  desc: string;
  likes: string[]; // leisure preferences (object kinds)
  hat: number;
  npcOnly?: boolean;
}

export const PROFS: Record<string, ProfDef> = {
  engineer: { name: "Инженер", icon: "🔧", skill: "repair", stat: "int", ability: "turret", abilityName: "Поставить растяжку", desc: "Чинит быстрее всех, строит турели.", likes: ["bookshelf", "workbench"], hat: 1 },
  doctor: { name: "Врач", icon: "⚕️", skill: "medicine", stat: "int", ability: "surgery", abilityName: "Полевая хирургия", desc: "Лечит раны, болезни, радиацию.", likes: ["bookshelf", "piano"], hat: 2 },
  soldier: { name: "Военный", icon: "🎖️", skill: "shooting", stat: "sil", ability: "suppress", abilityName: "Подавление", desc: "Стреляет метко, держит строй.", likes: ["target", "pullup_bar"], hat: 3 },
  cook: { name: "Повар", icon: "🍳", skill: "cooking", stat: "vyn", ability: "kitchen_knife", abilityName: "Кухонный нож", desc: "Готовит сытнее и вкуснее.", likes: ["radio", "dining_table"], hat: 4 },
  chemist: { name: "Химик", icon: "⚗️", skill: "medicine", stat: "int", ability: "molotov", abilityName: "Коктейль Молотова", desc: "Химикаты, раствор, самогон.", likes: ["bookshelf", "still"], hat: 5 },
  electrician: { name: "Электрик", icon: "⚡", skill: "repair", stat: "lov", ability: "blackout", abilityName: "Отключить свет", desc: "Проводка, генераторы, турели.", likes: ["radio", "tape_player"], hat: 6 },
  teacher: { name: "Учитель", icon: "📚", skill: "radio", stat: "har", ability: "inspire_lesson", abilityName: "Урок спокойствия", desc: "Читает, учит других, мирит.", likes: ["bookshelf", "game_table"], hat: 7 },
  miner: { name: "Шахтёр", icon: "⛏️", skill: "digging", stat: "sil", ability: "breach", abilityName: "Пробить стену", desc: "Копает в два раза быстрее.", likes: ["game_table", "darts"], hat: 8 },
  radioman: { name: "Радиолюбитель", icon: "📻", skill: "radio", stat: "int", ability: "call_support", abilityName: "Вызвать поддержку", desc: "Ловит станции, ведёт отряд по радио.", likes: ["radio", "tape_player"], hat: 9 },
  farmer: { name: "Фермер", icon: "🌾", skill: "cooking", stat: "vyn", ability: "pitchfork", abilityName: "Вилы наперевес", desc: "Растения растут лучше под его рукой.", likes: ["armchair", "radio"], hat: 10 },
  priest: { name: "Священник", icon: "🕯️", skill: "medicine", stat: "har", ability: "inspire", abilityName: "Вдохновение", desc: "Поддерживает рассудок группы.", likes: ["altar", "radio"], hat: 11 },
  conman: { name: "Мошенник", icon: "🃏", skill: "stealth", stat: "har", ability: "negotiate", abilityName: "Переговоры", desc: "Торгуется, врёт, жульничает в карты.", likes: ["game_table", "darts"], hat: 12 },
  child: { name: "Ребёнок", icon: "🧒", skill: "stealth", stat: "lov", ability: "hide", abilityName: "Спрятаться", desc: "Маленький и шустрый. Всем поднимает настроение.", likes: ["pet_bed", "drawing_wall", "radio"], hat: 0, npcOnly: true },
};

export interface TraitDef {
  name: string;
  desc: string;
}

export const TRAITS_PLUS: Record<string, TraitDef> = {
  tough: { name: "Выносливый", desc: "Здоровье и бодрость падают на 20% медленнее." },
  nightowl: { name: "Ночная сова", desc: "Бодр вечером, меньше спит." },
  goldhands: { name: "Золотые руки", desc: "Ремонт и крафт на 30% быстрее." },
  optimist: { name: "Оптимист", desc: "Рассудок падает вдвое медленнее." },
  greenthumb: { name: "Зелёные пальцы", desc: "Растения под уходом растут быстрее." },
  lightsleeper: { name: "Чуткий сон", desc: "Не страдает от храпа, первым слышит угрозы." },
  strongback: { name: "Крепкая спина", desc: "Носит грунт без замедления, копает быстрее." },
  eagleeye: { name: "Орлиный глаз", desc: "+10% к точности, замечает тайники." },
  storyteller: { name: "Рассказчик", desc: "Совместный отдых с ним даёт больше рассудка." },
  frugal: { name: "Неприхотливый", desc: "Ест на 20% меньше." },
};

export const TRAITS_MINUS: Record<string, TraitDef> = {
  claustro: { name: "Клаустрофоб", desc: "Рассудок падает быстрее в тесных комнатах и на глубине." },
  snorer: { name: "Храпит", desc: "Портит сон соседям по комнате." },
  glutton: { name: "Обжора", desc: "Ест на 30% больше, может тайком таскать еду." },
  coward: { name: "Трус", desc: "В бою может запаниковать и сбежать." },
  smoker: { name: "Курильщик", desc: "Без курева теряет рассудок." },
  gambler: { name: "Азартный", desc: "Серия проигрышей за столом бьёт по рассудку." },
  clumsy: { name: "Растяпа", desc: "Чаще ломает вещи при работе." },
  grump: { name: "Ворчун", desc: "Отношения портятся быстрее." },
  sleepy: { name: "Соня", desc: "Бодрость падает быстрее." },
  darkfear: { name: "Боится темноты", desc: "В тёмных комнатах сильно теряет рассудок." },
};

export interface GoalDef {
  name: string;
  desc: string;
  hostile?: boolean;
}

export const GOALS: Record<string, GoalDef> = {
  album: { name: "Семейный альбом", desc: "Сохрани семейный альбом до конца партии (он должен быть на полке в бункере)." },
  stranger: { name: "Гостеприимство", desc: "Убеди группу принять в бункер незнакомца." },
  armory: { name: "Трофей", desc: "Будь в вылазке, когда найдут оружейный склад (блокпост)." },
  stash5: { name: "Чёрный день", desc: "Накопи личный тайник из 5 консерв." },
  digger: { name: "Вглубь", desc: "Лично выкопай 40 клеток породы." },
  cook10: { name: "Шеф", desc: "Приготовь 10 блюд." },
  gardener: { name: "Садовод", desc: "Собери 3 урожая клубники." },
  cards: { name: "Картёжник", desc: "Выиграй 5 партий в Дурака." },
  radio: { name: "Позывной", desc: "Найди номерную станцию и расшифруй три послания." },
  reader: { name: "Архивариус", desc: "Прочитай 12 газетных вырезок." },
  medic: { name: "Клятва", desc: "Спаси товарища без сознания." },
  survivor: { name: "Последний герой", desc: "Доживи до финала со здоровьем выше 50." },
  saboteur: { name: "Засланец", desc: "Тайно сломай генератор или фильтр 3 раза, не попавшись (голосование за тебя на совете = провал).", hostile: true },
};

export const NAMES_M = ["Василий", "Пётр", "Геннадий", "Аркадий", "Степан", "Лев", "Борис", "Фёдор", "Тимофей", "Игнат", "Савелий", "Роман", "Яков", "Остап", "Кузьма", "Лука", "Макар", "Никон", "Демьян", "Захар"];
export const NAMES_F = ["Елена", "Зоя", "Тамара", "Валентина", "Нина", "Ада", "Римма", "Галина", "Вера", "Лидия", "Софья", "Марфа", "Ульяна", "Прасковья", "Инна", "Дарья", "Агния", "Кира", "Майя", "Злата"];
export const SURNAMES = ["Жестянкин", "Подвальный", "Лампочкин", "Сухарев", "Кротов", "Гвоздев", "Тушёнкин", "Фильтров", "Буров", "Затворов", "Люков", "Консервин", "Сиренин", "Радиолов", "Пескарёв", "Щелкунов"];

export const PHOBIAS = ["Пауки", "Высота", "Тишина", "Темнота", "Замкнутые пространства", "Толпа", "Кровь", "Радио-помехи", "Консервные ножи", "Клоуны"];
export const BAGGAGE = ["Утюг", "Губная гармошка", "Семейный альбом", "Колода карт", "Плюшевый медведь", "Книга стихов", "Фляга", "Садовый гном", "Коробок спичек", "Кассета без подписи"];

export const COLORS = [0xc8553d, 0x5a7d4a, 0x3d6b8c, 0xc9a227, 0x8e5572, 0x4f8a8b, 0xa3623a, 0x6b6f7a, 0x9c3848, 0x7b8f3a];

export const SKILL_NAMES: Record<SkillId, string> = {
  repair: "Ремонт",
  medicine: "Медицина",
  cooking: "Кулинария",
  shooting: "Стрельба",
  melee: "Ближний бой",
  digging: "Копание",
  radio: "Радио",
  stealth: "Скрытность",
};

export const STAT_NAMES: Record<StatId, string> = { sil: "СИЛ", lov: "ЛОВ", int: "ИНТ", vyn: "ВЫН", har: "ХАР" };
/** What each bar means and what moves it — tooltips and the dossier. */
export const NEED_HINTS: Record<string, string> = {
  food: "Сытость: падает со временем. Еда со склада, пайки на совете, готовка у плиты.",
  water: "Вода: падает быстрее еды. Пить из бака; грязную воду чистит фильтр.",
  energy: "Бодрость: тратится на работу. Сон в кровати, кофе, кресло.",
  sanity:
    "Рассудок — душевное состояние. Понемногу падает сам, быстрее — в темноте, тесноте, при голоде, ранах и плохих новостях. Поднимают разговоры, радио и музыка, настолки, книги, уютные светлые комнаты и сон. На нуле — нервный срыв: жилец на полминуты выходит из себя и может сломать технику, потом приходит в себя.",
  health: "Здоровье: страдает от голода, жажды, ран, болезней и радиации. Лечат медпункт, аптечки и отдых сытым.",
  rad: "Радиация: копится на вылазках и под радиоактивным дождём. Выводят антирад и время.",
};

export const NEED_NAMES = { food: "Сытость", water: "Вода", energy: "Бодрость", sanity: "Рассудок", health: "Здоровье", rad: "Радиация" };
