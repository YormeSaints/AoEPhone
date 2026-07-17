'use strict';
// ============================================================
// Game data: ages, units, buildings, technologies.
// Stats are closely modeled on classic RTS balance (AoE2-style),
// with training/research times shortened ~40% for mobile sessions.
// ============================================================
const AGE_NAMES = ['Dark Age', 'Feudal Age', 'Castle Age', 'Imperial Age'];
const AGE_ICONS = ['I', 'II', 'III', 'IV'];
const AGE_COST = [null, { food: 500 }, { food: 800, gold: 200 }, { food: 1000, gold: 800 }];
const AGE_TIME = [0, 50, 70, 90];          // research seconds
const AGE_REQ_BLDGS = [0, 2, 2, 2];        // buildings from current age required
const POP_MAX = 120;

// Unit classes: vill, inf, arch, cav, siege
const UNITS = {
  villager:  { name:'Villager',      cls:'vill',  cost:{food:50},           hp:25,  atk:3,  range:0.6, rof:2,   speed:0.85, los:5, armor:0, parmor:0, pop:1, time:13, age:0, from:'towncenter', icon:'👷', bonus:{} },
  militia:   { name:'Militia',       cls:'inf',   cost:{food:60,gold:20},   hp:40,  atk:4,  range:0.6, rof:2,   speed:0.95, los:5, armor:0, parmor:1, pop:1, time:12, age:0, from:'barracks',   icon:'⚔️', bonus:{} },
  spearman:  { name:'Spearman',      cls:'inf',   cost:{food:35,wood:25},   hp:45,  atk:3,  range:0.6, rof:3,   speed:1.0,  los:5, armor:0, parmor:0, pop:1, time:12, age:1, from:'barracks',   icon:'🔱', bonus:{cav:12} },
  archer:    { name:'Archer',        cls:'arch',  cost:{wood:25,gold:45},   hp:30,  atk:4,  range:4,   rof:2,   speed:0.96, los:6, armor:0, parmor:0, pop:1, time:15, age:1, from:'archeryrange', icon:'🏹', bonus:{} },
  skirmisher:{ name:'Skirmisher',    cls:'arch',  cost:{food:25,wood:35},   hp:30,  atk:2,  range:4,   rof:3,   speed:0.96, los:6, armor:0, parmor:3, pop:1, time:13, age:1, from:'archeryrange', icon:'🎯', bonus:{arch:3} },
  scout:     { name:'Scout Cavalry', cls:'cav',   cost:{food:80},           hp:45,  atk:3,  range:0.6, rof:2,   speed:1.35, los:8, armor:0, parmor:2, pop:1, time:16, age:0, from:'stable',     icon:'🐎', bonus:{} },
  knight:    { name:'Knight',        cls:'cav',   cost:{food:60,gold:75},   hp:100, atk:10, range:0.6, rof:1.8, speed:1.35, los:5, armor:2, parmor:2, pop:1, time:18, age:2, from:'stable',     icon:'🛡️', bonus:{} },
  guard:     { name:'Castle Guard',  cls:'inf',   cost:{food:55,gold:45},   hp:70,  atk:9,  range:0.6, rof:2,   speed:1.05, los:5, armor:1, parmor:1, pop:1, time:14, age:2, from:'castle',     icon:'🗡️', bonus:{bldg:3} },
  ram:       { name:'Battering Ram', cls:'siege', cost:{wood:160,gold:75},  hp:200, atk:3,  range:0.7, rof:5,   speed:0.55, los:3, armor:0, parmor:15,pop:2, time:22, age:2, from:'siegeworkshop', icon:'🐏', bonus:{bldg:60} },
  mangonel:  { name:'Mangonel',      cls:'siege', cost:{wood:160,gold:135}, hp:50,  atk:28, range:6,   rof:6,   speed:0.6,  los:8, armor:0, parmor:6, pop:2, time:24, age:2, from:'siegeworkshop', icon:'💥', bonus:{bldg:12}, splash:1.1 },
  monk:      { name:'Monk',          cls:'monk',  cost:{gold:100},          hp:30,  atk:0,  range:4,   rof:1,   speed:0.7,  los:9, armor:0, parmor:0, pop:1, time:20, age:2, from:'monastery',  icon:'🙏', bonus:{}, convert:true },
  fishingship:{name:'Fishing Ship',  cls:'ship',  cost:{wood:75},           hp:60,  atk:0,  range:0.6, rof:2,   speed:1.1,  los:6, armor:0, parmor:4, pop:1, time:16, age:0, from:'dock',       icon:'🎣', bonus:{}, naval:true },
  wargalley: { name:'War Galley',    cls:'ship',  cost:{wood:90,gold:30},   hp:120, atk:7,  range:5,   rof:3,   speed:1.2,  los:8, armor:0, parmor:6, pop:1, time:20, age:1, from:'dock',       icon:'⛵', bonus:{ship:4, bldg:8}, naval:true },
  trebuchet: { name:'Trebuchet',     cls:'siege', cost:{wood:200,gold:200}, hp:80,  atk:45, range:10,  rof:8,   speed:0.4,  los:11,armor:1, parmor:8, pop:2, time:30, age:3, from:'castle',     icon:'🏗️', bonus:{bldg:120}, splash:0.8 },
};

// drop: which resources may be deposited there. size: square footprint in tiles.
const BUILDINGS = {
  towncenter:   { name:'Town Center',    cost:{wood:275,stone:100}, hp:2400, size:3, age:0, los:8, pop:5, drop:['wood','food','gold','stone'], trains:['villager'], atk:6, range:6, rof:2, time:60, icon:'🏛️' },
  house:        { name:'House',          cost:{wood:30},            hp:550,  size:2, age:0, los:2, pop:5, time:15, icon:'🏠' },
  mill:         { name:'Mill',           cost:{wood:100},           hp:600,  size:2, age:0, los:4, drop:['food'], time:20, icon:'🌾' },
  lumbercamp:   { name:'Lumber Camp',    cost:{wood:100},           hp:600,  size:2, age:0, los:4, drop:['wood'], time:20, icon:'🪓' },
  miningcamp:   { name:'Mining Camp',    cost:{wood:100},           hp:600,  size:2, age:0, los:4, drop:['gold','stone'], time:20, icon:'⛏️' },
  farm:         { name:'Farm',           cost:{wood:60},            hp:100,  size:2, age:0, los:1, passable:true, farmFood:350, time:10, icon:'🌱' },
  barracks:     { name:'Barracks',       cost:{wood:175},           hp:1200, size:3, age:0, los:5, trains:['militia','spearman'], time:30, icon:'⚔️' },
  archeryrange: { name:'Archery Range',  cost:{wood:175},           hp:1200, size:3, age:1, los:5, trains:['archer','skirmisher'], time:30, icon:'🏹' },
  stable:       { name:'Stable',         cost:{wood:175},           hp:1200, size:3, age:1, los:5, trains:['scout','knight'], time:30, icon:'🐎' },
  blacksmith:   { name:'Blacksmith',     cost:{wood:150},           hp:1800, size:2, age:1, los:5, time:25, icon:'🔨' },
  tower:        { name:'Watch Tower',    cost:{wood:50,stone:125},  hp:850,  size:1, age:1, los:9, atk:6, range:7, rof:2, time:25, icon:'🗼' },
  siegeworkshop:{ name:'Siege Workshop', cost:{wood:200},           hp:1500, size:3, age:2, los:5, trains:['ram','mangonel'], time:30, icon:'🛠️' },
  castle:       { name:'Castle',         cost:{stone:650},          hp:4200, size:4, age:2, los:10, trains:['guard','trebuchet'], atk:13, range:8, rof:1.6, time:90, icon:'🏰' },
  monastery:    { name:'Monastery',      cost:{wood:175},           hp:1100, size:3, age:2, los:6, trains:['monk'], time:30, icon:'🕍' },
  market:       { name:'Market',         cost:{wood:175},           hp:1200, size:3, age:1, los:5, trade:true, time:25, icon:'⚖️' },
  dock:         { name:'Dock',           cost:{wood:150},           hp:1000, size:2, age:0, los:6, water:true, drop:['food','wood'], trains:['fishingship','wargalley'], time:25, icon:'⚓' },
  palisade:     { name:'Palisade Wall',  cost:{wood:4},             hp:250,  size:1, age:0, los:1, time:5, icon:'🚧' },
  stonewall:    { name:'Stone Wall',     cost:{stone:5},            hp:900,  size:1, age:1, los:1, time:8, icon:'🧱' },
};

// Market exchange: sell 100 of a resource for 70 gold, buy 100 for 140 gold.
const TRADE_SELL = 70, TRADE_BUY = 140;

// Technologies. effect(player, game) mutates player modifiers.
// buff(type,...) helpers are resolved in engine.applyTech.
const TECHS = {
  loom:        { name:'Loom',            cost:{gold:50},            time:15, age:0, from:'towncenter', desc:'Villagers +15 HP, +1/+1 armor',
                 buff:{ units:['villager'], hp:15, armor:1, parmor:1 } },
  wheelbarrow: { name:'Wheelbarrow',     cost:{food:175,wood:50},   time:25, age:1, from:'towncenter', desc:'Villagers move 10% faster, carry +3',
                 vill:{ speed:0.1, carry:3 } },
  handcart:    { name:'Hand Cart',       cost:{food:300,wood:200},  time:30, age:2, from:'towncenter', req:'wheelbarrow', desc:'Villagers move 10% faster, carry +7',
                 vill:{ speed:0.1, carry:7 } },
  doublebitaxe:{ name:'Double-Bit Axe',  cost:{food:100,wood:50},   time:20, age:1, from:'lumbercamp', desc:'Villagers chop wood 20% faster',
                 rate:{ wood:0.2 } },
  bowsaw:      { name:'Bow Saw',         cost:{food:150,wood:100},  time:25, age:2, from:'lumbercamp', req:'doublebitaxe', desc:'Villagers chop wood 20% faster',
                 rate:{ wood:0.2 } },
  horsecollar: { name:'Horse Collar',    cost:{food:75,wood:75},    time:20, age:1, from:'mill', desc:'Farmers work 20% faster',
                 rate:{ farm:0.2 } },
  heavyplow:   { name:'Heavy Plow',      cost:{food:125,wood:125},  time:25, age:2, from:'mill', req:'horsecollar', desc:'Farmers work 20% faster',
                 rate:{ farm:0.2 } },
  goldmining:  { name:'Gold Mining',     cost:{food:100,wood:75},   time:20, age:1, from:'miningcamp', desc:'Villagers mine gold 20% faster',
                 rate:{ gold:0.2 } },
  stonemining: { name:'Stone Mining',    cost:{food:100,wood:75},   time:20, age:1, from:'miningcamp', desc:'Villagers mine stone 20% faster',
                 rate:{ stone:0.2 } },
  forging:     { name:'Forging',         cost:{food:150},           time:20, age:1, from:'blacksmith', desc:'Melee units +1 attack',      mod:{ meleeAtk:1 } },
  ironcasting: { name:'Iron Casting',    cost:{food:220,gold:120},  time:25, age:2, from:'blacksmith', req:'forging', desc:'Melee units +1 attack', mod:{ meleeAtk:1 } },
  blastfurnace:{ name:'Blast Furnace',   cost:{food:275,gold:225},  time:30, age:3, from:'blacksmith', req:'ironcasting', desc:'Melee units +2 attack', mod:{ meleeAtk:2 } },
  fletching:   { name:'Fletching',       cost:{food:100,gold:50},   time:20, age:1, from:'blacksmith', desc:'Ranged units +1 attack, +1 range', mod:{ rangedAtk:1, rangeUp:1 } },
  bodkinarrow: { name:'Bodkin Arrow',    cost:{food:200,gold:100},  time:25, age:2, from:'blacksmith', req:'fletching', desc:'Ranged units +1 attack, +1 range', mod:{ rangedAtk:1, rangeUp:1 } },
  bracer:      { name:'Bracer',          cost:{food:300,gold:200},  time:30, age:3, from:'blacksmith', req:'bodkinarrow', desc:'Ranged units +1 attack, +1 range', mod:{ rangedAtk:1, rangeUp:1 } },
  scalearmor:  { name:'Scale Armor',     cost:{food:100},           time:20, age:1, from:'blacksmith', desc:'Infantry & cavalry +1/+1 armor', mod:{ meleeArmor:1 } },
  chainarmor:  { name:'Chain Mail',      cost:{food:200,gold:100},  time:25, age:2, from:'blacksmith', req:'scalearmor', desc:'Infantry & cavalry +1/+1 armor', mod:{ meleeArmor:1 } },
  platearmor:  { name:'Plate Armor',     cost:{food:300,gold:150},  time:30, age:3, from:'blacksmith', req:'chainarmor', desc:'Infantry & cavalry +2/+2 armor', mod:{ meleeArmor:2 } },
  // Unit line upgrades
  manatarms:   { name:'Man-at-Arms',     cost:{food:100,gold:40},   time:20, age:1, from:'barracks', desc:'Upgrade Militia (+5 HP, +2 attack)',
                 buff:{ units:['militia'], hp:5, atk:2, rename:'Man-at-Arms' } },
  longswords:  { name:'Long Swordsman',  cost:{food:200,gold:65},   time:25, age:2, from:'barracks', req:'manatarms', desc:'Upgrade Man-at-Arms (+15 HP, +3 attack)',
                 buff:{ units:['militia'], hp:15, atk:3, rename:'Long Swordsman' } },
  champion:    { name:'Champion',        cost:{food:300,gold:100},  time:30, age:3, from:'barracks', req:'longswords', desc:'Upgrade Long Swordsman (+10 HP, +4 attack)',
                 buff:{ units:['militia'], hp:10, atk:4, rename:'Champion' } },
  pikeman:     { name:'Pikeman',         cost:{food:215,gold:90},   time:25, age:2, from:'barracks', desc:'Upgrade Spearman (+10 HP, +1 attack)',
                 buff:{ units:['spearman'], hp:10, atk:1, rename:'Pikeman', bonus:{cav:10} } },
  crossbow:    { name:'Crossbowman',     cost:{food:125,gold:75},   time:25, age:2, from:'archeryrange', desc:'Upgrade Archer (+5 HP, +1 attack, +1 range)',
                 buff:{ units:['archer'], hp:5, atk:1, range:1, rename:'Crossbowman' } },
  arbalester:  { name:'Arbalester',      cost:{food:350,gold:300},  time:30, age:3, from:'archeryrange', req:'crossbow', desc:'Upgrade Crossbowman (+5 HP, +1 attack)',
                 buff:{ units:['archer'], hp:5, atk:1, rename:'Arbalester' } },
  lightcav:    { name:'Light Cavalry',   cost:{food:150,gold:50},   time:25, age:2, from:'stable', desc:'Upgrade Scouts (+15 HP, +4 attack)',
                 buff:{ units:['scout'], hp:15, atk:4, rename:'Light Cavalry' } },
  cavalier:    { name:'Cavalier',        cost:{food:300,gold:300},  time:30, age:3, from:'stable', desc:'Upgrade Knights (+20 HP, +2 attack)',
                 buff:{ units:['knight'], hp:20, atk:2, rename:'Cavalier' } },
  eliteguard:  { name:'Elite Guard',     cost:{food:400,gold:250},  time:30, age:3, from:'castle', desc:'Upgrade Castle Guards (+15 HP, +4 attack)',
                 buff:{ units:['guard'], hp:15, atk:4, rename:'Elite Guard' } },
  eliteskirm:  { name:'Elite Skirmisher', cost:{wood:200,gold:100}, time:25, age:2, from:'archeryrange', desc:'Upgrade Skirmishers (+5 HP, +1 attack, +1 pierce armor)',
                 buff:{ units:['skirmisher'], hp:5, atk:1, parmor:1, rename:'Elite Skirmisher' } },
  husbandry:   { name:'Husbandry',       cost:{food:150},           time:20, age:2, from:'stable', desc:'Cavalry moves 10% faster',
                 buff:{ units:['scout','knight'], speed:0.13 } },
  squires:     { name:'Squires',         cost:{food:100},           time:20, age:2, from:'barracks', desc:'Infantry moves 10% faster',
                 buff:{ units:['militia','spearman','guard'], speed:0.1 } },
};

// Base gather rates: resource units per second (before tech multipliers)
const GATHER_RATE = { wood:0.39, berry:0.35, farm:0.45, gold:0.42, stone:0.39, hunt:0.45, fish:0.5 };
const BASE_CARRY = 10;
const RES_KEYS = ['wood','food','gold','stone'];
const RES_ICON = { wood:'🪵', food:'🍖', gold:'🪙', stone:'🪨' };

function costText(cost) {
  return Object.entries(cost).map(([k,v]) => `${RES_ICON[k]}${v}`).join(' ');
}
