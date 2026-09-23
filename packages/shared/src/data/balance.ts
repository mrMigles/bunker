// All tunable numbers live here so balance can be adjusted without touching logic.

export const BAL = {
  tickHz: 20,
  // --- time
  dayStartHour: 6,
  dayEndHour: 22,
  defaultDayLength: 360, // real seconds of daytime (06→22)
  defaultNightLength: 120,
  skipTimeMult: 3,
  combatTimeMult: 0.25,

  // --- movement (cells per second)
  // human pace for 1-cell-wide people in 4–8 cell rooms (was 3.2 / 5.2 / 2.6 — read as scurrying)
  walkSpeed: 2.2,
  runSpeed: 3.6,
  climbSpeed: 2.0,
  carryLargeMult: 0.75,
  drunkWobble: 0.6,

  // --- needs per game day (24h). Positive = decay.
  needDecay: {
    food: 40,
    water: 60,
    energy: 55, // restored by sleep
    sanity: 12, // baseline drift down (comfort offsets it)
  },
  rationFood: 1, // food units per person per day
  rationWater: 2, // water units per person per day
  foodPerUnit: 40, // need restored per nutrition unit
  waterPerUnit: 30,
  starveDmgPerDay: 45, // health loss per day at food 0
  thirstDmgPerDay: 70,
  exhaustDmgPerDay: 10,
  co2DmgPerDay: 60,
  radDmgThreshold: 60, // above → health damage
  radDmgPerDay: 20,
  healthRegenPerDay: 8, // when fed & watered
  hallucinationSanity: 30,
  breakdownSeconds: 60,
  downSeconds: 90,
  sleepRestoreBed: 80,
  sleepRestoreFloor: 40,
  snoreSanity: -6,
  snoreEnergy: -12,

  // --- resources
  startRes: { food_can: 12, water: 18, water_dirty: 0, parts: 10, scrap: 15, cloth: 4, chem: 3, meds: 2, ammo: 6, fuel: 0, wood: 8 },
  baseStorage: 80,
  storagePerShelf: 60,

  // --- power (kW; battery kWh)
  bikeKw: 0.8, // §14 says 0.5; raised so one rider can keep the starting bunker alive (DECISIONS.md)
  dieselKw: 1.6,
  dieselFuelPerHour: 0.25,
  thermalKw: 1.2,
  solarKw: 0.8,
  batteryCap: 6,
  batteryCapPerBank: 8,
  // NB: consumer draw is half of the §14 reference values (see DECISIONS.md): with the reference
  // numbers the starting bunker needed ~4 people pedalling non-stop.
  lightKwPerRoom: 0.05,
  airFilterKw: 0.15,
  waterFilterKw: 0.2,
  hydroKw: 0.15, // per hydroponics room (split between trays)
  stoveKw: 0.4,
  radioKw: 0.15,
  turretKw: 0.2,
  showerKw: 0.8,
  airFilterGraceSeconds: 120, // real seconds before CO2 starts rising (§4.4)
  co2RisePerHour: 8,
  co2FallPerHour: 30,

  // --- water
  pumpDirtyPerAction: 2, // hand pump
  waterFilterPerHour: 1.2, // dirty→clean when powered

  // --- wear (per game hour while running)
  wearPerHour: { bike_gen: 1.2, air_filter: 1.5, water_filter: 1.8, diesel_gen: 2, stove: 0.8, hydro_tray: 0.4, radio: 0.3 } as Record<string, number>,
  fireChanceOnBreak: 0.12,
  fireSpreadPerHour: 0.25,

  // --- digging (cells per minute at skill 1)
  // cells per minute of one digger; doubled so a room visibly moves within a few minutes of play
  digRate: { 1: 6, 2: 4, 3: 1.4, 4: 0.6, 5: 2.4, 6: 1.8 } as Record<number, number>,
  digSkillBonus: 0.15, // per skill level
  collapseSpan: 6, // max unsupported width of a room without supports
  collapseChancePerDay: 0.35,

  // --- hydroponics
  hydroFoodPerDay: 3,
  hydroWaterPerDay: 1,

  // --- raids
  firstRaidDay: 5,
  noticeDecayPerDay: 6,
  noticeRaidThreshold: 45,

  // --- skills
  xpPerAction: 2,
  skillLevel: (xp: number) => Math.min(10, 1 + Math.floor(Math.sqrt(xp / 12))),

  // --- storyteller multipliers
  storyteller: {
    haven: { needMult: 0.7, raidMult: 0.4, raidStrength: 0.6, breakMult: 0.6 },
    classic: { needMult: 1, raidMult: 1, raidStrength: 1, breakMult: 1 },
    scorched: { needMult: 1.25, raidMult: 1.6, raidStrength: 1.4, breakMult: 1.4 },
  },

  // --- weapons (§14)
  weapons: {
    fists: { name: "Кулаки", dmg: [1, 3], ap: 1, range: 1, ammo: 0 },
    pipe: { name: "Труба", dmg: [3, 5], ap: 1, range: 1, ammo: 0 },
    knife: { name: "Нож", dmg: [2, 4], ap: 1, range: 1, ammo: 0, bleed: true },
    pistol: { name: "Пистолет", dmg: [4, 7], ap: 1, range: 6, ammo: 8 },
    shotgun: { name: "Обрез", dmg: [6, 12], ap: 2, range: 3, ammo: 2, falloff: true },
    rifle: { name: "Винтовка", dmg: [7, 10], ap: 2, range: 10, ammo: 5 },
    molotov: { name: "Молотов", dmg: [3, 3], ap: 2, range: 5, ammo: 0, fire: 2, consumable: true },
  } as Record<string, WeaponDef>,
};

export interface WeaponDef {
  name: string;
  dmg: [number, number];
  ap: number;
  range: number;
  ammo: number;
  bleed?: boolean;
  falloff?: boolean;
  fire?: number;
  consumable?: boolean;
}

export type Balance = typeof BAL;
