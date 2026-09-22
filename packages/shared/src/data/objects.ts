// Static definitions of placeable objects (stations, furniture, props).

export type PowerGroup = "light" | "air" | "water" | "hydro" | "kitchen" | "radio" | "defense" | "comfort" | "work";

export interface ObjDef {
  name: string;
  power?: number; // kW when running
  group?: PowerGroup;
  wear?: number; // wear per game hour while running
  seat?: boolean; // character sits here
  social?: boolean;
  noise?: number; // adds to Заметность per hour while running
  h?: number; // visual height in cells
  gen?: number; // kW generated (while running)
}

export const OBJECTS: Record<string, ObjDef> = {
  door_blast: { name: "Гермодверь", h: 1.8 },
  hatch_ladder: { name: "Люк наверх" },
  ladder: { name: "Лестница" },
  sortie_terminal: { name: "Терминал «Вылазка»" },
  geiger: { name: "Счётчик Гейгера" },
  dirt_chute: { name: "Сброс грунта" },
  bed: { name: "Койка", seat: true },
  shelf: { name: "Стеллаж" },
  bike_gen: { name: "Генератор-велосипед", seat: true, gen: 0.5, wear: 1.2, noise: 0.5 },
  diesel_gen: { name: "Дизель-генератор", gen: 1.6, wear: 2, noise: 4 },
  thermal_gen: { name: "Термоэлемент", gen: 1.2, wear: 0.3 },
  solar_panel: { name: "Солнечные панели", gen: 0.8 },
  battery: { name: "Аккумулятор" },
  air_filter: { name: "Фильтр воздуха", power: 0.3, group: "air", wear: 1.5 },
  water_filter: { name: "Водоочистка", power: 0.4, group: "water", wear: 1.8 },
  hand_pump: { name: "Водозабор (ручной насос)", wear: 0.6 },
  water_tank: { name: "Бак воды" },
  stream: { name: "Подземный ручей" },
  nutrient_tank: { name: "Бак с раствором" },
  hydro_tray: { name: "Грядка-лоток", power: 0.12, group: "hydro", wear: 0.4 },
  mushroom_bed: { name: "Грибная грядка" },
  compost: { name: "Компостер" },
  rabbit_hutch: { name: "Клетка с кроликами" },
  notice_board: { name: "Доска дел" },
  dining_table: { name: "Обеденный стол", seat: true, social: true },
  game_table: { name: "Игровой стол", seat: true, social: true },
  game_shelf: { name: "Полка с настолками" },
  radio: { name: "Радиоприёмник", power: 0.05, group: "radio", seat: true, social: true },
  stove: { name: "Плита", power: 0.4, group: "kitchen", wear: 0.8 },
  sink: { name: "Мойка" },
  kettle: { name: "Чайник", power: 0.1, group: "kitchen" },
  trash_bin: { name: "Мусорное ведро" },
  med_bed: { name: "Медицинская койка", seat: true },
  med_cabinet: { name: "Аптечный шкаф" },
  workbench: { name: "Верстак" },
  tool_rack: { name: "Стойка с инструментами" },
  chem_bench: { name: "Химический стол", power: 0.1, group: "work" },
  still: { name: "Самогонный аппарат" },
  radio_station: { name: "Рация", power: 0.15, group: "radio" },
  research_desk: { name: "Стол исследований" },
  weapon_rack: { name: "Оружейная стойка" },
  ammo_bench: { name: "Станок для патронов" },
  target: { name: "Мишень" },
  pullup_bar: { name: "Турник" },
  darts: { name: "Дартс" },
  armchair: { name: "Кресло", seat: true },
  bookshelf: { name: "Книжный шкаф" },
  piano: { name: "Старое пианино", seat: true, social: true },
  drawing_wall: { name: "Стена для рисунков" },
  tape_player: { name: "Кассетный магнитофон" },
  altar: { name: "Свечи и памятная полка", seat: true },
  cell_bars: { name: "Решётка" },
  pillar: { name: "Опора" },
  sandbags: { name: "Мешки с песком" },
  loophole: { name: "Бойница" },
  turret: { name: "Турель", power: 0.2, group: "defense" },
  periscope: { name: "Перископ" },
  shower: { name: "Горячий душ", power: 0.8, group: "comfort" },
  projector: { name: "Кинопроектор", power: 0.2, group: "comfort" },
  grave: { name: "Памятник", seat: false },
  pet_bed: { name: "Лежанка питомца" },
  washtub: { name: "Корыто для стирки" },
  rat_trap: { name: "Крысоловка" },
  lamp: { name: "Лампа" },
  rug: { name: "Ковёр" },
  poster: { name: "Плакат" },
  plant: { name: "Растение в горшке" },
  keepsake: { name: "Полка с личными вещами" },
  cache: { name: "Тайник прошлых жильцов" },
  ai_capsule: { name: "Капсула бункерного ИИ" },
  bones: { name: "Кости и записка" },
  nest: { name: "Гнездо кротовиков" },
  metro: { name: "Туннель метро" },
};

export function objName(kind: string) {
  return OBJECTS[kind]?.name ?? kind;
}
